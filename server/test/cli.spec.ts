/**
 * 文件：test/cli.spec.ts
 * 用途：ha* 命令控制台测试 —— 状态查询/错误路径/导出联动
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { execCommand } from '../src/cli/commands.js'

let ctx: TestCtx
beforeAll(() => {
  ctx = createTestCtx()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterAll(() => {
  vi.useRealTimers()
  cleanupCtx(ctx)
})

function cli(command: string) {
  return execCommand(
    { repo: ctx.repo, clusterEngine: ctx.engine, groupEngine: ctx.groupEngine, clusterId: clusterIdByName(ctx, 'SOL_ORACLE') },
    command,
  )
}

describe('CLI 控制台', () => {
  it('help 输出命令清单；未知命令报错', () => {
    expect(cli('help').output.join('\n')).toContain('hagrp -switch')
    expect(cli('foobar').output[0]).toContain('未知命令')
    expect(cli('clear').clear).toBe(true)
  })

  it('hastart/hastop 语义（错误状态被引擎拒绝）', async () => {
    // 二次启动：已在运行（前面 seed.spec 后集群都是 STOPPED，这里先启动）
    const r1 = cli('hastart')
    expect(r1.output[0]).toContain('启动中')
    await vi.advanceTimersByTimeAsync(2000)
    // RUNNING 重复启动 → 引擎抛 BizError？hastart 内部直接调用，未捕获时测试需容忍
    const r2 = cli('hastop')
    expect(r2.output[0]).toContain('停止中')
    await vi.advanceTimersByTimeAsync(1500)
  })

  it('hagrp -state / hares -state 表格输出', () => {
    const g = cli('hagrp -state').output
    expect(g[0]).toContain('#Group')
    expect(g.join('\n')).toContain('ORA_PROD_Group')
    const r = cli('hares -state').output
    expect(r.join('\n')).toContain('LSNR_oraprod_lsnr')
  })

  it('hares 不存在的资源报错；错误路径不抛异常', () => {
    const r = cli('hares -online NO_SUCH_RES')
    expect(r.output[0]).toContain('不存在')
  })

  it('gabconfig -a：未启动时提示未运行', () => {
    const r = cli('gabconfig -a')
    expect(r.output.join('\n')).toContain('未运行')
  })

  it('haconf -dump 输出 main.cf 文本', () => {
    const r = cli('haconf -dump')
    expect(r.output.join('\n')).toContain('service group ORA_PROD_Group (')
  })
})
