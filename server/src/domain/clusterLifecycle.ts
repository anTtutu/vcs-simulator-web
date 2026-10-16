/**
 * 文件：src/domain/clusterLifecycle.ts
 * 用途：集群生命周期的纯函数规则 —— 合法状态迁移矩阵与校验（无 IO，便于单测）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { ClusterStatus } from './types.js'

/**
 * 合法状态迁移表（与 Windows 版观感一致）：
 * STOPPED --start--> STARTING --编排完成--> RUNNING --stop--> STOPPING --> STOPPED
 */
const ALLOWED: Record<ClusterStatus, ClusterStatus[]> = {
  STOPPED: ['STARTING'],
  STARTING: ['RUNNING'],
  RUNNING: ['STOPPING'],
  STOPPING: ['STOPPED'],
}

/**
 * 判断 from → to 是否为合法迁移
 * @param from 当前状态
 * @param to 目标状态
 * @returns 合法返回 true
 */
export function canTransition(from: ClusterStatus, to: ClusterStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to)
}

/** 启动/停止动画时长（ms）：模拟「Starting a cluster may take a few seconds」 */
export const CLUSTER_START_MS = 1800
export const CLUSTER_STOP_MS = 1200

/** 业务错误：携带 HTTP 语义，路由层直接透传 */
export class BizError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
