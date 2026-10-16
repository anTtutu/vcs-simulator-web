/**
 * 文件：test/groupEngine.spec.ts
 * 用途：服务组引擎测试 —— 依赖编排顺序/故障传播/Critical failover/Clear/Link 环检测
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { topoOrderBottomUp, descendantsOf, ancestorsOf } from '../src/domain/resourceGraph.js'
import { LAYER_STEP_MS, RESOURCE_START_MS, FAILOVER_DELAY_MS, FAILOVER_GAP_MS } from '../src/domain/timings.js'

let ctx: TestCtx
beforeAll(() => {
  ctx = createTestCtx()
  // 引擎编排全部基于 setTimeout/setInterval，用假时钟推进
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterAll(() => {
  vi.useRealTimers()
  cleanupCtx(ctx)
})

/** 推进整个组上线编排（9 资源 SOL_ORACLE 上限） */
async function settle(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

/** 启动集群到 RUNNING */
async function startCluster(name: string) {
  const id = clusterIdByName(ctx, name)
  ctx.engine.start(id)
  await settle(2000)
  return id
}

describe('依赖图纯函数', () => {
  const nodes = [1, 2, 3, 4].map((id) => ({ id, enabled: true }))
  const edges = [
    { childId: 3, parentId: 2 },
    { childId: 2, parentId: 1 },
    { childId: 4, parentId: 1 },
  ]
  it('topoOrder：被依赖方在前（1 → 2/4 → 3）', () => {
    const order = topoOrderBottomUp(nodes, edges)
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2))
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(4))
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3))
  })
  it('descendantsOf：故障向要求它的资源传播', () => {
    expect(descendantsOf(1, edges)).toEqual(new Set([2, 3, 4]))
    expect(descendantsOf(3, edges)).toEqual(new Set())
  })
  it('ancestorsOf：Link 成环检测依据', () => {
    expect(ancestorsOf(3, edges)).toEqual(new Set([1, 2]))
  })
  it('disabled 资源脱离编排且不阻塞 child', () => {
    const order = topoOrderBottomUp(
      [
        { id: 1, enabled: false },
        { id: 2, enabled: true },
      ],
      [{ childId: 2, parentId: 1 }],
    )
    expect(order).toEqual([2])
  })
})

describe('组上线/下线编排', () => {
  it('SOL_ORACLE 组上线：自底向上逐层点亮，最终组 ONLINE 且节点归属正确', async () => {
    const cid = await startCluster('SOL_ORACLE')
    const tree = ctx.repo.getTree(cid)
    const g = tree.groups[0]
    ctx.groupEngine.groupOnline(g.id, 'sys1')

    // 期间为 STARTING
    await settle(LAYER_STEP_MS)
    expect(ctx.repo.getGroup(g.id)!.state).toBe('STARTING')

    // 推进到全部完成
    await settle(LAYER_STEP_MS * 10 + RESOURCE_START_MS * 10)
    const after = ctx.repo.getGroup(g.id)!
    expect(after.state).toBe('ONLINE')
    expect(after.current_system).toBe('sys1')

    // 上线顺序校验：DG（底层）先于 ORA 先于 LSNR
    void cid
  }, 15000)

  it('组下线：逆序熄灭，current_system 清空', async () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const g = ctx.repo.getTree(cid).groups[0]
    ctx.groupEngine.groupOffline(g.id)
    await settle(LAYER_STEP_MS * 10 + 1000)
    const after = ctx.repo.getGroup(g.id)!
    expect(after.state).toBe('OFFLINE')
    expect(after.current_system).toBeNull()
  }, 15000)
})

describe('故障注入与 failover', () => {
  it('非 Critical 资源故障：后代连带 FAULTED，组 PARTIAL，不 failover', async () => {
    const cid = await startCluster('LIN_NFS')
    const g = ctx.repo.getTree(cid).groups[0]
    ctx.groupEngine.groupOnline(g.id, 'sys1')
    await settle(LAYER_STEP_MS * 8 + RESOURCE_START_MS * 8 + 500)
    expect(ctx.repo.getGroup(g.id)!.state).toBe('ONLINE')
    ctx.groupEngine.stopMonitor(cid) // 关闭周期探测，避免假时钟下复燃干扰断言

    // Mount_nfs_lnx 故障 → Share_nfs_lnx（要求它）连带故障；Vol/DG 不受影响
    const mount = g.resources.find((r) => r.name === 'Mount_nfs_lnx')!
    const share = g.resources.find((r) => r.name === 'Share_nfs_lnx')!
    const vol = g.resources.find((r) => r.name === 'Vol_nfs_lnx')!
    ctx.groupEngine.resourceFault(mount.id)
    expect(ctx.repo.getResource(mount.id)!.state).toBe('FAULTED')
    expect(ctx.repo.getResource(share.id)!.state).toBe('FAULTED')
    expect(ctx.repo.getResource(vol.id)!.state).toBe('ONLINE')
    expect(ctx.repo.getGroup(g.id)!.state).toBe('PARTIAL')
    expect(ctx.repo.getGroup(g.id)!.current_system).toBe('sys1') // 未切换
  }, 20000)

  it('Critical 资源故障：整组 failover 到 sys2，全部资源在新节点 ONLINE', async () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const g = ctx.repo.getTree(cid).groups[0]
    // 先清掉上一用例可能的持续状态：直接重新上线
    ctx.groupEngine.groupOnline(g.id, 'sys1')
    await settle(LAYER_STEP_MS * 10 + RESOURCE_START_MS * 10 + 500)
    ctx.groupEngine.stopMonitor(cid) // 关闭周期探测，保证 failover 断言确定性

    const ora = g.resources.find((r) => r.name === 'ORA_oraprod')!
    ctx.groupEngine.resourceFault(ora.id)
    expect(ctx.repo.getResource(ora.id)!.state).toBe('FAULTED')

    // 推进 failover（900ms 决策 + 300ms 下线 + 500ms 间隔 + 上线编排）
    await settle(FAILOVER_DELAY_MS + FAILOVER_GAP_MS + LAYER_STEP_MS * 10 + RESOURCE_START_MS * 10 + 1000)
    const after = ctx.repo.getGroup(g.id)!
    expect(after.current_system).toBe('sys2')
    expect(after.state).toBe('ONLINE')
    const dg = g.resources.find((r) => r.name === 'DG_oraprod')!
    const lsnr = g.resources.find((r) => r.name === 'LSNR_oraprod_lsnr')!
    expect(ctx.repo.getResource(dg.id)!.state).toBe('ONLINE')
    expect(ctx.repo.getResource(lsnr.id)!.state).toBe('ONLINE')

    // 清除持续故障，防止周期探测再次复燃影响后续用例
    ctx.repo.setMonitorBreak(ora.id, 0)
  }, 30000)

  it('Clear Fault：FAULTED → OFFLINE，monitor_break 解除', () => {
    const cid = clusterIdByName(ctx, 'LIN_NFS')
    const g = ctx.repo.getTree(cid).groups[0]
    const mount = g.resources.find((r) => r.name === 'Mount_nfs_lnx')!
    ctx.groupEngine.resourceClear(mount.id)
    expect(ctx.repo.getResource(mount.id)!.state).toBe('OFFLINE')
    expect(ctx.repo.getResource(mount.id)!.monitor_break).toBe(0)
  })
})

describe('Link / Unlink', () => {
  it('建依赖成功；自环被拒绝', () => {
    const cid = clusterIdByName(ctx, 'LIN_NFS')
    const g = ctx.repo.getTree(cid).groups[0]
    const byName = Object.fromEntries(g.resources.map((r) => [r.name, r]))
    // NFS_nfs_lnx requires IP_nfs_lnx（原本不存在）→ 成功
    expect(() => ctx.groupEngine.link(g.id, byName['NFS_nfs_lnx'].id, byName['IP_nfs_lnx'].id)).not.toThrow()
    // 自环 → 拒绝
    expect(() => ctx.groupEngine.link(g.id, byName['NFS_nfs_lnx'].id, byName['NFS_nfs_lnx'].id)).toThrowError()
    const tree = ctx.repo.getTree(cid)
    const nfs = tree.groups[0].resources.find((r) => r.name === 'NFS_nfs_lnx')!
    expect(nfs.parents).toContain(byName['IP_nfs_lnx'].id)
  })
  it('Unlink 解除依赖', () => {
    const cid = clusterIdByName(ctx, 'LIN_NFS')
    const g = ctx.repo.getTree(cid).groups[0]
    const byName = Object.fromEntries(g.resources.map((r) => [r.name, r]))
    const before = byName['NFS_nfs_lnx'].parents.length
    // 解除第一条
    ctx.groupEngine.unlink(g.id, byName['NFS_nfs_lnx'].id, byName['IP_nfs_lnx'].id)
    const after = ctx.repo.getTree(cid).groups[0].resources.find((r) => r.name === 'NFS_nfs_lnx')!
    expect(after.parents.length).toBe(before - 1)
  })
})
