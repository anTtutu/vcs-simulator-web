/**
 * 文件：src/domain/verify.ts
 * 用途：Verify Configuration 功能的纯函数实现 —— 校验集群配置合法性并输出 error/warning 清单
 *       （对应 Windows 版 Task 面板的 Verify Configuration）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { AttrSchemaItem } from './types.js'

/** 单条校验结论 */
export interface VerifyItem {
  level: 'error' | 'warning'
  target: string
  message: string
}

/** 校验结果：ok = 无 error（warning 不拦截启动） */
export interface VerifyResult {
  ok: boolean
  items: VerifyItem[]
}

/** 待校验的集群模型（与 tree API 的中间结构一致，由仓储层组装） */
export interface VerifyInput {
  clusterName: string
  systems: { name: string }[]
  groups: {
    name: string
    systemList: { name: string; priority: number }[]
    resources: {
      name: string
      typeCode: string
      attrs: Record<string, string>
      schema: AttrSchemaItem[]
      parents: string[] // 依赖的父资源名
    }[]
  }[]
}

/** 资源合法命名：VCS 惯例为字母/数字/下划线 */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * 校验集群配置：
 * 1. 节点数 ≥ 1；服务组数 ≥ 1
 * 2. 名称合法性（集群/组/资源）
 * 3. 依赖图无环（DFS 三色标记）
 * 4. 类型必填属性已设置
 * 5. 依赖目标存在
 * @param input 集群模型
 * @returns 校验结果（含全部 error/warning 明细）
 */
export function verifyCluster(input: VerifyInput): VerifyResult {
  const items: VerifyItem[] = []
  const err = (target: string, message: string) => items.push({ level: 'error', target, message })
  const warn = (target: string, message: string) => items.push({ level: 'warning', target, message })

  // ---- 1. 结构完整性 ----
  if (input.systems.length < 1) err(input.clusterName, '集群至少需要 1 个节点(system)')
  if (input.groups.length < 1) warn(input.clusterName, '集群内没有服务组，启动后无任何可监控内容')

  // ---- 2. 命名 ----
  if (!NAME_RE.test(input.clusterName)) err(input.clusterName, '集群名不合法（需字母开头，仅字母/数字/下划线）')

  // ---- 3. 逐组校验 ----
  for (const g of input.groups) {
    if (!NAME_RE.test(g.name)) err(g.name, '服务组名不合法')

    // 组必须声明可运行节点
    if (g.systemList.length < 1) err(g.name, '服务组未配置 SystemList（无任何可运行节点）')

    if (g.resources.length < 1) warn(g.name, '服务组内没有资源')

    const nameSet = new Set(g.resources.map((r) => r.name))
    for (const r of g.resources) {
      if (!NAME_RE.test(r.name)) err(r.name, '资源名不合法')

      // 必填属性检查
      for (const s of r.schema) {
        if (s.required && !(r.attrs[s.key] ?? '').trim()) {
          err(r.name, `类型 ${r.typeCode} 的必填属性 ${s.key} 未设置`)
        }
      }

      // 依赖目标存在 + 环检测建图
      for (const p of r.parents) {
        if (!nameSet.has(p)) err(r.name, `依赖的资源 ${p} 不存在（组内）`)
      }
    }

    // ---- 4. 环检测：child → parent 有向图，DFS 遇到灰色节点即有环 ----
    const adj = new Map<string, string[]>()
    for (const r of g.resources) adj.set(r.name, [...r.parents])
    const color = new Map<string, 0 | 1 | 2>() // 0=白 1=灰 2=黑
    const dfs = (n: string): boolean => {
      color.set(n, 1)
      for (const m of adj.get(n) ?? []) {
        if (!nameSet.has(m)) continue // 不存在的依赖已单独报错
        const c = color.get(m) ?? 0
        if (c === 1) {
          err(n, `依赖关系存在环：${n} → ${m} → ... → ${n}`)
          return true
        }
        if (c === 0 && dfs(m)) return true
      }
      color.set(n, 2)
      return false
    }
    for (const r of g.resources) {
      if ((color.get(r.name) ?? 0) === 0) dfs(r.name)
    }
  }

  return { ok: items.every((i) => i.level !== 'error'), items }
}
