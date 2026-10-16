/**
 * 文件：src/engine/clusterEngine.ts
 * 用途：集群生命周期引擎（M1）—— 启动/停止编排、状态落库、SSE 广播、事件日志
 *       M2 将在此基础上扩展资源级状态机/依赖编排/failover
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Repo } from '../db/repo.js'
import type { EventBus } from '../events/bus.js'
import { BizError, CLUSTER_START_MS, CLUSTER_STOP_MS, canTransition } from '../domain/clusterLifecycle.js'

/**
 * 集群引擎：
 * - start: STOPPED → STARTING --(动画时长)--> RUNNING，节点全部 ONLINE
 * - stop : RUNNING → STOPPING --(动画时长)--> STOPPED，节点全部 OFFLINE
 * 所有迁移必须经过 canTransition 校验；启动/停止期间禁止并发重复操作
 */
export class ClusterEngine {
  /** 进行中的启停定时器，key = clusterId（防止重复操作 + 删除集群时清理） */
  private timers = new Map<number, ReturnType<typeof setTimeout>>()

  constructor(
    private repo: Repo,
    private bus: EventBus,
    /** 集群停止完成后的回调（GroupEngine 清理编排与监控、心跳归位） */
    private onStopped?: (clusterId: number) => void,
    /** 集群启动完成后的回调（GroupEngine AutoStartList 自动上线） */
    private onStarted?: (clusterId: number) => void,
  ) {}

  /**
   * 启动集群（对应 Windows 版 Start Cluster + 「Starting a cluster may take a few seconds」弹窗）
   * @param id 集群 id
   */
  start(id: number): void {
    const cluster = this.repo.getCluster(id)
    if (this.timers.has(id)) throw new BizError(409, `集群 ${cluster.name} 正在启停中，请稍候`)
    if (!canTransition(cluster.status, 'STARTING')) throw new BizError(409, `集群当前状态 ${cluster.status} 不允许启动`)

    // 1) 置 STARTING 并广播（前端弹等待框、状态图标转黄）
    this.repo.updateClusterStatus(id, 'STARTING')
    this.log(id, 'INFO', 'CLUSTER', cluster.name, 'START', '开始启动集群')
    this.bus.publish('cluster.status', id, { id, name: cluster.name, status: 'STARTING' })

    // 2) 延迟编排：到时置 RUNNING + 节点 ONLINE（模拟 HAD 完成组播与资源编排）
    const t = setTimeout(() => {
      this.timers.delete(id)
      this.repo.updateClusterStatus(id, 'RUNNING')
      this.repo.updateSystemStatusByCluster(id, 'ONLINE')
      this.log(id, 'INFO', 'CLUSTER', cluster.name, 'START_DONE', '集群启动完成，所有节点 ONLINE')
      this.bus.publish('cluster.status', id, { id, name: cluster.name, status: 'RUNNING' })
      this.bus.publish('system.status', id, { clusterId: id, status: 'ONLINE' })
      // AutoStartList 自动上线（P1-3）
      this.onStarted?.(id)
    }, CLUSTER_START_MS)
    this.timers.set(id, t)
  }

  /**
   * 停止集群（对应 Stop Cluster）
   * @param id 集群 id
   */
  stop(id: number): void {
    const cluster = this.repo.getCluster(id)
    if (this.timers.has(id)) throw new BizError(409, `集群 ${cluster.name} 正在启停中，请稍候`)
    if (!canTransition(cluster.status, 'STOPPING')) throw new BizError(409, `集群当前状态 ${cluster.status} 不允许停止`)

    this.repo.updateClusterStatus(id, 'STOPPING')
    this.log(id, 'INFO', 'CLUSTER', cluster.name, 'STOP', '开始停止集群')
    this.bus.publish('cluster.status', id, { id, name: cluster.name, status: 'STOPPING' })

    const t = setTimeout(() => {
      this.timers.delete(id)
      this.repo.updateClusterStatus(id, 'STOPPED')
      this.repo.updateSystemStatusByCluster(id, 'OFFLINE')
      this.log(id, 'INFO', 'CLUSTER', cluster.name, 'STOP_DONE', '集群已停止，所有节点 OFFLINE')
      this.bus.publish('cluster.status', id, { id, name: cluster.name, status: 'STOPPED' })
      this.bus.publish('system.status', id, { clusterId: id, status: 'OFFLINE' })
      // 通知组引擎：收敛未完成编排、关闭监控、资源状态归零
      this.onStopped?.(id)
      // 心跳链路归位（重启即恢复，模拟现场修复）
      this.repo.resetLinks(id)
    }, CLUSTER_STOP_MS)
    this.timers.set(id, t)
  }

  /** 该集群是否正在进行启停 */
  isBusy(id: number): boolean {
    return this.timers.has(id)
  }

  /** 删除集群前的清理：取消未完成的启停定时器 */
  cancelPending(id: number): void {
    const t = this.timers.get(id)
    if (t) {
      clearTimeout(t)
      this.timers.delete(id)
    }
  }

  /** 写事件日志 + log.append 广播（一步完成） */
  private log(
    clusterId: number,
    level: 'INFO' | 'WARN' | 'ERROR',
    scope: 'CLUSTER' | 'GROUP' | 'RESOURCE' | 'SYSTEM' | 'ENGINE',
    target: string,
    action: string,
    detail: string,
  ): void {
    this.repo.insertEvent(clusterId, level, scope, target, action, detail)
    this.bus.publish('log.append', clusterId, { level, scope, target, action, detail, ts: Date.now() })
  }
}
