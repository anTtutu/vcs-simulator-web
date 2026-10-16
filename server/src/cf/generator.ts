/**
 * 文件：src/cf/generator.ts
 * 用途：main.cf / types.cf 生成器 —— 由 DB 领域模型生成与真实 VCS 语法一致的配置文本
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { AttrSchemaItem, Cluster, ResourceType } from '../domain/types.js'
import type { TreeGroup } from '../db/repo.js'

/** 值格式化：数字/布尔裸写，其余加引号 */
function fmtValue(v: string): string {
  if (/^-?\d+(\.\d+)?$/.test(v)) return v
  if (v === 'true' || v === 'false') return v
  return `"${v}"`
}

/** 列表格式化：键对 { a = 1, b = 2 } / 纯值 { x, y } */
function fmtList(list: { pairs?: Record<string, string>; values?: string[] }): string {
  if (list.pairs) {
    return `{ ${Object.entries(list.pairs).map(([k, v]) => `${k} = ${fmtValue(v)}`).join(', ')} }`
  }
  return `{ ${list.values?.join(', ') ?? ''} }`
}

/** 导出输入模型 */
export interface ExportInput {
  cluster: Cluster
  groups: TreeGroup[]
}

/**
 * 生成 main.cf 文本（缩进 4 空格，块尾 ")" 独立一行，与 Windows 版导出风格一致）
 * @param input 集群与组
 * @returns main.cf 文本
 */
export function generateMainCf(input: ExportInput): string {
  const { cluster, groups } = input
  const L: string[] = []
  L.push(`include "types.cf"`)
  L.push('')

  // cluster 块
  L.push(`cluster ${cluster.name} (`)
  L.push(`    ClusterName = ${fmtValue(cluster.name)}`)
  L.push(`    )`)
  L.push('')

  // system 块（取第一组的 SystemList 并集；无组时给 sys1/sys2）
  const sysNames = new Set<string>()
  for (const g of groups) for (const s of g.systemList) sysNames.add(s.name)
  const systems = sysNames.size ? [...sysNames] : ['sys1', 'sys2']
  for (const s of systems) {
    L.push(`system ${s} (`)
    L.push(`    )`)
    L.push('')
  }

  for (const g of groups) {
    L.push(`service group ${g.name} (`)
    const pairs: Record<string, string> = {}
    for (const s of g.systemList) pairs[s.name] = String(s.priority)
    L.push(`    SystemList = ${fmtList({ pairs })}`)
    if (g.autostartList.length) L.push(`    AutoStartList = ${fmtList({ values: g.autostartList })}`)
    L.push(`    )`)
    L.push('')

    // 依赖声明（requires 行）
    for (const r of g.resources) {
      for (const pid of r.parents) {
        const parent = g.resources.find((x) => x.id === pid)
        if (parent) L.push(`    ${r.name} requires ${parent.name}`)
      }
    }
    if (g.resources.some((r) => r.parents.length)) L.push('')

    // 资源属性块
    for (const r of g.resources) {
      L.push(`    ${r.name} (`)
      for (const [k, v] of Object.entries(r.attrs)) {
        // 逗号分隔的多值属性还原为列表（如 MonitorPrograms）—— 模拟器按标量处理
        L.push(`        ${k} = ${fmtValue(v)}`)
      }
      L.push(`        )`)
      L.push('')
    }
  }
  return L.join('\n')
}

/**
 * 生成 types.cf 风格的类型定义（按资源类型表）
 * @param types 资源类型列表
 * @returns types.cf 文本
 */
export function generateTypesCf(types: ResourceType[]): string {
  const L: string[] = []
  L.push(`/* types.cf - 由 VCS Simulator Web 生成（近似真实 VCS 类型定义） */`)
  L.push('')
  for (const t of types) {
    const schema = JSON.parse(t.attr_schema) as AttrSchemaItem[]
    L.push(`type ${t.code} (`)
    if (schema.length) {
      L.push(`    static str ArgList = { ${schema.map((s) => s.key).join(', ')} }`)
    }
    for (const s of schema) {
      const vcsType = s.type === 'number' ? 'int' : s.type === 'boolean' ? 'bool' : 'str'
      L.push(`    ${vcsType} ${s.key}`)
    }
    L.push(`    )`)
    L.push('')
  }
  return L.join('\n')
}
