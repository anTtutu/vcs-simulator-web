/**
 * 文件：src/cf/importer.ts
 * 用途：main.cf 导入 —— 解析模型落库为新集群（资源类型按命名前缀识别：IP_xxx → IP）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type Database from 'better-sqlite3'
import type { CfModel, CfAttrs } from './parser.js'
import { BizError } from '../domain/clusterLifecycle.js'
import type { AttrSchemaItem } from '../domain/types.js'

/** 导入结果 */
export interface ImportResult {
  clusterId: number
  clusterName: string
  groups: number
  resources: number
  links: number
  warnings: string[]
}

/**
 * 类型前缀表：code → 命名别名（真实 VCS 资源命名惯例）
 * 如 IP_oraprod → IP；LSNR_oraprod_lsnr → Netlsnr（别名 LSNR）；自定义类型按 code 直接匹配
 */
const TYPE_PREFIXES: Record<string, string[]> = {
  Netlsnr: ['LSNR'],
  DiskGroup: ['DG'],
  Volume: ['Vol'],
  Oracle: ['ORA'],
  Application: ['App'],
  Process: ['Proc'],
  // 二开示例类型别名
  OracleASM: ['ASM'],
  OraclePDB: ['PDB'],
}

function matchType(resourceName: string, types: { id: number; code: string }[]): number | undefined {
  let best: { id: number; len: number } | undefined
  for (const t of types) {
    for (const code of [t.code, ...(TYPE_PREFIXES[t.code] ?? [])]) {
      if (resourceName.startsWith(code + '_') && (!best || code.length > best.len)) {
        best = { id: t.id, len: code.length }
      }
    }
  }
  return best?.id
}

/**
 * 将解析出的模型写入【已存在】的集群（导入与快照恢复共用的落库核心）
 * 前置：调用方负责集群存在性与停止状态；本函数不清空现有内容（由调用方决定）
 */
export function writeModelInto(db: Database.Database, model: CfModel, clusterId: number): ImportResult {
  const warnings = [...model.warnings]
  let resCount = 0
  let linkCount = 0

  const insSystem = db.prepare("INSERT INTO system (cluster_id, name, status) VALUES (?, ?, 'OFFLINE')")
  const insGroup = db.prepare('INSERT INTO service_group (cluster_id, name, system_list, autostart_list) VALUES (?, ?, ?, ?)')
  const insRes = db.prepare("INSERT INTO resource (group_id, type_id, name, enabled, critical, state) VALUES (?, ?, ?, 1, ?, 'OFFLINE')")
  const insAttr = db.prepare('INSERT INTO resource_attr (resource_id, key, value) VALUES (?, ?, ?)')
  const insLink = db.prepare('INSERT OR IGNORE INTO resource_link (group_id, child_id, parent_id) VALUES (?, ?, ?)')
  const typeRows = db.prepare('SELECT id, code FROM resource_type').all() as { id: number; code: string }[]

  const tx = db.transaction(() => {
    // 节点：system 块；缺省补 sys1/sys2
    const systems = model.systems.length ? model.systems.map((s) => s.name) : ['sys1', 'sys2']
    for (const s of systems) insSystem.run(clusterId, s)

    for (const g of model.groups) {
      const sysListRaw = g.attrs['SystemList']
      const systemList = (sysListRaw && typeof sysListRaw === 'object' && 'pairs' in sysListRaw && sysListRaw.pairs
        ? Object.entries(sysListRaw.pairs).map(([name, priority]) => ({ name, priority: Number(priority) || 0 }))
        : systems.map((name, i) => ({ name, priority: i }))
      ).filter((s) => systems.includes(s.name))
      const autoRaw = g.attrs['AutoStartList']
      const autostart = autoRaw && typeof autoRaw === 'object' && 'values' in autoRaw && autoRaw.values ? autoRaw.values : []

      const gid = Number(insGroup.run(clusterId, g.name, JSON.stringify(systemList), JSON.stringify(autostart)).lastInsertRowid)
      const resIdMap = new Map<string, number>()

      for (const r of g.resources) {
        const type = matchType(r.name, typeRows)
        if (!type) {
          warnings.push(`资源 ${r.name} 无法识别类型（命名不符合 Type_ 前缀惯例），已跳过`)
          continue
        }
        const critical = /(^|_)(ORA|Oracle|App|Proc|SQL|Exch)(_|$)/.test(r.name) ? 1 : 0
        const rid = Number(insRes.run(gid, type, r.name, critical).lastInsertRowid)
        resIdMap.set(r.name, rid)
        resCount++
        const schema = JSON.parse(
          (db.prepare('SELECT attr_schema FROM resource_type WHERE id = ?').get(type) as { attr_schema: string }).attr_schema,
        ) as AttrSchemaItem[]
        const known = new Set(schema.map((s) => s.key))
        for (const [k, v] of Object.entries(r.attrs)) {
          const val = typeof v === 'string' ? v : v.pairs ? JSON.stringify(v.pairs) : (v.values ?? []).join(',')
          insAttr.run(rid, k, val)
          known.delete(k)
        }
        for (const s of schema) {
          if (known.has(s.key) && s.default !== undefined) insAttr.run(rid, s.key, s.default)
        }
      }

      for (const [child, parent] of g.links) {
        const cId = resIdMap.get(child)
        const pId = resIdMap.get(parent)
        if (!cId || !pId) {
          warnings.push(`依赖 ${child} requires ${parent} 因资源缺失被跳过`)
          continue
        }
        insLink.run(gid, cId, pId)
        linkCount++
      }
    }
    if (!model.groups.length) warnings.push('main.cf 中没有服务组，已导入空集群')
  })
  tx()

  return {
    clusterId,
    clusterName: model.cluster.name,
    groups: model.groups.length,
    resources: resCount,
    links: linkCount,
    warnings,
  }
}

/**
 * 将解析出的 CfModel 落库为新集群
 * @param db 数据库连接
 * @param model 解析模型
 * @returns 导入结果（含 warnings）
 */
export function importMainCf(db: Database.Database, model: CfModel): ImportResult {
  const warnings = [...model.warnings]
  if (!model.cluster.name) throw new BizError(400, 'main.cf 缺少 cluster 块，无法导入')
  if (db.prepare('SELECT id FROM cluster WHERE name = ?').get(model.cluster.name)) {
    throw new BizError(409, `集群名 ${model.cluster.name} 已存在，请先删除或重命名`)
  }

  const insCluster = db.prepare("INSERT INTO cluster (name, platform, status, simulator_port) VALUES (?, ?, 'STOPPED', ?)")
  const cid = Number(insCluster.run(model.cluster.name, 'Solaris', nextPort(db)).lastInsertRowid)
  return writeModelInto(db, model, cid)
}

/** 下一个可用模拟器端口 */
function nextPort(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(simulator_port) AS p FROM cluster').get() as { p: number | null }
  return Math.max(row.p ?? 15553, 15553) + 1
}

/** 格式化 CfAttrs（供调试输出） */
export function attrsSummary(attrs: CfAttrs): string {
  return Object.entries(attrs).map(([k, v]) => `${k}=${typeof v === 'string' ? v : '{...}'}`).join(', ')
}
