/**
 * 文件：test/phase2.spec.ts
 * 用途：二期功能测试 —— AutoStartList / 心跳脑裂冻结 / 快照回滚 / 自定义类型 / Global 分组 / 角色权限 / 剧本
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { LAYER_STEP_MS, RESOURCE_START_MS } from '../src/domain/timings.js'

let ctx: TestCtx
beforeAll(() => {
  ctx = createTestCtx()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterAll(() => {
  vi.useRealTimers()
  cleanupCtx(ctx)
})

async function settle(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('AutoStartList 自动上线（P1-3）', () => {
  it('集群启动后按 AutoStartList 自动编排组上线', async () => {
    const cid = await (async () => {
      const id = clusterIdByName(ctx, 'LIN_NFS')
      ctx.engine.start(id)
      await settle(2200)
      return id
    })()
    // autostart 在启动完成后 600ms 触发，编排 7 资源
    await settle(600 + LAYER_STEP_MS * 8 + RESOURCE_START_MS * 8 + 300)
    const g = ctx.repo.getTree(cid).groups[0]
    expect(g.state).toBe('ONLINE')
    expect(g.currentSystem).toBe('sys1')
    ctx.groupEngine.stopMonitor(cid)
  }, 20000)
})

describe('心跳断链与脑裂冻结（P1-1）', () => {
  it('单链断 = 降级可编排；双链断 = 脑裂冻结（409）；恢复后解除', async () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    // 启动集群（autostart 顺带把组上线，作为基线）
    ctx.engine.start(cid)
    await settle(2400 + LAYER_STEP_MS * 10 + RESOURCE_START_MS * 10 + 500)
    ctx.groupEngine.stopMonitor(cid)
    const gid = ctx.repo.getTree(cid).groups[0].id
    expect(ctx.repo.getGroup(gid)!.state).toBe('ONLINE')

    // 优雅下线回到基线
    ctx.groupEngine.groupOffline(gid)
    await settle(LAYER_STEP_MS * 10 + 1200)
    expect(ctx.repo.getGroup(gid)!.state).toBe('OFFLINE')

    // 单链断：降级仍可编排
    ctx.groupEngine.setLink(cid, 'link0', 'DOWN')
    expect(ctx.groupEngine.isSplit(cid)).toBe(false)
    expect(() => ctx.groupEngine.groupOnline(gid, 'sys1')).not.toThrow()

    // 双链断：脑裂冻结
    ctx.groupEngine.setLink(cid, 'link1', 'DOWN')
    expect(ctx.groupEngine.isSplit(cid)).toBe(true)
    expect(() => ctx.groupEngine.groupOnline(gid, 'sys1')).toThrowError(/脑裂/)

    // 恢复 link0：解除冻结（此时组已在 sys1 编排上线中）
    ctx.groupEngine.setLink(cid, 'link0', 'UP')
    expect(ctx.groupEngine.isSplit(cid)).toBe(false)
    await settle(LAYER_STEP_MS * 10 + RESOURCE_START_MS * 10 + 500)
    expect(ctx.repo.getGroup(gid)!.state).toBe('ONLINE')

    // 心跳归位
    ctx.groupEngine.setLink(cid, 'link1', 'UP')
    expect(ctx.groupEngine.isSplit(cid)).toBe(false)
  }, 40000)
})

describe('配置快照回滚（P2-1）', () => {
  it('拍快照 → 改属性 → 回滚 → 属性还原', async () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const g = ctx.repo.getTree(cid).groups[0]
    const lsnr = g.resources.find((r) => r.name === 'LSNR_oraprod_lsnr')!

    // 1) 拍快照
    const snap = await request(ctx.app).post(`/api/clusters/${cid}/snapshots`).send({ label: '测试基线' })
    expect(snap.status).toBe(201)

    // 2) 修改属性
    await request(ctx.app)
      .put(`/api/resources/${lsnr.id}/attributes`)
      .send({ attrs: { Owner: 'MODIFIED' }, overrides: [] })
      .set('X-VCS-Role', 'Administrator')
    expect(ctx.repo.getTree(cid).groups[0].resources.find((r) => r.id === lsnr.id)!.attrs['Owner']).toBe('MODIFIED')

    // 3) 回滚要求 STOPPED：上一用例结束时集群在 RUNNING，先停止
    if (ctx.repo.getCluster(cid).status === 'RUNNING') {
      ctx.engine.stop(cid)
      await settle(2200)
    }
    expect(ctx.repo.getCluster(cid).status).toBe('STOPPED')

    const list = await request(ctx.app).get(`/api/clusters/${cid}/snapshots`)
    const sid = (list.body as { id: number }[])[0].id
    const restore = await request(ctx.app).post(`/api/snapshots/${sid}/restore`)
    expect(restore.status).toBe(200)

    const after = ctx.repo.getTree(cid).groups[0].resources.find((r) => r.name === 'LSNR_oraprod_lsnr')!
    expect(after.attrs['Owner']).toBe('oraprod')
    expect(after.attrs['Listener']).toBe('LISTENER_PROD')
  }, 30000)
})

describe('自定义 Agent 类型（P2-2）', () => {
  it('新建 → 被命名前缀匹配用于导入 → 引用时删除被拒 → 删资源后可删', async () => {
    // 新建 MyCache 类型
    const created = await request(ctx.app)
      .post('/api/resource-types')
      .send({ code: 'MyCache', label: '缓存', attrs: [{ key: 'CacheName', label: '缓存名', required: true }] })
    expect(created.status).toBe(201)
    const tid = created.body.id as number

    // 用该类型建资源（REST）
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const gid = ctx.repo.getTree(cid).groups[0].id
    const res = await request(ctx.app)
      .post(`/api/groups/${gid}/resources`)
      .send({ name: 'MyCache_1', typeCode: 'MyCache', attrs: { CacheName: 'c1' } })
    expect(res.status).toBe(201)

    // 引用中删除被拒
    const del1 = await request(ctx.app).delete(`/api/resource-types/${tid}`)
    expect(del1.status).toBe(409)

    // 删资源后再删类型成功
    await request(ctx.app).delete(`/api/resources/${res.body.id}`)
    const del2 = await request(ctx.app).delete(`/api/resource-types/${tid}`)
    expect(del2.status).toBe(204)

    // builtin 类型不可删
    const types = ctx.repo.listResourceTypes()
    const builtin = types.find((t) => t.builtin)!
    const del3 = await request(ctx.app).delete(`/api/resource-types/${builtin.id}`)
    expect(del3.status).toBe(409)
  })
})

describe('Global 容灾分组（P0-1）', () => {
  it('建分组 → 列表含两站集群与组状态 → 删除', async () => {
    const c1 = clusterIdByName(ctx, 'SOL_ORA_SRDF_C1')
    const c2 = clusterIdByName(ctx, 'SOL_ORA_SRDF_C2')
    const created = await request(ctx.app)
      .post('/api/global')
      .send({ name: 'SRDF-ORA', clusterIds: [c1, c2] })
    expect(created.status).toBe(201)

    const list = await request(ctx.app).get('/api/global')
    const grp = (list.body as { name: string; clusters: { id: number; groups: { name: string }[] }[] }[]).find((x) => x.name === 'SRDF-ORA')!
    expect(grp.clusters).toHaveLength(2)
    expect(grp.clusters[0].groups.some((g) => g.name === 'ORA_PROD_Group')).toBe(true)

    const del = await request(ctx.app).delete(`/api/global/${(await request(ctx.app).get('/api/global')).body.find((x: { name: string }) => x.name === 'SRDF-ORA').id}`)
    expect(del.status).toBe(204)
  })
})

describe('角色权限（P2-3）', () => {
  it('Observer 变更被 403；查询放行；CLI 层同样拦截', async () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const gid = ctx.repo.getTree(cid).groups[0].id

    const denied = await request(ctx.app).post(`/api/groups/${gid}/online`).set('X-VCS-Role', 'Observer').send({ system: 'sys1' })
    expect(denied.status).toBe(403)
    const allowed = await request(ctx.app).get(`/api/clusters/${cid}/tree`).set('X-VCS-Role', 'Observer')
    expect(allowed.status).toBe(200)

    const cli = await request(ctx.app)
      .post(`/api/clusters/${cid}/console`)
      .set('X-VCS-Role', 'Observer')
      .send({ command: 'hastart' })
    expect(cli.body.output[0]).toContain('只读')
  })

  it('Operator 可查询可编排但不可建/删集群', async () => {
    const created = await request(ctx.app).post('/api/clusters').set('X-VCS-Role', 'Operator').send({ name: 'NO_RIGHT', platform: 'Linux' })
    expect(created.status).toBe(403)
    const del = await request(ctx.app).delete(`/api/clusters/${clusterIdByName(ctx, 'AIX_NFS')}`).set('X-VCS-Role', 'Operator')
    expect(del.status).toBe(403)
  })
})

describe('演练剧本（P1-4）', () => {
  it('brain-split 剧本：断链→脑裂→恢复全流程并产出叙事事件', async () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    ctx.groupEngine.stopMonitor(cid)
    // 快照回滚用例停了集群，这里重新启动（剧本要求 RUNNING）
    ctx.engine.start(cid)
    await settle(2400)
    const run = await request(ctx.app).post(`/api/clusters/${cid}/scenarios/brain-split/run`)
    expect(run.status).toBe(200)
    // 总时长约 5.6s
    await settle(6500)
    const events = ctx.repo.listEvents(cid, 40).filter((e) => e.action === 'SCENARIO')
    expect(events.length).toBeGreaterThanOrEqual(6)
    expect(ctx.groupEngine.isSplit(cid)).toBe(false)
  }, 20000)
})

describe('监控总览（P0-2）', () => {
  it('overview 聚合输出含计数与链路状态', async () => {
    const res = await request(ctx.app).get('/api/overview')
    expect(res.status).toBe(200)
    const row = (res.body as Record<string, unknown>[]).find((x) => x.name === 'SOL_ORACLE')
    expect(row).toBeTruthy()
    expect(row!.groupsTotal).toBe(1)
    expect(['Up', 'Degraded', 'Down']).toContain(row!.linkStatus)
  })
})
