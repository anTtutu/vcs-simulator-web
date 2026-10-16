/**
 * 文件：src/events/bus.ts
 * 用途：引擎事件总线 + SSE 客户端管理 —— 引擎唯一的对外状态广播通道
 *       前端动画完全由这里推送的事件序列驱动（设计报告 §4.4）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Response } from 'express'
import type { EngineEvent } from '../domain/types.js'

/** 已连接的 SSE 客户端 */
interface SseClient {
  res: Response
  /** 只接收该集群的事件；'*' 表示全部 */
  clusterId: number | '*'
}

/**
 * 事件总线：引擎 publish → 按 clusterId 过滤推送给 SSE 客户端
 * 事件携带全局递增 seq，前端按 seq 回放即为动画时间线
 */
export class EventBus {
  private clients = new Set<SseClient>()
  private seq = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null

  constructor() {
    // 25s 心跳注释行，防止代理层空闲断连
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(':hb\n\n')
    }, 25_000)
    // 进程退出时清理
    this.heartbeat.unref?.()
  }

  /**
   * 发布引擎事件：写日志由调用方负责，这里只做广播
   * @param type 事件类型
   * @param clusterId 归属集群
   * @param payload 事件体
   */
  publish(type: EngineEvent['type'], clusterId: number, payload: Record<string, unknown>): void {
    const evt: EngineEvent = { seq: ++this.seq, ts: Date.now(), type, clusterId, payload }
    const frame = `data: ${JSON.stringify(evt)}\n\n`
    for (const c of this.clients) {
      if (c.clusterId === '*' || c.clusterId === clusterId) c.res.write(frame)
    }
  }

  /**
   * 注册 SSE 客户端（已在路由层写好响应头）
   * @param res Express 响应对象
   * @param clusterId 订阅的集群 id 或 '*' 全部
   */
  subscribe(res: Response, clusterId: number | '*'): void {
    const client: SseClient = { res, clusterId }
    this.clients.add(client)
    // 客户端断开时移除，防泄漏
    res.on('close', () => this.clients.delete(client))
  }

  /** 当前在线客户端数（健康检查用） */
  get clientCount(): number {
    return this.clients.size
  }
}
