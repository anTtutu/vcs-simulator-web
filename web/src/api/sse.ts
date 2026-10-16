/**
 * 文件：src/api/sse.ts
 * 用途：SSE 客户端 —— 订阅引擎事件流，自动按 clusterId 过滤
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { EngineEvent } from './types'

/**
 * 打开 SSE 连接
 * @param clusterId 集群 id；不传订阅全部
 * @param onEvent 事件回调
 * @returns 关闭函数（组件卸载时调用）
 */
export function openEventStream(
  clusterId: number | undefined,
  onEvent: (evt: EngineEvent) => void,
): () => void {
  const url = clusterId ? `/api/events?clusterId=${clusterId}` : '/api/events'
  const es = new EventSource(url)
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data) as EngineEvent)
    } catch {
      /* 忽略坏帧 */
    }
  }
  return () => es.close()
}
