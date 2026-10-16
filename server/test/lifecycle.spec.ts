/**
 * 文件：test/lifecycle.spec.ts
 * 用途：集群生命周期测试 —— 状态迁移矩阵、启停编排、并发防护、删除约束、Verify
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { BizError, canTransition } from '../src/domain/clusterLifecycle.js'
import { verifyCluster } from '../src/domain/verify.js'

let ctx: TestCtx
beforeAll(() => {
  ctx = createTestCtx()
  // 仅伪造 setTimeout/clearTimeout（引擎编排用）；其余保持真实定时器以免影响 supertest 网络栈
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterAll(() => {
  vi.useRealTimers()
  cleanupCtx(ctx)
})

describe('状态迁移矩阵', () => {
  it('合法链路：STOPPED→STARTING→RUNNING→STOPPING→STOPPED', () => {
    expect(canTransition('STOPPED', 'STARTING')).toBe(true)
    expect(canTransition('STARTING', 'RUNNING')).toBe(true)
    expect(canTransition('RUNNING', 'STOPPING')).toBe(true)
    expect(canTransition('STOPPING', 'STOPPED')).toBe(true)
  })
  it('非法迁移全部拒绝', () => {
    expect(canTransition('STOPPED', 'RUNNING')).toBe(false) // 不允许跳过 STARTING
    expect(canTransition('STOPPED', 'STOPPING')).toBe(false)
    expect(canTransition('RUNNING', 'STARTING')).toBe(false)
  })
})

describe('集群启停编排（引擎）', () => {
  it('start：STOPPED → STARTING →(1.8s)→ RUNNING，节点 ONLINE', async () => {
    const id = clusterIdByName(ctx, 'LIN_NFS')
    ctx.engine.start(id)
    expect(ctx.repo.getCluster(id).status).toBe('STARTING')

    await vi.advanceTimersByTimeAsync(2000)
    expect(ctx.repo.getCluster(id).status).toBe('RUNNING')
    const sys = ctx.repo.listSystems(id)
    expect(sys.every((s) => s.status === 'ONLINE')).toBe(true)
  })

  it('启动过程中重复 start 被拒绝（409）', async () => {
    const id = clusterIdByName(ctx, 'HP_NFS')
    ctx.engine.start(id)
    expect(() => ctx.engine.start(id)).toThrowError(BizError)
    await vi.advanceTimersByTimeAsync(2000)

    // RUNNING 状态重复 start 同样拒绝
    expect(() => ctx.engine.start(id)).toThrowError(BizError)
  })

  it('stop：RUNNING → STOPPING →(1.2s)→ STOPPED，节点 OFFLINE', async () => {
    const id = clusterIdByName(ctx, 'LIN_NFS')
    ctx.engine.stop(id)
    expect(ctx.repo.getCluster(id).status).toBe('STOPPING')
    await vi.advanceTimersByTimeAsync(1500)
    expect(ctx.repo.getCluster(id).status).toBe('STOPPED')
    expect(ctx.repo.listSystems(id).every((s) => s.status === 'OFFLINE')).toBe(true)
  })
})

describe('REST API（supertest）', () => {
  it('GET /api/clusters 返回 18 个种子集群', async () => {
    const res = await request(ctx.app).get('/api/clusters')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(25)
  })

  it('POST /api/clusters 新建集群：端口自动分配、节点生成', async () => {
    const res = await request(ctx.app).post('/api/clusters').send({ name: 'MY_TEST', platform: 'Linux', systemCount: 2 })
    expect(res.status).toBe(201)
    expect(res.body.simulator_port).toBe(15579)
    expect(res.body.systems).toHaveLength(2)
  })

  it('POST /api/clusters 重复名冲突 409', async () => {
    const res = await request(ctx.app).post('/api/clusters').send({ name: 'SOL_ORACLE', platform: 'Linux' })
    expect(res.status).toBe(409)
  })

  it('DELETE 运行中的集群被拒绝（409），停止后可删除', async () => {
    const id = clusterIdByName(ctx, 'MY_TEST')
    await request(ctx.app).post(`/api/clusters/${id}/start`)
    const del1 = await request(ctx.app).delete(`/api/clusters/${id}`)
    expect(del1.status).toBe(409)

    await vi.advanceTimersByTimeAsync(2000) // 启动完成
    await request(ctx.app).post(`/api/clusters/${id}/stop`)
    await vi.advanceTimersByTimeAsync(1500) // 停止完成
    const del2 = await request(ctx.app).delete(`/api/clusters/${id}`)
    expect(del2.status).toBe(204)
  })

  it('GET tree：SOL_ORACLE 返回组/资源/依赖完整结构', async () => {
    const id = clusterIdByName(ctx, 'SOL_ORACLE')
    const res = await request(ctx.app).get(`/api/clusters/${id}/tree`)
    expect(res.status).toBe(200)
    expect(res.body.systems).toHaveLength(2)
    const grp = res.body.groups[0]
    expect(grp.resources).toHaveLength(9)
    // LSNR 依赖 ORA；DG 无父（拓扑底层）
    const lsnr = grp.resources.find((r: { name: string }) => r.name === 'LSNR_oraprod_lsnr')
    const ora = grp.resources.find((r: { name: string }) => r.name === 'ORA_oraprod')
    const dg = grp.resources.find((r: { name: string }) => r.name === 'DG_oraprod')
    expect(lsnr.parents).toContain(ora.id)
    expect(dg.parents).toHaveLength(0)
    expect(dg.children).toHaveLength(2)
  })

  it('POST verify：SOL_ORACLE 配置合法（ok=true）', async () => {
    const id = clusterIdByName(ctx, 'SOL_ORACLE')
    const res = await request(ctx.app).post(`/api/clusters/${id}/verify`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('Verify 纯函数（域规则）', () => {
  const base = {
    clusterName: 'T',
    systems: [{ name: 'sys1' }],
    groups: [],
  }

  it('缺必填属性报 error', () => {
    const result = verifyCluster({
      ...base,
      groups: [
        {
          name: 'G1',
          systemList: [{ name: 'sys1', priority: 0 }],
          resources: [
            {
              name: 'IP_1',
              typeCode: 'IP',
              attrs: { Address: '1.1.1.1' }, // 缺 NetMask/Device
              schema: [
                { key: 'Address', label: 'IP', type: 'string', required: true },
                { key: 'NetMask', label: '掩码', type: 'string', required: true },
                { key: 'Device', label: '网卡', type: 'string', required: true },
              ],
              parents: [],
            },
          ],
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.items.filter((i) => i.level === 'error')).toHaveLength(2)
  })

  it('依赖成环报 error', () => {
    const mk = (name: string, parents: string[]) => ({
      name,
      typeCode: 'IP',
      attrs: {},
      schema: [],
      parents,
    })
    const result = verifyCluster({
      ...base,
      groups: [
        {
          name: 'G1',
          systemList: [{ name: 'sys1', priority: 0 }],
          resources: [mk('A', ['B']), mk('B', ['A'])],
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.items.some((i) => i.message.includes('环'))).toBe(true)
  })

  it('无服务组仅 warning，不判失败', () => {
    const result = verifyCluster({ ...base, groups: [] })
    expect(result.ok).toBe(true)
    expect(result.items[0].level).toBe('warning')
  })
})
