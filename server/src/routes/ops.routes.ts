/**
 * 文件：src/routes/ops.routes.ts
 * 用途：M2/M3/M4 操作路由 —— 组/资源引擎动作、属性保存、Link/Unlink、
 *       资源增删（Copy/Paste）、main.cf 导入导出、CLI 控制台
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { Router } from 'express'
import type { Repo } from '../db/repo.js'
import type { GroupEngine } from '../engine/groupEngine.js'
import type { ClusterEngine } from '../engine/clusterEngine.js'
import type { ScenarioRunner } from '../engine/scenario.js'
import { BizError } from '../domain/clusterLifecycle.js'
import { parseMainCf } from '../cf/parser.js'
import { generateMainCf, generateTypesCf } from '../cf/generator.js'
import { importMainCf, writeModelInto } from '../cf/importer.js'
import { execCommand } from '../cli/commands.js'
import { runProbeScript, PROBE_EXAMPLES } from '../domain/probeScript.js'
import { requireRole, roleOf, OPERATOR, ADMIN } from './roles.js'
import type Database from 'better-sqlite3'

/**
 * 组装操作路由
 * @param repo 数据仓储
 * @param groupEngine 服务组引擎
 * @param clusterEngine 集群引擎（CLI 的 hastart/hastop）
 * @param scenarioRunner 演练剧本
 * @param db 原始连接（cf 导入/快照恢复用）
 * @returns Express Router
 */
export function opsRoutes(
  repo: Repo,
  groupEngine: GroupEngine,
  clusterEngine: ClusterEngine,
  scenarioRunner: ScenarioRunner,
  db: Database.Database,
): Router {
  const router = Router()

  // ==================== 服务组设计器（新建/删除组） ====================

  /** 新建服务组 { name, systems?[] }（Operator+） */
  router.post('/clusters/:id/groups', requireRole(...OPERATOR), (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id)
    try {
      const gid = repo.createGroup(id, String(req.body?.name ?? ''), (req.body?.systems ?? []) as string[])
      res.status(201).json({ id: gid })
    } catch (e) {
      throw new BizError(400, (e as Error).message)
    }
  })

  /** 删除服务组（仅空组，Operator+） */
  router.delete('/groups/:gid', requireRole(...OPERATOR), (req, res) => {
    try {
      repo.deleteGroup(Number(req.params.gid))
      res.status(204).end()
    } catch (e) {
      throw new BizError(409, (e as Error).message)
    }
  })

  // ==================== 服务组动作（Operator 及以上；脑裂时被引擎 409 冻结） ====================

  /** 组上线 { system? } */
  router.post('/groups/:gid/online', requireRole(...OPERATOR), (req, res) => {
    groupEngine.groupOnline(Number(req.params.gid), req.body?.system)
    res.json({ ok: true })
  })

  /** 组下线 */
  router.post('/groups/:gid/offline', requireRole(...OPERATOR), (req, res) => {
    groupEngine.groupOffline(Number(req.params.gid))
    res.json({ ok: true })
  })

  /** 组切换 { toSystem } */
  router.post('/groups/:gid/switch', requireRole(...OPERATOR), (req, res) => {
    groupEngine.groupSwitch(Number(req.params.gid), req.body?.toSystem)
    res.json({ ok: true })
  })

  /** 建/解除依赖 { childId, parentId } */
  router.post('/groups/:gid/links', requireRole(...OPERATOR), (req, res) => {
    groupEngine.link(Number(req.params.gid), Number(req.body?.childId), Number(req.body?.parentId))
    res.json({ ok: true })
  })
  router.delete('/groups/:gid/links', requireRole(...OPERATOR), (req, res) => {
    groupEngine.unlink(Number(req.params.gid), Number(req.body?.childId), Number(req.body?.parentId))
    res.json({ ok: true })
  })

  /** 新增资源（Copy/Paste 的 Paste、模板新建）{ name, typeCode, critical?, attrs? } */
  router.post('/groups/:gid/resources', requireRole(...OPERATOR), (req, res) => {
    const gid = Number(req.params.gid)
    const { name, typeCode, critical = false, attrs = {} } = req.body ?? {}
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new BizError(400, '资源名不合法（字母开头，仅字母/数字/下划线）')
    }
    const g = repo.findGroupTree(gid)
    if (!g) throw new BizError(404, '服务组不存在')
    if (g.resources.some((r) => r.name === name)) throw new BizError(409, `资源名 ${name} 已存在`)
    const type = repo.listResourceTypes().find((t) => t.code === typeCode)
    if (!type) throw new BizError(400, `未知资源类型 ${typeCode}`)
    const id = repo.addResource(gid, type.id, name, !!critical, attrs)
    repo.insertEvent(g.clusterId, 'INFO', 'RESOURCE', name, 'CREATE', `新增 ${typeCode} 资源`)
    res.status(201).json({ id })
  })

  // ==================== 资源动作（Operator 及以上） ====================

  /** 资源级引擎动作：action ∈ online|offline|prop|fault|clear|probe */
  router.post('/resources/:rid/:action(online|offline|prop|fault|clear|probe)', requireRole(...OPERATOR), (req, res) => {
    const rid = Number(req.params.rid)
    switch (req.params.action) {
      case 'online':
        groupEngine.resourceOnline(rid)
        break
      case 'offline':
        groupEngine.resourceOffline(rid)
        break
      case 'prop':
        groupEngine.resourceOfflineProp(rid)
        break
      case 'fault':
        groupEngine.resourceFault(rid)
        break
      case 'clear':
        groupEngine.resourceClear(rid)
        break
      case 'probe':
        groupEngine.resourceProbe(rid)
        break
    }
    res.json({ ok: true })
  })

  /** 更新资源开关 { enabled?, critical? } */
  router.put('/resources/:rid', requireRole(...OPERATOR), (req, res) => {
    const rid = Number(req.params.rid)
    const cur = repo.getResource(rid)
    if (!cur) throw new BizError(404, '资源不存在')
    repo.updateResourceFlags(rid, {
      enabled: req.body?.enabled === undefined ? undefined : !!req.body.enabled,
      critical: req.body?.critical === undefined ? undefined : !!req.body.critical,
    })
    repo.insertEvent(
      repo.findGroupByResource(rid)!.cluster_id,
      'INFO',
      'RESOURCE',
      cur.name,
      'UPDATE',
      `Enabled=${req.body?.enabled ?? !!cur.enabled} Critical=${req.body?.critical ?? !!cur.critical}`,
    )
    res.json({ ok: true })
  })

  /** 保存属性 { attrs: {k:v}, overrides: [{systemId,key,value}] } */
  router.put('/resources/:rid/attributes', requireRole(...OPERATOR), (req, res) => {
    const rid = Number(req.params.rid)
    const cur = repo.getResource(rid)
    if (!cur) throw new BizError(404, '资源不存在')
    const attrs = (req.body?.attrs ?? {}) as Record<string, string>
    if (typeof attrs !== 'object') throw new BizError(400, 'attrs 必须为对象')
    const overrides = (req.body?.overrides ?? []) as { systemId: number; key: string; value: string }[]
    if (!Array.isArray(overrides)) throw new BizError(400, 'overrides 必须为数组')
    repo.replaceAttrs(rid, Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v ?? '')])))
    repo.replaceOverrides(rid, overrides.filter((o) => o.key && o.systemId))
    repo.insertEvent(
      repo.findGroupByResource(rid)!.cluster_id,
      'INFO',
      'RESOURCE',
      cur.name,
      'ATTR_SAVE',
      `保存 ${Object.keys(attrs).length} 项属性 / ${overrides.length} 项覆盖`,
    )
    res.json({ ok: true })
  })

  /** 删除资源（仅 OFFLINE/FAULTED 态） */
  router.delete('/resources/:rid', requireRole(...OPERATOR), (req, res) => {
    const rid = Number(req.params.rid)
    const cur = repo.getResource(rid)
    if (!cur) throw new BizError(404, '资源不存在')
    if (['ONLINE', 'STARTING', 'STOPPING'].includes(cur.state)) {
      throw new BizError(409, `资源 ${cur.name} 处于 ${cur.state}，请先下线再删除`)
    }
    repo.deleteResource(rid)
    repo.insertEvent(repo.findGroupByResource(rid)?.cluster_id ?? 0, 'INFO', 'RESOURCE', cur.name, 'DELETE', '删除资源')
    res.status(204).end()
  })

  // ==================== main.cf 导入/导出 ====================

  /** 导出：GET /api/clusters/:id/cf?types=1 → { main, types? } */
  router.get('/clusters/:id/cf', (req, res) => {
    const id = Number(req.params.id)
    const cluster = repo.getCluster(id)
    const tree = repo.getTree(id)
    const main = generateMainCf({ cluster, groups: tree.groups })
    const types = req.query.types ? generateTypesCf(repo.listResourceTypes()) : undefined
    res.json({ main, types })
  })

  /** 导入：POST /api/clusters/cf/import { content } → 结果 + warnings（Admin） */
  router.post('/clusters/cf/import', requireRole(...ADMIN), (req, res) => {
    const content = req.body?.content
    if (typeof content !== 'string' || !content.trim()) throw new BizError(400, '缺少 main.cf 内容')
    const model = parseMainCf(content)
    const result = importMainCf(db, model)
    repo.insertEvent(result.clusterId, 'INFO', 'CLUSTER', result.clusterName, 'CF_IMPORT', `导入 ${result.groups} 组 / ${result.resources} 资源 / ${result.links} 依赖`)
    res.status(201).json(result)
  })

  // ==================== CLI 控制台 ====================

  /** 执行命令 { command } → { output[], clear? }（Observer 变更类命令被 CLI 层拒绝） */
  router.post('/clusters/:id/console', (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id) // 404 校验
    const command = String(req.body?.command ?? '')
    const result = execCommand({ repo, clusterEngine, groupEngine, clusterId: id, role: roleOf(req) }, command)
    res.json(result)
  })

  // ==================== 二期：画布坐标（自由拖拽持久化） ====================

  /** 保存节点坐标 { x, y }（拖拽停止时调用） */
  router.put('/resources/:rid/position', requireRole(...OPERATOR), (req, res) => {
    const rid = Number(req.params.rid)
    const x = Number(req.body?.x)
    const y = Number(req.body?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new BizError(400, '坐标不合法')
    repo.savePosition(rid, x, y)
    res.json({ ok: true })
  })

  /** 清空组内保存坐标（Auto Arrange） */
  router.post('/groups/:gid/positions/clear', requireRole(...OPERATOR), (req, res) => {
    repo.clearPositions(Number(req.params.gid))
    res.json({ ok: true })
  })

  // ==================== 二期：心跳链路（P1-1） ====================

  /** 断开/恢复心跳链路 { }：POST /api/clusters/:id/links/link0/down|up（Operator+） */
  router.post('/clusters/:id/links/:name/:action(down|up)', requireRole(...OPERATOR), (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id)
    const status = req.params.action === 'down' ? 'DOWN' : 'UP'
    res.json(groupEngine.setLink(id, req.params.name, status))
  })

  // ==================== 二期：配置快照（P2-1） ====================

  /** 快照列表 */
  router.get('/clusters/:id/snapshots', (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id)
    res.json(repo.listSnapshots(id))
  })

  /** 拍快照 { label? }（Operator+）：自动生成当前 main.cf */
  router.post('/clusters/:id/snapshots', requireRole(...OPERATOR), (req, res) => {
    const id = Number(req.params.id)
    const cluster = repo.getCluster(id)
    const tree = repo.getTree(id)
    const main = generateMainCf({ cluster, groups: tree.groups })
    const label = String(req.body?.label || `快照 ${new Date().toLocaleString()}`)
    const sid = repo.createSnapshot(id, label, main)
    repo.insertEvent(id, 'INFO', 'CLUSTER', cluster.name, 'SNAPSHOT', `创建配置快照 #${sid}：${label}`)
    res.status(201).json({ id: sid })
  })

  /** 快照正文 */
  router.get('/snapshots/:sid', (req, res) => {
    const snap = repo.getSnapshot(Number(req.params.sid))
    if (!snap) throw new BizError(404, '快照不存在')
    res.json(snap)
  })

  /** 回滚快照（Admin）：集群须 STOPPED；以快照内容整体替换该集群配置 */
  router.post('/snapshots/:sid/restore', requireRole(...ADMIN), (req, res) => {
    const snap = repo.getSnapshot(Number(req.params.sid))
    if (!snap) throw new BizError(404, '快照不存在')
    const cluster = repo.getCluster(snap.cluster_id)
    if (cluster.status !== 'STOPPED') throw new BizError(409, '回滚前请先停止集群')
    const model = parseMainCf(snap.main_cf)
    model.cluster.name = cluster.name // 保持集群名不变
    // 清空现有配置（外键级联带走资源/属性/依赖边）
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM service_group WHERE cluster_id = ?').run(cluster.id)
      db.prepare('DELETE FROM system WHERE cluster_id = ?').run(cluster.id)
    })
    tx()
    const result = writeModelInto(db, model, cluster.id)
    repo.insertEvent(cluster.id, 'INFO', 'CLUSTER', cluster.name, 'SNAPSHOT_RESTORE', `已回滚到快照 #${snap.id}（${snap.label}）`)
    res.json(result)
  })

  // ==================== 二期：演练剧本（P1-4） ====================

  /** 剧本清单 */
  router.get('/scenarios', (_req, res) => {
    res.json(scenarioRunner.list())
  })

  /** 执行剧本 { }（Operator+） */
  router.post('/clusters/:id/scenarios/:key/run', requireRole(...OPERATOR), (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id)
    res.json(scenarioRunner.run(id, req.params.key))
  })

  /** 停止剧本 */
  router.post('/clusters/:id/scenarios/stop', requireRole(...OPERATOR), (req, res) => {
    scenarioRunner.stop(Number(req.params.id))
    res.json({ ok: true })
  })

  // ==================== 二期：自定义 Agent 类型（P2-2） ====================

  /** 新建自定义类型（Admin） */
  router.post('/resource-types', requireRole(...ADMIN), (req, res) => {
    const { code, label, category = 'Custom', icon = '🧩', attrs = [] } = req.body ?? {}
    if (typeof code !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(code)) throw new BizError(400, '类型 code 不合法')
    if (repo.listResourceTypes().some((t) => t.code === code)) throw new BizError(409, `类型 ${code} 已存在`)
    const attrSchema = (attrs as { key: string; label?: string; type?: string; required?: boolean; default?: string }[]).map((a) => ({
      key: String(a.key),
      label: String(a.label ?? a.key),
      type: (['string', 'number', 'boolean'].includes(a.type ?? '') ? a.type : 'string') as 'string' | 'number' | 'boolean',
      required: !!a.required,
      default: a.default,
    }))
    const r = db
      .prepare('INSERT INTO resource_type (code, label, category, icon, monitor_interval, attr_schema, builtin) VALUES (?, ?, ?, ?, 60, ?, 0)')
      .run(code, String(label || code), String(category), String(icon), JSON.stringify(attrSchema))
    res.status(201).json({ id: Number(r.lastInsertRowid) })
  })

  /** 修改自定义类型（Admin，builtin 只读） */
  router.put('/resource-types/:tid', requireRole(...ADMIN), (req, res) => {
    const t = db.prepare('SELECT * FROM resource_type WHERE id = ?').get(Number(req.params.tid)) as { builtin: number } | undefined
    if (!t) throw new BizError(404, '类型不存在')
    if (t.builtin) throw new BizError(409, '内置类型不可修改（可新建自定义类型替代）')
    const { label, category, icon, attrs } = req.body ?? {}
    const attrSchema = Array.isArray(attrs)
      ? JSON.stringify(
          attrs.map((a: { key: string; label?: string; type?: string; required?: boolean; default?: string }) => ({
            key: String(a.key),
            label: String(a.label ?? a.key),
            type: (['string', 'number', 'boolean'].includes(a.type ?? '') ? a.type : 'string') as 'string' | 'number' | 'boolean',
            required: !!a.required,
            default: a.default,
          })),
        )
      : undefined
    db.prepare('UPDATE resource_type SET label = ?, category = ?, icon = ?, attr_schema = ? WHERE id = ?').run(
      String(label ?? ''),
      String(category ?? 'Custom'),
      String(icon ?? '🧩'),
      attrSchema ?? '[]',
      Number(req.params.tid),
    )
    res.json({ ok: true })
  })

  /** 删除自定义类型（Admin；被资源引用时拒绝） */
  router.delete('/resource-types/:tid', requireRole(...ADMIN), (req, res) => {
    const tid = Number(req.params.tid)
    const t = db.prepare('SELECT * FROM resource_type WHERE id = ?').get(tid) as { builtin: number; code: string } | undefined
    if (!t) throw new BizError(404, '类型不存在')
    if (t.builtin) throw new BizError(409, '内置类型不可删除')
    const used = db.prepare('SELECT COUNT(*) AS c FROM resource WHERE type_id = ?').get(tid) as { c: number }
    if (used.c > 0) throw new BizError(409, `类型 ${t.code} 正被 ${used.c} 个资源引用，请先删除相关资源`)
    db.prepare('DELETE FROM resource_type WHERE id = ?').run(tid)
    res.status(204).end()
  })

  // ==================== 二期：Global 容灾分组（P0-1） ====================

  /** 全局分组列表（含两站集群摘要与服务组状态） */
  router.get('/global', (_req, res) => {
    res.json(repo.listGlobalGroups())
  })

  /** 新建全局分组 { name, clusterIds } （Admin） */
  router.post('/global', requireRole(...ADMIN), (req, res) => {
    const name = String(req.body?.name ?? '')
    const ids = (req.body?.clusterIds ?? []) as number[]
    if (!name.trim()) throw new BizError(400, '分组名不能为空')
    const id = repo.createGlobalGroup(name.trim(), ids.map(Number))
    res.status(201).json({ id })
  })

  /** 删除全局分组（Admin） */
  router.delete('/global/:gid', requireRole(...ADMIN), (req, res) => {
    repo.deleteGlobalGroup(Number(req.params.gid))
    res.status(204).end()
  })

  // ==================== 二期：MonScript 自定义探测脚本（引擎真实执行） ====================

  /** 探测脚本示例清单（前端提示用） */
  router.get('/probe-examples', (_req, res) => {
    res.json(PROBE_EXAMPLES)
  })

  /** 试跑探测脚本（不落库不触发引擎）：{ script, attrs? } → 判定结果 */
  router.post('/resources/:rid/testscript', (req, res) => {
    const rid = Number(req.params.rid)
    const found = repo.findGroupByResource(rid)
    if (!found) throw new BizError(404, '资源不存在')
    const g = repo.findGroupTree(found.id)!
    const target = g.resources.find((r) => r.id === rid)!
    const attrs = (req.body?.attrs ?? target.attrs) as Record<string, string>
    const script = String(req.body?.script ?? '')
    res.json(runProbeScript(script, attrs, target.state, Math.random()))
  })

  return router
}
