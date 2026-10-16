/**
 * 文件：test/probeScript.spec.ts
 * 用途：MonScript 自定义探测脚本测试 —— 沙箱执行 / 引擎探测联动 / 黑名单防护
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { runProbeScript } from '../src/domain/probeScript.js'
import { LAYER_STEP_MS, RESOURCE_START_MS, PROBE_INTERVAL_MS } from '../src/domain/timings.js'

let ctx: TestCtx
beforeAll(() => {
  ctx = createTestCtx()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterAll(() => {
  vi.useRealTimers()
  cleanupCtx(ctx)
})

describe('runProbeScript 沙箱', () => {
  it('按属性判故障：Listener 为空 → FAULTED', () => {
    const r = runProbeScript(`return attrs.Listener ? 'ONLINE' : 'FAULTED'`, { Listener: '' }, 'ONLINE', 0.9)
    expect(r.ok).toBe(true)
    expect(r.verdict).toBe('FAULTED')
  })
  it('概率脚本：random < 0.1', () => {
    expect(runProbeScript(`return random < 0.1 ? 'FAULTED' : 'ONLINE'`, {}, 'ONLINE', 0.05).verdict).toBe('FAULTED')
    expect(runProbeScript(`return random < 0.1 ? 'FAULTED' : 'ONLINE'`, {}, 'ONLINE', 0.5).verdict).toBe('ONLINE')
  })
  it('黑名单：循环被拒绝且视为健康', () => {
    const r = runProbeScript(`while (true) {}`, {}, 'ONLINE', 0.5)
    expect(r.ok).toBe(false)
    expect(r.verdict).toBe('ONLINE')
    expect(r.error).toContain('while')
  })
  it('语法错误 → ok=false 健康', () => {
    const r = runProbeScript(`return !!!`, {}, 'ONLINE', 0.5)
    expect(r.ok).toBe(false)
  })
})

describe('引擎探测联动（MonScript 真实生效）', () => {
  it('周期监控执行脚本：判 FAULTED → 资源故障 + 事件留痕', async () => {
    const cid = clusterIdByName(ctx, 'LIN_NFS')
    ctx.engine.start(cid)
    await vi.advanceTimersByTimeAsync(2200)
    // 等 autostart 完成上线
    await vi.advanceTimersByTimeAsync(600 + LAYER_STEP_MS * 8 + RESOURCE_START_MS * 8 + 500)
    ctx.groupEngine.stopMonitor(cid) // 关默认监控，改用受控探测

    const g = ctx.repo.getTree(cid).groups[0]
    const nfs = g.resources.find((r) => r.name === 'NFS_nfs_lnx')!

    // 给 NFS 资源写一个必然故障的探测脚本
    await request(ctx.app)
      .put(`/api/resources/${nfs.id}/attributes`)
      .send({ attrs: { Nservers: '10', Protocol: 'UDP', MonScript: `return 'FAULTED'` }, overrides: [] })

    // 手动触发一轮探测（与 probeAll 同路径；resourceProbe 已 async 化需 await）
    await ctx.groupEngine.resourceProbe(nfs.id)
    expect(ctx.repo.getResource(nfs.id)!.state).toBe('FAULTED')
    // 脚本判定留痕
    const events = ctx.repo.listEvents(cid, 20).map((e) => e.action)
    expect(events).toContain('PROBE_SCRIPT')

    // 清理：解除脚本与故障，避免影响其他用例
    await request(ctx.app)
      .put(`/api/resources/${nfs.id}/attributes`)
      .send({ attrs: { Nservers: '10', Protocol: 'UDP', MonScript: '' }, overrides: [] })
    ctx.groupEngine.resourceClear(nfs.id)
  }, 30000)

  it('testscript 端点：试跑不落库', async () => {
    const cid = clusterIdByName(ctx, 'LIN_NFS')
    const g = ctx.repo.getTree(cid).groups[0]
    const nfs = g.resources.find((r) => r.name === 'NFS_nfs_lnx')!
    const res = await request(ctx.app).post(`/api/resources/${nfs.id}/testscript`).send({ script: `return 'ONLINE'` })
    expect(res.body).toMatchObject({ ok: true, verdict: 'ONLINE' })
    expect(ctx.repo.getResource(nfs.id)!.state).toBe('OFFLINE') // 未被引擎变更
  })
})
