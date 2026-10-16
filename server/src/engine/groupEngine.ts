/**
 * 文件：src/engine/groupEngine.ts
 * 用途：服务组/资源仿真引擎（M2 核心）—— 依赖编排、故障注入与传播、Critical failover、
 *       probe 周期监控、属性变更事件；全部状态变更 = 事务落库 + SSE 广播
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Repo, TreeGroup } from '../db/repo.js'
import type { EventBus } from '../events/bus.js'
import { BizError } from '../domain/clusterLifecycle.js'
import { topoOrderBottomUp, descendantsOf, ancestorsOf, type GraphEdge } from '../domain/resourceGraph.js'
import { runProbeEntry } from '../domain/probeScript.js'
import { logger } from '../logging/logger.js'
import {
  LAYER_STEP_MS,
  RESOURCE_START_MS,
  RESOURCE_STOP_MS,
  FAILOVER_DELAY_MS,
  FAILOVER_GAP_MS,
  PROBE_INTERVAL_MS,
} from '../domain/timings.js'
import type { ResourceState } from '../domain/types.js'

/** 进行中的编排操作（可整体取消） */
interface RunningOp {
  timers: Set<ReturnType<typeof setTimeout>>
}

/**
 * 服务组引擎：
 * - groupOnline/groupOffline/groupSwitch：按依赖序逐层编排（波浪动画节奏）
 * - fault/clear/probe：资源级操作，含 Critical → 组 failover
 * - monitorLoop：每 PROBE_INTERVAL_MS 对 ONLINE 资源探测，monitor_break=1 复燃故障
 */
export class GroupEngine {
  /** groupId → 进行中操作 */
  private ops = new Map<number, RunningOp>()
  /** clusterId → AutoStart 挂起定时器（独立于 ops：挂起中不阻断人工操作，触发时自行让位） */
  private autoTimers = new Map<number, Set<ReturnType<typeof setTimeout>>>()
  /** clusterId → 监控定时器 */
  private monitors = new Map<number, ReturnType<typeof setInterval>>()
  /** groupId → 本轮已尝试 failover 的节点数（遍历完 SystemList 后停机等人工，对齐真实 VCS 语义） */
  private failoverTried = new Map<number, number>()

  // ==================== 心跳链路 / 脑裂（二期 P1-1） ====================

  /**
   * 设置心跳链路状态；双链全断 → 脑裂：集群进入冻结（AUTODISABLED 语义）
   * 单链断 = 降级（LLT 冗余心跳仍可通信）
   */
  setLink(clusterId: number, name: string, status: 'UP' | 'DOWN'): { name: string; status: string }[] {
    this.repo.getCluster(clusterId)
    const links = this.repo.setLinkStatus(clusterId, name, status)
    const down = links.filter((l) => l.status === 'DOWN').length
    if (down === 2) {
      this.repo.insertEvent(clusterId, 'ERROR', 'SYSTEM', name, 'SPLIT_BRAIN', '双心跳链路全部中断，集群脑裂：服务组冻结（AUTODISABLED），所有编排操作被阻止')
      this.bus.publish('log.append', clusterId, { level: 'ERROR', scope: 'SYSTEM', target: name, action: 'SPLIT_BRAIN', detail: '双心跳断链，集群脑裂冻结', split: true, ts: Date.now() })
    } else if (status === 'UP' && down === 1) {
      this.repo.insertEvent(clusterId, 'WARN', 'SYSTEM', name, 'LINK_RESTORED', '心跳链路恢复：脑裂解除（保留一条链路降级运行）')
      this.bus.publish('log.append', clusterId, { level: 'WARN', scope: 'SYSTEM', target: name, action: 'LINK_RESTORED', detail: '脑裂解除，恢复编排', split: false, ts: Date.now() })
    } else if (status === 'DOWN') {
      this.repo.insertEvent(clusterId, 'WARN', 'SYSTEM', name, 'LINK_DOWN', '单心跳中断：LLT 降级运行（冗余链路仍可用）')
      this.bus.publish('log.append', clusterId, { level: 'WARN', scope: 'SYSTEM', target: name, action: 'LINK_DOWN', detail: '单链路中断，降级运行', ts: Date.now() })
    }
    return links
  }

  /** 集群是否处于脑裂（双链全断；无链路记录视为未脑裂） */
  isSplit(clusterId: number): boolean {
    const links = this.repo.listLinks(clusterId)
    return links.length > 0 && links.every((l) => l.status === 'DOWN')
  }

  /** 脑裂守卫：冻结期间阻止一切编排（对齐 VCS AUTODISABLED） */
  private assertNotSplit(clusterId: number): void {
    if (this.isSplit(clusterId)) {
      throw new BizError(409, '集群脑裂中（双心跳断链），服务组已被冻结（AUTODISABLED）：请先恢复心跳链路')
    }
  }

  constructor(
    private repo: Repo,
    private bus: EventBus,
  ) {}

  // ==================== 内部工具 ====================

  /** 组数据（含资源与边） */
  private group(gid: number): TreeGroup {
    const tree = this.repo.findGroupTree(gid)
    if (!tree) throw new BizError(404, `服务组不存在: id=${gid}`)
    return tree
  }

  /** 依赖边数组 */
  private edges(g: TreeGroup): GraphEdge[] {
    return g.resources.flatMap((r) => r.parents.map((p) => ({ childId: r.id, parentId: p })))
  }

  /** 延迟执行一个步骤（登记到组操作，便于取消） */
  private step(gid: number, delay: number, fn: () => void): void {
    let op = this.ops.get(gid)
    if (!op) {
      op = { timers: new Set() }
      this.ops.set(gid, op)
    }
    const t = setTimeout(() => {
      op!.timers.delete(t)
      if (op!.timers.size === 0 && this.ops.get(gid) === op) this.ops.delete(gid)
      try {
        fn()
      } catch (err) {
        // 编排步骤失败必须留痕（含组上下文），供日志文件回溯
        logger.error('engine', '编排步骤执行失败', { gid, err: String(err) })
      }
    }, delay)
    op.timers.add(t)
  }

  /** 取消组的全部未完成步骤 */
  cancelGroupOps(gid: number): void {
    const op = this.ops.get(gid)
    if (!op) return
    for (const t of op.timers) clearTimeout(t)
    this.ops.delete(gid)
  }

  /** 取消集群内全部组的操作（集群停止/删除时） */
  cancelClusterOps(clusterId: number): void {
    this.cancelAutoStart(clusterId)
    const tree = this.repo.getTree(clusterId)
    for (const g of tree.groups) {
      this.cancelGroupOps(g.id)
      // 未完成的编排直接收敛到 OFFLINE
      for (const r of g.resources) {
        if (r.state === 'STARTING' || r.state === 'STOPPING') {
          this.repo.updateResourceState(r.id, 'OFFLINE')
        }
      }
      this.repo.updateGroup(g.id, 'OFFLINE', null)
    }
    this.stopMonitor(clusterId)
    // 集群已停，资源/组状态统一归零
    for (const g of tree.groups) {
      for (const r of g.resources) this.repo.updateResourceState(r.id, 'OFFLINE')
    }
  }

  /** 写事件日志 + 广播 */
  private log(clusterId: number, level: 'INFO' | 'WARN' | 'ERROR', scope: 'GROUP' | 'RESOURCE' | 'SYSTEM', target: string, action: string, detail: string): void {
    this.repo.insertEvent(clusterId, level, scope, target, action, detail)
    this.bus.publish('log.append', clusterId, { level, scope, target, action, detail, ts: Date.now() })
  }

  /** 资源状态变更（落库 + 广播） */
  private setResourceState(g: TreeGroup, rid: number, state: ResourceState): void {
    this.repo.updateResourceState(rid, state)
    const res = g.resources.find((r) => r.id === rid)
    this.bus.publish('resource.state', g.clusterId, {
      groupId: g.id,
      resourceId: rid,
      name: res?.name,
      state,
    })
  }

  /** 组状态变更（落库 + 广播；currentSystem 允许 undefined 归一为 null） */
  private setGroupState(g: TreeGroup, state: string, currentSystem?: string | null): void {
    this.repo.updateGroup(g.id, state, currentSystem ?? null)
    this.bus.publish('group.state', g.clusterId, { groupId: g.id, name: g.name, state, currentSystem: currentSystem ?? null })
  }

  /** 依据资源状态重算组状态并落库（OFFLINE/ONLINE/PARTIAL/FAULTED） */
  private recalcGroupState(g: TreeGroup): string {
    const active = g.resources.filter((r) => r.enabled)
    const states = active.map((r) => this.repo.getResource(r.id)?.state ?? r.state)
    let next: string
    if (!active.length) next = 'OFFLINE'
    else if (states.every((s) => s === 'ONLINE')) next = 'ONLINE'
    else if (states.every((s) => s === 'OFFLINE')) next = 'OFFLINE'
    else if (states.includes('FAULTED') && states.some((s) => s === 'ONLINE')) next = 'PARTIAL'
    else if (states.every((s) => s === 'FAULTED')) next = 'FAULTED'
    else if (states.every((s) => s === 'OFFLINE' || s === 'FAULTED')) next = 'FAULTED'
    else if (states.includes('STARTING')) next = 'STARTING'
    else next = 'PARTIAL'
    const cur = this.repo.getGroup(g.id)?.current_system ?? null
    this.setGroupState(g, next, cur)
    return next
  }

  // ==================== 组级编排 ====================

  /**
   * 服务组上线：自底向上逐层 STARTING/ONLINE（父先子后，波浪节奏）
   * @param gid 服务组 id
   * @param system 目标节点（缺省：autostartList[0] → systemList[0]）
   */
  groupOnline(gid: number, system?: string): void {
    const g = this.group(gid)
    const cluster = this.repo.getCluster(g.clusterId)
    if (cluster.status !== 'RUNNING') throw new BizError(409, `集群未运行，无法上线服务组`)
    this.assertNotSplit(g.clusterId)
    if (this.ops.has(gid)) throw new BizError(409, `服务组 ${g.name} 正在编排中，请稍候`)

    // 目标节点必须在 SystemList 内
    const target = system ?? g.autostartList[0] ?? g.systemList[0]?.name
    if (!target || !g.systemList.some((s) => s.name === target)) {
      throw new BizError(400, `目标节点 ${target ?? '(空)'} 不在服务组 SystemList 中`)
    }

    const order = topoOrderBottomUp(
      g.resources.map((r) => ({ id: r.id, enabled: r.enabled })),
      this.edges(g),
    )
    this.log(g.clusterId, 'INFO', 'GROUP', g.name, 'ONLINE', `开始在 ${target} 上线服务组（${order.length} 个资源）`)
    logger.debug('engine', '组上线编排开始', { gid, group: g.name, target, steps: order.length })
    this.setGroupState(g, 'STARTING', target)

    order.forEach((rid, i) => {
      this.step(gid, i * LAYER_STEP_MS, () => {
        this.setResourceState(g, rid, 'STARTING')
      })
      this.step(gid, i * LAYER_STEP_MS + RESOURCE_START_MS, () => {
        this.setResourceState(g, rid, 'ONLINE')
      })
    })
    // 全部完成后收敛组状态
    this.step(gid, order.length * LAYER_STEP_MS + RESOURCE_START_MS + 100, () => {
      const gg = this.group(gid)
      this.recalcGroupState(gg)
      this.failoverTried.set(gid, 0) // 人工上线成功 = 新一轮 failover 预算
      this.log(g.clusterId, 'INFO', 'GROUP', g.name, 'ONLINE_DONE', `服务组已在 ${target} 完成上线`)
      this.ensureMonitor(g.clusterId)
    })
  }

  /**
   * 服务组下线：自顶向下逐层 STOPPING/OFFLINE（子先父后）
   * @param gid 服务组 id
   */
  groupOffline(gid: number): void {
    const g = this.group(gid)
    this.assertNotSplit(g.clusterId)
    if (this.ops.has(gid)) throw new BizError(409, `服务组 ${g.name} 正在编排中，请稍候`)

    const order = topoOrderBottomUp(
      g.resources.map((r) => ({ id: r.id, enabled: r.enabled })),
      this.edges(g),
    ).reverse() // 下线为上线逆序

    this.log(g.clusterId, 'INFO', 'GROUP', g.name, 'OFFLINE', '开始下线服务组')
    this.setGroupState(g, 'STOPPING')

    order.forEach((rid, i) => {
      this.step(gid, i * LAYER_STEP_MS, () => this.setResourceState(g, rid, 'STOPPING'))
      this.step(gid, i * LAYER_STEP_MS + RESOURCE_STOP_MS, () => this.setResourceState(g, rid, 'OFFLINE'))
    })
    this.step(gid, order.length * LAYER_STEP_MS + RESOURCE_STOP_MS + 100, () => {
      const gg = this.group(gid)
      this.setGroupState(gg, 'OFFLINE', null)
      this.log(g.clusterId, 'INFO', 'GROUP', g.name, 'OFFLINE_DONE', '服务组已全部下线')
    })
  }

  /**
   * 服务组切换（hagrp -switch）：当前节点优雅下线 → 目标节点上线
   * @param gid 服务组 id
   * @param to 目标节点
   */
  groupSwitch(gid: number, to: string): void {
    const g = this.group(gid)
    const from = this.repo.getGroup(gid)?.current_system
    if (!from) throw new BizError(409, `服务组未在任何节点运行，无法切换`)
    if (from === to) throw new BizError(400, `服务组已在 ${to} 上运行`)
    if (!g.systemList.some((s) => s.name === to)) throw new BizError(400, `目标节点 ${to} 不在 SystemList 中`)

    this.log(g.clusterId, 'INFO', 'GROUP', g.name, 'SWITCH', `切换 ${from} → ${to}（failover 演练）`)
    // 先下线（当前编排完成后接上线）
    this.groupOffline(gid)
    const offlineSpan = topoOrderBottomUp(
      g.resources.map((r) => ({ id: r.id, enabled: r.enabled })),
      this.edges(g),
    ).length
    const offlineTotal = offlineSpan * LAYER_STEP_MS + RESOURCE_STOP_MS + 200
    this.step(gid, offlineTotal + FAILOVER_GAP_MS, () => {
      this.groupOnline(gid, to)
    })
  }

  // ==================== 资源级操作（右键菜单语义） ====================

  /**
   * 单资源上线（hares -online）：要求全部父资源已 ONLINE
   * @param rid 资源 id
   */
  resourceOnline(rid: number): void {
    const ctx = this.resourceCtx(rid)
    const { g, res } = ctx
    this.assertNotSplit(g.clusterId)
    if (!res.enabled) throw new BizError(409, `资源 ${res.name} 处于 Enabled=FALSE，引擎不编排`)
    const parentIds = g.resources.find((r) => r.id === rid)!.parents
    const notOnline = parentIds
      .map((p) => g.resources.find((r) => r.id === p)!)
      .filter((p) => p.enabled && p.state !== 'ONLINE')
    if (notOnline.length) {
      throw new BizError(409, `父资源未全部 ONLINE：${notOnline.map((p) => p.name).join(', ')}（先上线父资源或使用组上线）`)
    }
    this.setResourceState(g, rid, 'STARTING')
    this.step(g.id, RESOURCE_START_MS, () => {
      this.setResourceState(g, rid, 'ONLINE')
      this.recalcGroupState(this.group(g.id))
      this.log(g.clusterId, 'INFO', 'RESOURCE', res.name, 'ONLINE', '资源上线完成')
      this.ensureMonitor(g.clusterId)
    })
  }

  /**
   * 单资源下线（hares -offline）：其在线后代将因失去依赖而 FAULTED
   * @param rid 资源 id
   */
  resourceOffline(rid: number): void {
    const { g, res } = this.resourceCtx(rid)
    this.doOffline(g, rid, res.name, false)
  }

  /**
   * 优雅下线并传播（Offline Prop）：连带全部在线后代一并下线
   * @param rid 资源 id
   */
  resourceOfflineProp(rid: number): void {
    const { g, res } = this.resourceCtx(rid)
    this.doOffline(g, rid, res.name, true)
  }

  /** 下线实现：propagate=true 时后代跟随下线，否则在线后代 FAULTED */
  private doOffline(g: TreeGroup, rid: number, name: string, propagate: boolean): void {
    const desc = descendantsOf(rid, this.edges(g))
    this.setResourceState(g, rid, 'STOPPING')
    this.log(g.clusterId, 'INFO', 'RESOURCE', name, propagate ? 'OFFLINE_PROP' : 'OFFLINE', propagate ? '优雅下线并传播' : '资源下线')

    // 后代处理
    for (const d of desc) {
      const dRes = g.resources.find((r) => r.id === d)!
      if (dRes.state === 'ONLINE' || dRes.state === 'STARTING') {
        if (propagate) {
          this.step(g.id, RESOURCE_STOP_MS, () => this.setResourceState(g, d, 'OFFLINE'))
        } else {
          this.step(g.id, RESOURCE_STOP_MS, () => {
            this.setResourceState(g, d, 'FAULTED')
            this.log(g.clusterId, 'WARN', 'RESOURCE', dRes.name, 'FAULT', `依赖的 ${name} 已下线，被动故障`)
          })
        }
      }
    }
    this.step(g.id, RESOURCE_STOP_MS, () => {
      this.setResourceState(g, rid, 'OFFLINE')
      this.recalcGroupState(this.group(g.id))
    })
  }

  /**
   * 故障注入（Fault Resource）：置 FAULTED 并向在线后代传播；
   * Critical 资源触发整组 failover（SystemList 顺序取下一存活节点）
   * 同时置 monitor_break=1（持续故障：后续 probe 复燃，模拟未修复的真实故障）
   * @param rid 资源 id
   */
  resourceFault(rid: number): void {
    const { g, res } = this.resourceCtx(rid)
    this.assertNotSplit(g.clusterId)
    this.repo.setMonitorBreak(rid, 1)
    this.injectFault(g, rid, `人工注入故障`)

    // Critical → failover（遍历 SystemList；全部尝试过则保持 FAULTED 等待人工 Clear）
    if (res.critical) {
      const cur = this.repo.getGroup(g.id)?.current_system
      const tried = this.failoverTried.get(g.id) ?? 0
      if (tried >= g.systemList.length) {
        this.setGroupState(this.group(g.id), 'FAULTED', cur)
        this.log(g.clusterId, 'ERROR', 'GROUP', g.name, 'FAILOVER_EXHAUSTED', `已在全部节点尝试失败（${tried} 次），组保持 FAULTED，请人工清除故障后重新上线`)
        return
      }
      const target = g.systemList.map((s) => s.name).find((s) => s !== cur)
      this.setGroupState(this.group(g.id), 'FAULTED', cur)
      this.log(g.clusterId, 'ERROR', 'RESOURCE', res.name, 'FAULT_CRITICAL', `Critical 资源故障，触发服务组 failover（${cur} → ${target ?? '无可用节点'}）`)

      if (!target) {
        this.log(g.clusterId, 'ERROR', 'GROUP', g.name, 'FAILOVER_FAILED', 'SystemList 中无其他可用节点，组保持 FAULTED')
        return
      }
      this.step(g.id, FAILOVER_DELAY_MS, () => this.failover(g.id, target))
    }
  }

  /** failover：旧节点快速下线 → 新节点按依赖序上线（计数本轮尝试） */
  private failover(gid: number, target: string): void {
    const g = this.group(gid)
    this.cancelGroupOps(gid) // 清理待执行步骤，改为快速切换
    this.failoverTried.set(gid, (this.failoverTried.get(gid) ?? 0) + 1)
    const cur = this.repo.getGroup(gid)?.current_system
    this.log(g.clusterId, 'INFO', 'GROUP', g.name, 'FAILOVER', `开始切换：${cur ?? '?'} → ${target}（第 ${this.failoverTried.get(gid)} 次）`)

    // 1) 当前在线资源全部快速下线（统一 300ms 后一次置 OFFLINE）
    const onlineIds = g.resources.filter((r) => r.enabled && ['ONLINE', 'STARTING'].includes(r.state)).map((r) => r.id)
    this.step(gid, 300, () => {
      for (const rid of onlineIds) this.setResourceState(this.group(gid), rid, 'OFFLINE')
      this.setGroupState(this.group(gid), 'STOPPING', cur)
    })

    // 2) 间隔后在目标节点按依赖序上线
    const order = topoOrderBottomUp(
      g.resources.map((r) => ({ id: r.id, enabled: r.enabled })),
      this.edges(g),
    )
    const base = 300 + FAILOVER_GAP_MS
    order.forEach((rid, i) => {
      this.step(gid, base + i * LAYER_STEP_MS, () => this.setResourceState(this.group(gid), rid, 'STARTING'))
      this.step(gid, base + i * LAYER_STEP_MS + RESOURCE_START_MS, () => this.setResourceState(this.group(gid), rid, 'ONLINE'))
    })
    this.step(gid, base + order.length * LAYER_STEP_MS + RESOURCE_START_MS + 100, () => {
      const gg = this.group(gid)
      // 全部资源已 ONLINE，直接收敛为 ONLINE 并更新运行节点
      this.repo.updateGroup(gg.id, 'ONLINE', target)
      this.bus.publish('group.state', g.clusterId, { groupId: gg.id, name: gg.name, state: 'ONLINE', currentSystem: target })
      this.log(g.clusterId, 'INFO', 'GROUP', gg.name, 'FAILOVER_DONE', `已完成切换，服务组在 ${target} 上线`)
    })
  }

  /**
   * 清除故障（Clear Fault）：FAULTED → OFFLINE，解除持续故障标记，并重置 failover 遍历计数
   * @param rid 资源 id
   */
  resourceClear(rid: number): void {
    const { g, res } = this.resourceCtx(rid)
    if (res.state !== 'FAULTED') throw new BizError(409, `资源 ${res.name} 当前未故障，无需清除`)
    this.repo.setMonitorBreak(rid, 0)
    this.failoverTried.set(g.id, 0) // 人工介入 = 新一轮 failover 预算
    this.setResourceState(g, rid, 'OFFLINE')
    this.recalcGroupState(this.group(g.id))
    this.log(g.clusterId, 'INFO', 'RESOURCE', res.name, 'CLEAR', '故障已清除（资源保持 OFFLINE，可重新上线）')
  }

  /**
   * 立即探测（Probe）：形态按 MonScript 值自动分流（runProbeEntry 统一入口）——
   * `shell:` 平台脚本探活 / `powershell:` / `http(s)://` REST / JSON 多平台块 / JS 沙箱；
   * 判故障 → 后代传播 + Critical failover（遍历预算约束）
   */
  async resourceProbe(rid: number): Promise<void> {
    const { g, res } = this.resourceCtx(rid)
    if (res.state !== 'ONLINE') {
      this.log(g.clusterId, 'INFO', 'RESOURCE', res.name, 'PROBE', `探测完成：${res.state}（非 ONLINE，仅刷新）`)
      return
    }
    if (this.repo.getResource(rid)?.monitor_break) {
      this.injectFault(g, rid, '探测发现持续故障未修复')
      await this.maybeFailover(g, res)
      return
    }
    const script = res.attrs['MonScript'] ?? ''
    if (script.trim()) {
      const clusterPlatform = this.repo.getCluster(g.clusterId).platform
      const result = await runProbeEntry({ platform: clusterPlatform, script, attrs: res.attrs, state: res.state, random: Math.random() })
      await this.applyProbeResult(g, res, result, result.kind === 'js' ? 'PROBE_SCRIPT' : 'PROBE_' + result.kind.toUpperCase(), '自定义探活')
      return
    }
    this.log(g.clusterId, 'INFO', 'RESOURCE', res.name, 'PROBE', '探测完成：资源健康（ONLINE）')
  }

  /** 探测结果落地：脚本/HTTP 判故障 → 注入故障 + Critical 可能 failover */
  private async applyProbeResult(
    g: TreeGroup,
    res: TreeGroup['resources'][number],
    result: { ok: boolean; verdict: 'ONLINE' | 'FAULTED'; error?: string; raw?: string },
    action: string,
    label: string,
  ): Promise<void> {
    if (!result.ok) {
      this.log(g.clusterId, 'WARN', 'RESOURCE', res.name, action, `${label}执行失败（视为健康）：${result.error}`)
      return
    }
    if (result.verdict === 'FAULTED') {
      this.log(g.clusterId, 'ERROR', 'RESOURCE', res.name, action, `${label}判定故障（${result.raw ?? ''}）`)
      this.injectFault(g, res.id, `${label}判定故障`)
      await this.maybeFailover(g, res)
    } else {
      this.log(g.clusterId, 'INFO', 'RESOURCE', res.name, action, `${label}判定健康（${result.raw ?? 'ONLINE'}）`)
    }
  }

  /** Critical 资源故障后的 failover 决策（遍历预算约束） */
  private async maybeFailover(g: TreeGroup, res: TreeGroup['resources'][number]): Promise<void> {
    if (!res.critical) return
    const cur = this.repo.getGroup(g.id)?.current_system
    const tried = this.failoverTried.get(g.id) ?? 0
    const target = g.systemList.map((s) => s.name).find((s) => s !== cur)
    if (tried >= g.systemList.length || !target) {
      this.setGroupState(this.group(g.id), 'FAULTED', cur)
      this.log(g.clusterId, 'ERROR', 'GROUP', g.name, 'FAILOVER_EXHAUSTED', '已在全部节点尝试失败，组保持 FAULTED，请人工清除故障')
      return
    }
    this.step(g.id, FAILOVER_DELAY_MS, () => {
      if (!this.ops.has(g.id)) this.failover(g.id, target)
    })
  }

  /** 故障注入实现：置 FAULTED + 在线后代传播 + 事件 */
  private injectFault(g: TreeGroup, rid: number, reason: string): void {
    const res = g.resources.find((r) => r.id === rid)!
    this.setResourceState(g, rid, 'FAULTED')
    this.log(g.clusterId, 'ERROR', 'RESOURCE', res.name, 'FAULT', reason)
    const desc = descendantsOf(rid, this.edges(g))
    for (const d of desc) {
      const dRes = g.resources.find((r) => r.id === d)!
      if (dRes.enabled && ['ONLINE', 'STARTING'].includes(dRes.state)) {
        this.setResourceState(g, d, 'FAULTED')
        this.log(g.clusterId, 'WARN', 'RESOURCE', dRes.name, 'FAULT', `依赖的 ${res.name} 故障，连带故障`)
      }
    }
    this.recalcGroupState(this.group(g.id))
  }

  // ==================== 周期监控 ====================

  /** 确保集群的监控定时器在跑（首个组上线时启动） */
  ensureMonitor(clusterId: number): void {
    if (this.monitors.has(clusterId)) return
    const t = setInterval(() => this.probeAll(clusterId), PROBE_INTERVAL_MS)
    this.monitors.set(clusterId, t)
  }

  /** 停止集群监控 */
  stopMonitor(clusterId: number): void {
    const t = this.monitors.get(clusterId)
    if (t) {
      clearInterval(t)
      this.monitors.delete(clusterId)
    }
  }

  /** 对集群内全部 ONLINE 资源执行一轮探测 */
  private async probeAll(clusterId: number): Promise<void> {
    // 集群不存在或已停止则停止监控
    let status: string
    try {
      status = this.repo.getCluster(clusterId).status
    } catch {
      this.stopMonitor(clusterId)
      return
    }
    if (status !== 'RUNNING') {
      this.stopMonitor(clusterId)
      return
    }
    // 脑裂冻结：监控探针暂停（分区各自无法可靠协调）
    if (this.isSplit(clusterId)) return
    const tree = this.repo.getTree(clusterId)
    for (const g of tree.groups) {
      for (const r of g.resources) {
        if (!r.enabled || r.state !== 'ONLINE') continue
        // ① 持续故障标记（monitor_break）优先复燃
        if (this.repo.getResource(r.id)?.monitor_break) {
          this.injectFault(g, r.id, '周期监控发现持续故障')
          await this.maybeFailover(g, r)
          continue
        }
        // ② MonScript 四形态统一探测（shell/powershell/http/JS/多平台块）
        const script = r.attrs['MonScript'] ?? ''
        if (script.trim()) {
          const clusterPlatform = tree.cluster.platform
          const result = await runProbeEntry({ platform: clusterPlatform, script, attrs: r.attrs, state: r.state, random: Math.random() })
          if (!result.ok) {
            this.log(g.clusterId, 'WARN', 'RESOURCE', r.name, 'PROBE_SCRIPT', `监控脚本执行失败（视为健康）：${result.error}`)
          } else if (result.verdict === 'FAULTED') {
            this.injectFault(g, r.id, `监控脚本判定故障（${result.raw ?? ''}）`)
            await this.maybeFailover(g, r)
          }
        }
      }
    }
  }

  // ==================== AutoStartList（二期 P1-3） ====================

  /**
   * 集群启动完成后的自动上线（hastart 语义）：按各服务组 AutoStartList[0] 依次编排
   * 由 ClusterEngine 通过 onStarted 回调触发；定时器独立于 ops（不阻断人工操作），
   * 触发时组非 OFFLINE 则自动让位
   */
  autoStartGroups(clusterId: number): void {
    const tree = this.repo.getTree(clusterId)
    let set = this.autoTimers.get(clusterId)
    if (!set) {
      set = new Set()
      this.autoTimers.set(clusterId, set)
    }
    let delay = 600
    for (const g of tree.groups) {
      if (!g.autostartList.length) continue
      const target = g.autostartList[0]
      const t = setTimeout(() => {
        set!.delete(t)
        if (!set!.size && this.autoTimers.get(clusterId) === set) this.autoTimers.delete(clusterId)
        const cur = this.repo.getGroup(g.id)
        if (!cur || cur.state !== 'OFFLINE') return // 人工已先行/编排中 → 让位
        try {
          this.groupOnline(g.id, target)
          this.log(clusterId, 'INFO', 'GROUP', g.name, 'AUTOSTART', `AutoStartList 命中，自动在 ${target} 上线`)
        } catch (e) {
          this.log(clusterId, 'WARN', 'GROUP', g.name, 'AUTOSTART_SKIP', `自动上线跳过：${(e as Error).message}`)
        }
      }, delay)
      set.add(t)
      delay += 400
    }
  }

  /** 清除集群的 AutoStart 挂起定时器（集群停止/删除时） */
  private cancelAutoStart(clusterId: number): void {
    const set = this.autoTimers.get(clusterId)
    if (!set) return
    for (const t of set) clearTimeout(t)
    this.autoTimers.delete(clusterId)
  }

  // ==================== Link / Unlink ====================

  /**
   * 建立依赖（child requires parent），带成环与自环校验
   * @param gid 组 id
   * @param childId 子资源
   * @param parentId 父资源（被依赖方）
   */
  link(gid: number, childId: number, parentId: number): void {
    const g = this.group(gid)
    if (childId === parentId) throw new BizError(400, '不能依赖自身')
    const child = g.resources.find((r) => r.id === childId)
    const parent = g.resources.find((r) => r.id === parentId)
    if (!child || !parent) throw new BizError(404, '资源不存在')
    if (g.resources.find((r) => r.id === childId)!.parents.includes(parentId)) {
      throw new BizError(409, `依赖已存在：${child.name} requires ${parent.name}`)
    }
    // 成环校验：parent 的祖先中不能包含 child
    if (ancestorsOf(parentId, this.edges(g)).has(childId)) {
      throw new BizError(409, `该依赖会形成环：${parent.name} 已（间接）依赖 ${child.name}`)
    }
    this.repo.addLink(gid, childId, parentId)
    this.log(g.clusterId, 'INFO', 'RESOURCE', child.name, 'LINK', `建立依赖 requires ${parent.name}`)
  }

  /**
   * 解除依赖
   * @param gid 组 id
   * @param childId 子资源
   * @param parentId 父资源
   */
  unlink(gid: number, childId: number, parentId: number): void {
    const g = this.group(gid)
    const child = g.resources.find((r) => r.id === childId)
    const parent = g.resources.find((r) => r.id === parentId)
    if (!child || !parent) throw new BizError(404, '资源不存在')
    this.repo.removeLink(gid, childId, parentId)
    this.log(g.clusterId, 'INFO', 'RESOURCE', child.name, 'UNLINK', `解除依赖 requires ${parent.name}`)
  }

  /** 资源操作上下文（组 + 资源 + 归属校验） */
  private resourceCtx(rid: number): { g: TreeGroup; res: TreeGroup['resources'][number] } {
    const found = this.repo.findGroupByResource(rid)
    if (!found) throw new BizError(404, `资源不存在: id=${rid}`)
    const g = this.group(found.id)
    const res = g.resources.find((r) => r.id === rid)!
    return { g, res }
  }
}
