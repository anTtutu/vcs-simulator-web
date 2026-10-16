/**
 * 文件：src/utils/layout.ts
 * 用途：依赖图分层布局 —— Auto Arrange 的核心算法
 *       语义对齐 Windows 版截图：requires 的资源在上层，被依赖的在底层
 *       （LSNR 顶层 → DG 底层），level = 到最底层被依赖方的高度
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 布局入参节点 */
export interface LayoutInputNode {
  id: number
}
/** 布局入参边：child requires parent（child 画在上层） */
export interface LayoutInputLink {
  childId: number
  parentId: number
}
/** 输出坐标 */
export interface LayoutPos {
  x: number
  y: number
  level: number
}
/** 布局选项（尺寸与间距） */
export interface LayoutOptions {
  nodeW?: number
  nodeH?: number
  gapX?: number
  gapY?: number
}

const DEFAULTS = { nodeW: 132, nodeH: 34, gapX: 36, gapY: 72 }

/**
 * 计算分层布局：
 * 1. level(n)：无被依赖方（无 children 边的 parent 方向）→ 0；否则 1 + max(children.level)
 *    （children = 要求 n 的资源，画在 n 上方）
 * 2. 层内排序：按子节点重心（barycenter）一轮排序，减少连线交叉
 * 3. 坐标：y 顶层为 0 向下递增；x 居中展开
 *
 * @param nodes 全部资源
 * @param links 全部依赖边（child requires parent）
 * @param opts 尺寸/间距
 * @returns id → {x,y,level}
 */
export function computeLayeredLayout(
  nodes: LayoutInputNode[],
  links: LayoutInputLink[],
  opts?: LayoutOptions,
): Map<number, LayoutPos> {
  const { nodeW, gapX, gapY } = { ...DEFAULTS, ...opts }

  // ---- 邻接：parentsOf = 该资源所依赖的资源（画在它下层） ----
  const parentsOf = new Map<number, number[]>()
  for (const l of links) {
    if (!parentsOf.has(l.childId)) parentsOf.set(l.childId, [])
    parentsOf.get(l.childId)!.push(l.parentId)
  }
  const ids = nodes.map((n) => n.id)
  const idSet = new Set(ids)

  // ---- 1. 递归求 level：level = 到最底层被依赖方的高度 ----
  //   无依赖（如 DG/NIC）→ 0（最底层）；requires 他人 → 1 + max(所依赖资源的 level)
  //   即 requires 别人的排在上层（LSNR 顶层 4，DG 底层 0）
  const levelOf = new Map<number, number>()
  const visiting = new Set<number>()
  const calcLevel = (id: number): number => {
    if (levelOf.has(id)) return levelOf.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const parents = (parentsOf.get(id) ?? []).filter((p) => idSet.has(p))
    const level = parents.length ? 1 + Math.max(...parents.map(calcLevel)) : 0
    visiting.delete(id)
    levelOf.set(id, level)
    return level
  }
  for (const id of ids) calcLevel(id)

  // ---- 2. 分层 + 层内 barycenter 排序（自底向上逐层定位） ----
  const maxLevel = Math.max(0, ...levelOf.values())
  const layers: number[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const id of ids) layers[levelOf.get(id)!].push(id)

  // 已定位下层资源（被依赖方）的重心 x：当前节点排在其所依赖资源的正上方附近
  const parentAvgX = new Map<number, number>()
  const pos = new Map<number, LayoutPos>()
  const layerW = (cnt: number) => cnt * (nodeW + gapX) - gapX

  for (let lv = 0; lv <= maxLevel; lv++) {
    const layer = layers[lv]
    if (!layer.length) continue
    // barycenter：已定位的被依赖资源（下层）平均 x
    const scored = layer.map((id) => {
      const parents = (parentsOf.get(id) ?? []).filter((p) => parentAvgX.has(p))
      const bc = parents.length ? parents.reduce((s, p) => s + parentAvgX.get(p)!, 0) / parents.length : Number.NaN
      return { id, bc }
    })
    // 无子节点的排右侧，有子节点的按重心排
    scored.sort((a, b) => {
      const av = Number.isNaN(a.bc) ? Number.MAX_VALUE : a.bc
      const bv = Number.isNaN(b.bc) ? Number.MAX_VALUE : b.bc
      return av - bv
    })
    const width = layerW(scored.length)
    scored.forEach((item, i) => {
      const x = -width / 2 + i * (nodeW + gapX)
      const y = (maxLevel - lv) * gapY // 顶层 y=0
      pos.set(item.id, { x, y, level: lv })
      parentAvgX.set(item.id, x + nodeW / 2)
    })
  }

  return pos
}
