/**
 * 文件：src/db/repo.ts
 * 用途：数据访问层 —— 全部 SQL 收口于此，路由/引擎只调函数不写 SQL
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type Database from 'better-sqlite3'
import type {
  AttrSchemaItem,
  Cluster,
  EventLogRow,
  ResourceType,
  ServiceGroup,
  VcsSystem,
} from '../domain/types.js'
import { appendEventFile } from '../logging/eventFile.js'

/** 拓扑树节点（GET /tree 的资源条目） */
export interface TreeResource {
  id: number
  name: string
  typeCode: string
  icon: string
  enabled: boolean
  critical: boolean
  state: string
  /** 类型属性 schema（动态表单/导入校验用） */
  schema: AttrSchemaItem[]
  /** 画布保存坐标（自由拖拽持久化；null = 未保存过，走自动布局） */
  pos: { x: number; y: number } | null
  attrs: Record<string, string>
  /** per-system 覆盖（M2 编辑开放） */
  overrides: { systemId: number; key: string; value: string }[]
  /** 依赖的父资源 id 列表（requires 指向） */
  parents: number[]
  /** 以本资源为父的子资源 id 列表 */
  children: number[]
}

/** 拓扑树服务组条目 */
export interface TreeGroup {
  id: number
  /** 归属集群 id（引擎事件广播用） */
  clusterId: number
  name: string
  state: string
  systemList: { name: string; priority: number }[]
  autostartList: string[]
  currentSystem: string | null
  resources: TreeResource[]
}

export class Repo {
  constructor(private db: Database.Database) {}

  // ==================== 引擎支持（M2） ====================

  /** 取单个资源行（含 monitor_break） */
  getResource(id: number): { id: number; name: string; group_id: number; enabled: number; critical: number; state: string; monitor_break: number } | undefined {
    return this.db.prepare('SELECT id, name, group_id, enabled, critical, state, monitor_break FROM resource WHERE id = ?').get(id) as
      | { id: number; name: string; group_id: number; enabled: number; critical: number; state: string; monitor_break: number }
      | undefined
  }

  /** 取单个服务组行 */
  getGroup(id: number): ServiceGroup | undefined {
    return this.db.prepare('SELECT * FROM service_group WHERE id = ?').get(id) as ServiceGroup | undefined
  }

  /** 更新资源状态 */
  updateResourceState(id: number, state: string): void {
    this.db.prepare('UPDATE resource SET state = ? WHERE id = ?').run(state, id)
  }

  /** 更新资源开关（Enabled/Critical） */
  updateResourceFlags(id: number, patch: { enabled?: boolean; critical?: boolean }): void {
    const cur = this.getResource(id)
    if (!cur) throw new Error(`资源不存在: id=${id}`)
    this.db
      .prepare('UPDATE resource SET enabled = ?, critical = ? WHERE id = ?')
      .run(patch.enabled ?? !!cur.enabled ? 1 : 0, patch.critical ?? !!cur.critical ? 1 : 0, id)
  }

  /** 设置持续故障标记（Fault 注入=1 / Clear 解除=0） */
  setMonitorBreak(id: number, flag: 0 | 1): void {
    this.db.prepare('UPDATE resource SET monitor_break = ? WHERE id = ?').run(flag, id)
  }

  /** 更新服务组状态与当前运行节点 */
  updateGroup(id: number, state: string, currentSystem: string | null): void {
    this.db.prepare('UPDATE service_group SET state = ?, current_system = ? WHERE id = ?').run(state, currentSystem, id)
  }

  /** 新增资源（Copy/Paste、新建），返回 id */
  addResource(
    groupId: number,
    typeId: number,
    name: string,
    critical: boolean,
    attrs: Record<string, string>,
  ): number {
    const tx = this.db.transaction(() => {
      const rid = Number(
        this.db
          .prepare("INSERT INTO resource (group_id, type_id, name, enabled, critical, state) VALUES (?, ?, ?, 1, ?, 'OFFLINE')")
          .run(groupId, typeId, name, critical ? 1 : 0).lastInsertRowid,
      )
      const ins = this.db.prepare('INSERT INTO resource_attr (resource_id, key, value) VALUES (?, ?, ?)')
      for (const [k, v] of Object.entries(attrs)) ins.run(rid, k, v)
      this.insertEvent(
        (this.getGroup(groupId) as ServiceGroup).cluster_id,
        'INFO',
        'RESOURCE',
        name,
        'CREATE',
        '新增资源',
      )
      return rid
    })
    return tx()
  }

  /** 删除资源（依赖边经外键级联清理） */
  deleteResource(id: number): void {
    this.db.prepare('DELETE FROM resource WHERE id = ?').run(id)
  }

  /** 建立依赖边（幂等由 UNIQUE(child,parent) 保证） */
  addLink(groupId: number, childId: number, parentId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO resource_link (group_id, child_id, parent_id) VALUES (?, ?, ?)').run(groupId, childId, parentId)
  }

  /** 解除依赖边 */
  removeLink(groupId: number, childId: number, parentId: number): void {
    this.db.prepare('DELETE FROM resource_link WHERE group_id = ? AND child_id = ? AND parent_id = ?').run(groupId, childId, parentId)
  }

  /** 整体替换资源全局属性（保存属性表单） */
  replaceAttrs(resourceId: number, attrs: Record<string, string>): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM resource_attr WHERE resource_id = ? AND system_id IS NULL').run(resourceId)
      const ins = this.db.prepare('INSERT INTO resource_attr (resource_id, key, value) VALUES (?, ?, ?)')
      for (const [k, v] of Object.entries(attrs)) ins.run(resourceId, k, v)
    })
    tx()
  }

  /** 整体替换 per-system 覆盖行 */
  replaceOverrides(resourceId: number, rows: { systemId: number; key: string; value: string }[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM resource_attr WHERE resource_id = ? AND system_id IS NOT NULL').run(resourceId)
      const ins = this.db.prepare('INSERT INTO resource_attr (resource_id, key, value, system_id) VALUES (?, ?, ?, ?)')
      for (const r of rows) ins.run(resourceId, r.key, r.value, r.systemId)
    })
    tx()
  }

  /** 按资源 id 找到所属服务组行 */
  findGroupByResource(resourceId: number): ServiceGroup | undefined {
    return this.db
      .prepare(
        `SELECT g.* FROM service_group g JOIN resource r ON r.group_id = g.id WHERE r.id = ?`,
      )
      .get(resourceId) as ServiceGroup | undefined
  }

  /** 单组拓扑树（引擎内高频使用，getTree 的单组版本） */
  findGroupTree(gid: number): TreeGroup | undefined {
    const clusterRow = this.db
      .prepare('SELECT cluster_id FROM service_group WHERE id = ?')
      .get(gid) as { cluster_id: number } | undefined
    if (!clusterRow) return undefined
    const full = this.getTree(clusterRow.cluster_id)
    return full.groups.find((g) => g.id === gid)
  }

  // ==================== 集群 ====================

  /** 集群列表（按端口升序，与 Windows 版一致） */
  listClusters(): Cluster[] {
    return this.db.prepare('SELECT * FROM cluster ORDER BY simulator_port').all() as Cluster[]
  }

  /** 按 id 取集群，不存在/非法 id 抛 404 语义错误 */
  getCluster(id: number): Cluster {
    if (!Number.isInteger(id) || id <= 0) throw new Error(`集群不存在: id=${id}`)
    const row = this.db.prepare('SELECT * FROM cluster WHERE id = ?').get(id) as Cluster | undefined
    if (!row) throw new Error(`集群不存在: id=${id}`)
    return row
  }

  /** 新建集群（含节点），端口自动分配；返回新 id */
  createCluster(name: string, platform: string, systemNames: string[]): number {
    const maxPort = (this.db.prepare('SELECT MAX(simulator_port) AS p FROM cluster').get() as { p: number | null }).p
    const port = Math.max(maxPort ?? 15553, 15553) + 1
    const tx = this.db.transaction(() => {
      const cid = Number(
        this.db
          .prepare("INSERT INTO cluster (name, platform, status, simulator_port) VALUES (?, ?, 'STOPPED', ?)")
          .run(name, platform, port).lastInsertRowid,
      )
      for (const s of systemNames) this.db.prepare("INSERT INTO system (cluster_id, name, status) VALUES (?, ?, 'OFFLINE')").run(cid, s)
      this.insertEvent(cid, 'INFO', 'CLUSTER', name, 'CREATE', `新建集群，模拟器端口 ${port}`)
      return cid
    })
    return tx()
  }

  /** 更新集群基本信息（M1：全局选项 / WAC 端口） */
  updateCluster(id: number, patch: { global_enabled?: number; wac_port?: number }): void {
    const c = this.getCluster(id)
    this.db
      .prepare('UPDATE cluster SET global_enabled = ?, wac_port = ? WHERE id = ?')
      .run(patch.global_enabled ?? c.global_enabled, patch.wac_port ?? c.wac_port, id)
  }

  /** 删除集群（级联删节点/组/资源/属性/依赖边）；仅 STOPPED 可删由引擎层校验 */
  deleteCluster(id: number): void {
    this.db.prepare('DELETE FROM cluster WHERE id = ?').run(id)
  }

  /** 集群状态更新 */
  updateClusterStatus(id: number, status: string): void {
    this.db.prepare('UPDATE cluster SET status = ? WHERE id = ?').run(status, id)
  }

  // ==================== 节点 ====================

  /** 集群节点列表 */
  listSystems(clusterId: number): VcsSystem[] {
    return this.db.prepare('SELECT * FROM system WHERE cluster_id = ? ORDER BY name').all(clusterId) as VcsSystem[]
  }

  /** 节点状态批量更新（集群启动→ONLINE / 停止→OFFLINE） */
  updateSystemStatusByCluster(clusterId: number, status: string): void {
    this.db.prepare('UPDATE system SET status = ? WHERE cluster_id = ?').run(status, clusterId)
  }

  // ==================== 服务组 / 资源 ====================

  /** 集群内服务组列表 */
  listGroups(clusterId: number): ServiceGroup[] {
    return this.db.prepare('SELECT * FROM service_group WHERE cluster_id = ? ORDER BY name').all(clusterId) as ServiceGroup[]
  }

  /** 资源类型列表（模板库） */
  listResourceTypes(): ResourceType[] {
    return this.db.prepare('SELECT * FROM resource_type ORDER BY category, code').all() as ResourceType[]
  }

  /**
   * 组装拓扑树（REST GET /api/clusters/:id/tree 的数据源）
   * @returns 集群信息 + 节点列表 + 各服务组资源（含属性/依赖边）
   */
  getTree(clusterId: number): {
    cluster: Cluster
    systems: VcsSystem[]
    groups: TreeGroup[]
  } {
    const cluster = this.getCluster(clusterId)
    const systems = this.listSystems(clusterId)

    const groups = this.listGroups(clusterId).map((g): TreeGroup => {
      // 服务组内全部资源（联类型表取 code/icon/schema）；SQL 原始行 0/1 与领域布尔分开建模
      const resRows = this.db
        .prepare(
          `SELECT r.id, r.name, r.enabled, r.critical, r.state, t.code AS typeCode, t.icon, t.attr_schema AS attrSchema
           FROM resource r JOIN resource_type t ON t.id = r.type_id
           WHERE r.group_id = ? ORDER BY r.name`,
        )
        .all(g.id) as {
        id: number
        name: string
        enabled: number
        critical: number
        state: string
        typeCode: string
        icon: string
        attrSchema: string
      }[]

      // 属性（全局值）
      const attrStmt = this.db.prepare('SELECT key, value FROM resource_attr WHERE resource_id = ? AND system_id IS NULL')
      // per-system 覆盖
      const ovStmt = this.db.prepare('SELECT system_id, key, value FROM resource_attr WHERE resource_id = ? AND system_id IS NOT NULL')
      // 画布保存坐标（自由拖拽）
      const posStmt = this.db.prepare('SELECT x, y FROM resource_pos WHERE resource_id = ?')

      const resources: TreeResource[] = resRows.map((row) => ({
        id: row.id,
        name: row.name,
        typeCode: row.typeCode,
        icon: row.icon,
        enabled: !!row.enabled,
        critical: !!row.critical,
        state: row.state,
        schema: JSON.parse(row.attrSchema ?? '[]') as AttrSchemaItem[],
        pos: (posStmt.get(row.id) as { x: number; y: number } | undefined) ?? null,
        attrs: Object.fromEntries((attrStmt.all(row.id) as { key: string; value: string }[]).map((a) => [a.key, a.value])),
        // 覆盖行投影为驼峰（DB 列名为 system_id，前端统一用 systemId）
        overrides: (ovStmt.all(row.id) as { system_id: number; key: string; value: string }[]).map((o) => ({
          systemId: o.system_id,
          key: o.key,
          value: o.value,
        })),
        parents: [],
        children: [],
      }))
      const resMap = new Map(resources.map((x) => [x.id, x]))

      // 依赖边装填（悬空边防御：仅装填两端都在组内的边）
      const links = this.db
        .prepare('SELECT child_id, parent_id FROM resource_link WHERE group_id = ?')
        .all(g.id) as { child_id: number; parent_id: number }[]
      for (const l of links) {
        resMap.get(l.child_id)?.parents.push(l.parent_id)
        resMap.get(l.parent_id)?.children.push(l.child_id)
      }
      return {
        id: g.id,
        clusterId: cluster.id,
        name: g.name,
        state: g.state,
        systemList: JSON.parse(g.system_list),
        autostartList: JSON.parse(g.autostart_list),
        currentSystem: g.current_system,
        resources,
      }
    })

    return { cluster, systems, groups }
  }

  // ==================== 事件日志 ====================

  /** 追加事件日志（DB + 按天文件镜像 logs/event-*.log，方便直接翻文件查问题） */
  insertEvent(
    clusterId: number,
    level: EventLogRow['level'],
    scope: EventLogRow['scope'],
    target: string | null,
    action: string,
    detail: string | null,
  ): void {
    this.db
      .prepare('INSERT INTO event_log (cluster_id, level, scope, target, action, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(clusterId, level, scope, target, action, detail)
    appendEventFile({ level, scope, target, action, detail })
  }

  /** 查询事件日志（倒序，limit 供前端最近事件展示） */
  listEvents(clusterId: number, limit = 50): EventLogRow[] {
    return this.db
      .prepare('SELECT * FROM event_log WHERE cluster_id = ? ORDER BY id DESC LIMIT ?')
      .all(clusterId, limit) as EventLogRow[]
  }

  // ==================== 服务组管理（设计器：新建/删除组） ====================

  /**
   * 新建服务组（集群设计器入口：此前新建集群后无任何组，导致无法进入设计界面）
   * @param clusterId 集群 id
   * @param name 组名（集群内唯一，字母开头）
   * @param systemNames 可运行节点（缺省 = 全部节点按序）
   * @returns 新组 id
   */
  createGroup(clusterId: number, name: string, systemNames: string[]): number {
    this.getCluster(clusterId)
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error('服务组名不合法（字母开头，仅字母/数字/下划线）')
    if (this.listGroups(clusterId).some((g) => g.name === name)) throw new Error(`服务组 ${name} 已存在`)
    const all = this.listSystems(clusterId).map((s) => s.name)
    const systems = systemNames.length ? systemNames : all
    for (const s of systems) {
      if (!all.includes(s)) throw new Error(`节点 ${s} 不存在于集群`)
    }
    const systemList = systems.map((s, i) => ({ name: s, priority: i }))
    const r = this.db
      .prepare('INSERT INTO service_group (cluster_id, name, system_list, autostart_list) VALUES (?, ?, ?, ?)')
      .run(clusterId, name, JSON.stringify(systemList), '[]') // 新组默认不自动上线
    this.insertEvent(clusterId, 'INFO', 'GROUP', name, 'CREATE', `新建服务组（可运行节点：${systems.join(', ')}）`)
    return Number(r.lastInsertRowid)
  }

  /** 删除服务组（仅空组：内含资源时拒绝） */
  deleteGroup(gid: number): void {
    const g = this.getGroup(gid)
    if (!g) throw new Error(`服务组不存在: id=${gid}`)
    const cnt = this.db.prepare('SELECT COUNT(*) AS c FROM resource WHERE group_id = ?').get(gid) as { c: number }
    if (cnt.c > 0) throw new Error(`服务组 ${g.name} 内还有 ${cnt.c} 个资源，请先清空再删除`)
    this.db.prepare('DELETE FROM service_group WHERE id = ?').run(gid)
    this.insertEvent(g.cluster_id, 'INFO', 'GROUP', g.name, 'DELETE', '删除空服务组')
  }

  // ==================== 二期：画布坐标（自由拖拽持久化） ====================

  /** 保存资源画布坐标 */
  savePosition(resourceId: number, x: number, y: number): void {
    this.db
      .prepare(
        'INSERT INTO resource_pos (resource_id, x, y) VALUES (?, ?, ?) ON CONFLICT(resource_id) DO UPDATE SET x = excluded.x, y = excluded.y',
      )
      .run(resourceId, x, y)
  }

  /** 清空组内全部保存坐标（Auto Arrange 恢复自动布局） */
  clearPositions(groupId: number): void {
    this.db.prepare('DELETE FROM resource_pos WHERE resource_id IN (SELECT id FROM resource WHERE group_id = ?)').run(groupId)
  }

  // ==================== 二期：心跳 / 全局分组 / 快照 / 类型管理 / 总览 ====================

  /** 集群心跳链路列表（link0/link1；缺失时惰性回填——migrate 回填早于种子执行，覆盖不了种子集群） */
  listLinks(clusterId: number): { name: string; status: string }[] {
    let rows = this.db
      .prepare('SELECT name, status FROM cluster_link WHERE cluster_id = ? ORDER BY name')
      .all(clusterId) as { name: string; status: string }[]
    if (!rows.length) {
      const ins = this.db.prepare("INSERT OR IGNORE INTO cluster_link (cluster_id, name) VALUES (?, ?)")
      ins.run(clusterId, 'link0')
      ins.run(clusterId, 'link1')
      rows = this.db.prepare('SELECT name, status FROM cluster_link WHERE cluster_id = ? ORDER BY name').all(clusterId) as {
        name: string
        status: string
      }[]
    }
    return rows
  }

  /** 设置链路状态（UP/DOWN），返回更新后列表（先确保行存在，防止回填覆盖更新） */
  setLinkStatus(clusterId: number, name: string, status: 'UP' | 'DOWN'): { name: string; status: string }[] {
    this.listLinks(clusterId) // 惰性回填
    this.db
      .prepare('UPDATE cluster_link SET status = ? WHERE cluster_id = ? AND name = ?')
      .run(status, clusterId, name === 'link1' ? 'link1' : 'link0')
    return this.listLinks(clusterId)
  }

  /** 心跳全部恢复为 UP（集群停止/重启时归位） */
  resetLinks(clusterId: number): void {
    this.db.prepare("UPDATE cluster_link SET status = 'UP' WHERE cluster_id = ?").run(clusterId)
  }

  /** 全局容灾分组列表（含集群摘要与服务组状态，供 Global View 绘制） */
  listGlobalGroups(): { id: number; name: string; clusters: unknown[] }[] {
    const rows = this.db.prepare('SELECT * FROM global_group ORDER BY id').all() as { id: number; name: string; cluster_ids: string }[]
    return rows.map((r) => {
      const ids = JSON.parse(r.cluster_ids) as number[]
      const clusters = ids
        .map((cid) => {
          try {
            const tree = this.getTree(cid)
            return {
              id: tree.cluster.id,
              name: tree.cluster.name,
              platform: tree.cluster.platform,
              status: tree.cluster.status,
              port: tree.cluster.simulator_port,
              groups: tree.groups.map((g) => ({ name: g.name, state: g.state, currentSystem: g.currentSystem })),
            }
          } catch {
            return null // 集群已删除的悬空成员
          }
        })
        .filter(Boolean)
      return { id: r.id, name: r.name, clusters }
    })
  }

  /** 新建全局分组（≥2 个集群） */
  createGlobalGroup(name: string, clusterIds: number[]): number {
    if (clusterIds.length < 2) throw new Error('全局分组至少需要 2 个集群')
    for (const cid of clusterIds) this.getCluster(cid)
    const r = this.db
      .prepare('INSERT INTO global_group (name, cluster_ids) VALUES (?, ?)')
      .run(name, JSON.stringify(clusterIds))
    return Number(r.lastInsertRowid)
  }

  /** 删除全局分组 */
  deleteGlobalGroup(id: number): void {
    this.db.prepare('DELETE FROM global_group WHERE id = ?').run(id)
  }

  /** 配置快照列表 */
  listSnapshots(clusterId: number): { id: number; label: string; created_at: string }[] {
    return this.db
      .prepare('SELECT id, label, created_at FROM config_snapshot WHERE cluster_id = ? ORDER BY id DESC')
      .all(clusterId) as { id: number; label: string; created_at: string }[]
  }

  /** 新建快照，返回 id */
  createSnapshot(clusterId: number, label: string, mainCf: string): number {
    const r = this.db
      .prepare('INSERT INTO config_snapshot (cluster_id, label, main_cf) VALUES (?, ?, ?)')
      .run(clusterId, label, mainCf)
    return Number(r.lastInsertRowid)
  }

  /** 取快照正文 */
  getSnapshot(id: number): { id: number; cluster_id: number; label: string; main_cf: string; created_at: string } | undefined {
    return this.db.prepare('SELECT * FROM config_snapshot WHERE id = ?').get(id) as
      | { id: number; cluster_id: number; label: string; main_cf: string; created_at: string }
      | undefined
  }

  /** 监控总览聚合（一次 SQL 出全部集群的组/节点在线计数） */
  overview(): Record<string, unknown>[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.name, c.platform, c.status, c.simulator_port,
           (SELECT COUNT(*) FROM service_group g WHERE g.cluster_id = c.id) AS groupsTotal,
           (SELECT COUNT(*) FROM service_group g WHERE g.cluster_id = c.id AND g.state = 'ONLINE') AS groupsOnline,
           (SELECT COUNT(*) FROM system s WHERE s.cluster_id = c.id) AS sysTotal,
           (SELECT COUNT(*) FROM system s WHERE s.cluster_id = c.id AND s.status = 'ONLINE') AS sysOnline,
           (SELECT COUNT(*) FROM cluster_link l WHERE l.cluster_id = c.id AND l.status = 'DOWN') AS linksDown
         FROM cluster c ORDER BY c.simulator_port`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      ...r,
      linkStatus: r.linksDown === 0 ? 'Up' : r.linksDown === 1 ? 'Degraded' : 'Down',
    }))
  }

  // ==================== Verify 支持 ====================

  /** 组装 Verify 所需模型（含类型 schema） */
  getVerifyModel(clusterId: number) {
    const tree = this.getTree(clusterId)
    const types = new Map(this.listResourceTypes().map((t) => [t.code, t]))
    return {
      clusterName: tree.cluster.name,
      systems: tree.systems.map((s) => ({ name: s.name })),
      groups: tree.groups.map((g) => ({
        name: g.name,
        systemList: g.systemList,
        resources: g.resources.map((r) => {
          const t = types.get(r.typeCode)
          return {
            name: r.name,
            typeCode: r.typeCode,
            attrs: r.attrs,
            schema: (t ? JSON.parse(t.attr_schema) : []) as AttrSchemaItem[],
            parents: r.parents.map((pid) => {
              const found = g.resources.find((x) => x.id === pid)
              return found?.name ?? `<不存在:${pid}>`
            }),
          }
        }),
      })),
    }
  }
}
