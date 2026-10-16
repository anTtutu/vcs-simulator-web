/**
 * 文件：tests/layout.spec.ts
 * 用途：分层布局算法单测 —— level 计算 / 坐标不重叠 / 顶层底层语义
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { describe, expect, it } from 'vitest'
import { computeLayeredLayout } from '../src/utils/layout'

/** 构造 SOL_ORACLE 截图同构拓扑：LSNR←ORA←{IP←NIC, Mount×2←Vol×2←DG} */
function oracleGraph() {
  const id = (n: string) => n
  const nodes = ['DG', 'V1', 'V2', 'M1', 'M2', 'NIC', 'IP', 'ORA', 'LSNR'].map((n) => ({ id: id(n) }))
  const links = [
    { childId: id('V1'), parentId: id('DG') },
    { childId: id('V2'), parentId: id('DG') },
    { childId: id('M1'), parentId: id('V1') },
    { childId: id('M2'), parentId: id('V2') },
    { childId: id('IP'), parentId: id('NIC') },
    { childId: id('ORA'), parentId: id('IP') },
    { childId: id('ORA'), parentId: id('M1') },
    { childId: id('ORA'), parentId: id('M2') },
    { childId: id('LSNR'), parentId: id('ORA') },
  ]
  return { nodes, links }
}

describe('computeLayeredLayout', () => {
  it('level 语义：DG/NIC 底层 0，LSNR 顶层 4（与截图一致）', () => {
    const { nodes, links } = oracleGraph()
    const pos = computeLayeredLayout(nodes, links)
    expect(pos.get('DG')!.level).toBe(0)
    expect(pos.get('NIC')!.level).toBe(0)
    expect(pos.get('V1')!.level).toBe(1)
    expect(pos.get('IP')!.level).toBe(1)
    expect(pos.get('M1')!.level).toBe(2)
    expect(pos.get('ORA')!.level).toBe(3)
    expect(pos.get('LSNR')!.level).toBe(4)
  })

  it('y 坐标：LSNR 在最上方（y 最小），DG 在最下方（y 最大）', () => {
    const { nodes, links } = oracleGraph()
    const pos = computeLayeredLayout(nodes, links)
    expect(pos.get('LSNR')!.y).toBeLessThan(pos.get('ORA')!.y)
    expect(pos.get('ORA')!.y).toBeLessThan(pos.get('M1')!.y)
    expect(pos.get('DG')!.y).toBeGreaterThan(pos.get('M1')!.y)
  })

  it('同层节点 x 不重叠（留有间距）', () => {
    const { nodes, links } = oracleGraph()
    const pos = computeLayeredLayout(nodes, links)
    // level=1 层有 V1/V2/IP 三个节点
    const xs = ['V1', 'V2', 'IP'].map((n) => pos.get(n)!.x).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(132)
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(132)
  })

  it('环不致死循环（环检测归 verify 负责，布局兜底 level=0）', () => {
    const nodes = [{ id: 'A' }, { id: 'B' }]
    const links = [
      { childId: 'A', parentId: 'B' },
      { childId: 'B', parentId: 'A' },
    ]
    // 只要不抛异常即通过
    const pos = computeLayeredLayout(nodes, links)
    expect(pos.size).toBe(2)
  })

  it('空图返回空结果', () => {
    expect(computeLayeredLayout([], []).size).toBe(0)
  })
})
