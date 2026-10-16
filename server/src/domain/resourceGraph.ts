/**
 * 文件：src/domain/resourceGraph.ts
 * 用途：资源依赖图纯函数 —— 拓扑排序（上线顺序）、后代传播集合、父资源校验
 *       模型约定：link child requires parent；画布上 child 在上层；
 *       上线自底向上（parent 先），故障沿 child 方向（要求它的资源）向上传播
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 图节点最小结构 */
export interface GraphNode {
  id: number
  enabled: boolean
}
/** 图边：child requires parent */
export interface GraphEdge {
  childId: number
  parentId: number
}

/**
 * 上线顺序：自底向上（被依赖方在前）
 * 算法：BFS —— 无 parent 的资源（如 DG/NIC）先入队，再逐层加入其 child
 * @param nodes 组内全部资源
 * @param edges 组内依赖边
 * @returns 排序后的资源 id（上线顺序）；过滤 enabled=false
 */
export function topoOrderBottomUp(nodes: GraphNode[], edges: GraphEdge[]): number[] {
  const idSet = new Set(nodes.map((n) => n.id))
  const childrenOf = new Map<number, number[]>()
  const parentCount = new Map<number, number>()
  for (const n of nodes) parentCount.set(n.id, 0)
  for (const e of edges) {
    if (!idSet.has(e.childId) || !idSet.has(e.parentId)) continue // 悬空边防御
    if (!childrenOf.has(e.parentId)) childrenOf.set(e.parentId, [])
    childrenOf.get(e.parentId)!.push(e.childId)
    parentCount.set(e.childId, (parentCount.get(e.childId) ?? 0) + 1)
  }
  const enabledIds = nodes.filter((n) => n.enabled).map((n) => n.id)

  // BFS：parentCount 视角下，enabled 的父链先出队；disabled 资源不出队但其 child 的计数已计入？
  // 简化处理：disabled 资源视为"透明"——不参与顺序，也不阻塞 child（计数在入队时跳过 disabled 父）
  const queue: number[] = []
  for (const n of nodes) {
    if (!n.enabled) continue
    const parents = edges.filter((e) => e.childId === n.id).map((e) => e.parentId)
    const activeParentCount = parents.filter((p) => {
      const pn = nodes.find((x) => x.id === p)
      return pn?.enabled
    }).length
    if (activeParentCount === 0) queue.push(n.id)
  }
  const order: number[] = []
  const visited = new Set<number>()
  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    order.push(id)
    for (const child of childrenOf.get(id) ?? []) {
      if (!idSet.has(child)) continue
      const cn = nodes.find((x) => x.id === child)
      if (!cn?.enabled || visited.has(child)) continue
      // child 的未上线父计数减一，减到 0 才入队
      const parents = edges.filter((e) => e.childId === child).map((e) => e.parentId)
      const remaining = parents.filter((p) => {
        const pn = nodes.find((x) => x.id === p)
        return pn?.enabled && !visited.has(p)
      }).length
      if (remaining === 0) queue.push(child)
    }
  }
  void parentCount
  void enabledIds
  return order
}

/**
 * 求全部传递后代（要求它的资源及其传递闭包）——故障传播方向
 * @param resourceId 触发故障的资源
 * @param edges 组内依赖边
 * @returns 后代 id 集合（不含自身）
 */
export function descendantsOf(resourceId: number, edges: GraphEdge[]): Set<number> {
  const childrenOf = new Map<number, number[]>()
  for (const e of edges) {
    if (!childrenOf.has(e.parentId)) childrenOf.set(e.parentId, [])
    childrenOf.get(e.parentId)!.push(e.childId)
  }
  const result = new Set<number>()
  const stack = [resourceId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of childrenOf.get(cur) ?? []) {
      if (!result.has(c)) {
        result.add(c)
        stack.push(c)
      }
    }
  }
  return result
}

/**
 * 求直接与传递父集（它依赖的资源闭包）——Link 成环检测用
 * @param resourceId 资源
 * @param edges 组内依赖边
 * @returns 父集 id 集合（不含自身）
 */
export function ancestorsOf(resourceId: number, edges: GraphEdge[]): Set<number> {
  const parentsOf = new Map<number, number[]>()
  for (const e of edges) {
    if (!parentsOf.has(e.childId)) parentsOf.set(e.childId, [])
    parentsOf.get(e.childId)!.push(e.parentId)
  }
  const result = new Set<number>()
  const stack = [resourceId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const p of parentsOf.get(cur) ?? []) {
      if (!result.has(p)) {
        result.add(p)
        stack.push(p)
      }
    }
  }
  return result
}
