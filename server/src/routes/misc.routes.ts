/**
 * 文件：src/routes/misc.routes.ts
 * 用途：元数据与 SSE 路由 —— 资源类型模板库、事件流订阅、健康检查
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { Router } from 'express'
import type { Repo } from '../db/repo.js'
import type { EventBus } from '../events/bus.js'
import { logger } from '../logging/logger.js'

/**
 * 组装元数据/SSE 路由
 * @param repo 数据仓储
 * @param bus 事件总线
 * @returns Express Router
 */
export function miscRoutes(repo: Repo, bus: EventBus): Router {
  const router = Router()

  /** 资源类型模板库（组件模板） */
  router.get('/resource-types', (_req, res) => {
    res.json(repo.listResourceTypes())
  })

  /**
   * SSE 事件流：/api/events?clusterId=1 或不传接收全部
   * 事件帧格式：data: {"seq":1,"ts":...,"type":"cluster.status",...}\n\n
   */
  router.get('/events', (req, res) => {
    const raw = req.query.clusterId
    const clusterId = raw ? Number(raw) : '*'
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx 直通
    })
    res.write('retry: 3000\n\n') // 断线 3s 自动重连
    bus.subscribe(res, clusterId)
  })

  /** 监控总览聚合（P0-2：多集群卡片墙数据源） */
  router.get('/overview', (_req, res) => {
    res.json(repo.overview())
  })

  /** 前端错误上报（P2 可观测性）：{ level, message, url?, stack? } → 落调试日志 */
  router.post('/client-logs', (req, res) => {
    const { level = 'error', message = '', url, stack } = req.body ?? {}
    const mod = 'web'
    const meta = { url, stack: String(stack ?? '').slice(0, 2000) }
    if (level === 'warn') logger.warn(mod, String(message).slice(0, 500), meta)
    else logger.error(mod, String(message).slice(0, 500), meta)
    res.status(204).end()
  })

  /** 健康检查 */
  router.get('/healthz', (_req, res) => {
    res.json({ ok: true, sseClients: bus.clientCount })
  })

  return router
}
