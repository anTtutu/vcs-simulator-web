/**
 * 文件：test/logger.spec.ts
 * 用途：调测日志模块测试 —— 分级过滤 / 按天落盘 / error 独立文件 / event_log 镜像 / client-logs 端点
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { logger } from '../src/logging/logger.js'
import { ymdOf } from './logger-helpers.js'

let ctx: TestCtx
let logDir: string
beforeAll(() => {
  ctx = createTestCtx()
  logDir = process.env.VCS_LOG_DIR!
})
afterAll(() => {
  cleanupCtx(ctx)
  try {
    fs.rmSync(logDir, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
})

function readLog(base: string): string {
  const file = path.join(logDir, `${base}-${ymdOf(new Date())}.log`)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
}

describe('logger 分级与落盘', () => {
  it('INFO 写入 server 文件；DEBUG 默认被过滤', () => {
    process.env.VCS_LOG_LEVEL = 'info'
    logger.info('test.mod', '可见的信息', { k: 1 })
    logger.debug('test.mod', '不应出现的信息')
    const content = readLog('server')
    expect(content).toContain('可见的信息')
    expect(content).toContain('[INFO ]')
    expect(content).toContain('"k":1')
    expect(content).not.toContain('不应出现的信息')
  })

  it('ERROR 同时写入 error 独立文件', () => {
    process.env.VCS_LOG_LEVEL = 'info'
    logger.error('test.mod', '发生了一个错误')
    expect(readLog('server')).toContain('发生了一个错误')
    expect(readLog('error')).toContain('发生了一个错误')
  })

  it('级别调到 error 后 info 被过滤', () => {
    process.env.VCS_LOG_LEVEL = 'error'
    logger.info('test.mod', 'error 级别下不可见')
    expect(readLog('server')).not.toContain('error 级别下不可见')
    process.env.VCS_LOG_LEVEL = 'info'
  })
})

describe('event_log 文件镜像', () => {
  it('insertEvent 同步落 event-YYYYMMDD.log（engine_A.log 观感）', () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    ctx.repo.insertEvent(cid, 'ERROR', 'RESOURCE', 'ORA_oraprod', 'FAULT', '镜像测试：持续故障')
    const content = readLog('event')
    expect(content).toContain('[ERROR] [RESOURCE] ORA_oraprod FAULT 镜像测试：持续故障')
  })
})

describe('HTTP 请求日志 + 前端错误上报端点', () => {
  it('4xx 请求产生 WARN 访问日志', async () => {
    process.env.VCS_LOG_LEVEL = 'info'
    await request(ctx.app).get('/api/nonexistent') // express 默认 404
    expect(readLog('server')).toMatch(/\[WARN \] \[http\] GET \/api\/nonexistent 404/)
  })

  it('POST /api/client-logs 落前端错误', async () => {
    const res = await request(ctx.app).post('/api/client-logs').send({ level: 'error', message: '前端渲染异常测试', url: 'http://x/y' })
    expect(res.status).toBe(204)
    expect(readLog('server')).toContain('前端渲染异常测试')
  })
})
