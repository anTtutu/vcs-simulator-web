/**
 * 文件：src/engine/scenario.ts
 * 用途：演练剧本引擎（二期 P1-4）—— 预设教学场景一键执行：
 *       按时间线自动注入故障/切换/解说字幕（SCENARIO 事件），把模拟器变成可照着讲的课件
 *       步骤通过「谓词」定位资源（如第一个 Critical 资源），保证剧本与具体集群无关
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Repo } from '../db/repo.js'
import type { EventBus } from '../events/bus.js'
import type { ClusterEngine } from './clusterEngine.js'
import type { GroupEngine } from './groupEngine.js'
import type { TreeGroup, TreeResource } from '../db/repo.js'

/** 剧本定义（run 返回错误文案表示前置不满足；返回 undefined 继续） */
export interface ScenarioDef {
  key: string
  title: string
  desc: string
  /** 需要集群处于 RUNNING */
  needRunning?: boolean
  /** 需要已有服务组在线 */
  needGroupOnline?: boolean
  steps: { afterMs: number; say?: string; run?: (ctx: ScenarioCtx) => string | void }[]
}

/** 剧本执行上下文 */
export interface ScenarioCtx {
  repo: Repo
  clusterEngine: ClusterEngine
  groupEngine: GroupEngine
  clusterId: number
}

/** 取第一个服务组（教学集群通常单组；多组取第一个） */
function firstGroup(ctx: ScenarioCtx): TreeGroup {
  const tree = ctx.repo.getTree(ctx.clusterId)
  const g = tree.groups[0]
  if (!g) throw new Error('该集群没有服务组，无法演练')
  return g
}

/** 按谓词找资源 */
function findRes(g: TreeGroup, pred: (r: TreeResource) => boolean): TreeResource {
  const r = g.resources.find(pred)
  if (!r) throw new Error('未找到满足条件的资源')
  return r
}

/** 剧本清单（静态定义，前端 GET /api/scenarios 展示） */
export const SCENARIOS: ScenarioDef[] = [
  {
    key: 'basic-ha',
    title: '双机互备基础上线',
    desc: '启动集群 → 观察节点 ONLINE → 服务组按 AutoStartList 自动上线，理解 Cluster/System/ServiceGroup 三层概念。',
    needRunning: false,
    steps: [
      { afterMs: 0, say: '【1/4】启动集群：HAD 守护进程拉起，各节点 GAB 组播成成员' },
      { afterMs: 200, run: (c) => { if (c.repo.getCluster(c.clusterId).status === 'STOPPED') c.clusterEngine.start(c.clusterId) } },
      { afterMs: 4200, say: '【2/4】集群 RUNNING：sys1/sys2 ONLINE，LLT 心跳与 GAB 端口 a/h/g 就绪' },
      { afterMs: 4600, run: (c) => { if (c.repo.getTree(c.clusterId).groups[0]?.state === 'OFFLINE') c.groupEngine.groupOnline(c.repo.getTree(c.clusterId).groups[0].id) } },
      { afterMs: 11000, say: '【3/4】服务组按依赖序自底向上点亮：DG → Volume → Mount → IP/Oracle → Netlsnr' },
      { afterMs: 11400, say: '【4/4】演练完成。可在 Explorer 观察资源状态与当前运行节点' },
    ],
  },
  {
    key: 'failover',
    title: 'Critical 故障切换演练',
    desc: '对 Critical 资源注入持续故障 → 整组 failover 到备节点 → 遍历完 SystemList 后冻结 → 人工 Clear 恢复。VCS 高可用的核心叙事。',
    needRunning: true,
    needGroupOnline: true,
    steps: [
      { afterMs: 0, say: '【1/5】向 Critical 资源注入持续故障（monitor_break=1）' },
      {
        afterMs: 200,
        run: (c) => {
          const g = firstGroup(c)
          c.groupEngine.resourceFault(findRes(g, (r) => r.critical && r.enabled).id)
        },
      },
      { afterMs: 1500, say: '【2/5】Critical 资源 FAULTED → 引擎决策 failover：旧节点优雅下线 → 新节点按依赖序上线' },
      { afterMs: 10500, say: '【3/5】已切换到备节点运行。注意：持续故障未修复，监控探针将再次发现故障' },
      { afterMs: 13500, say: '【4/5】SystemList 已遍历完毕（若再次故障），组冻结 FAULTED 等待人工介入 —— 这正是真实 VCS 的防震荡语义' },
      {
        afterMs: 13800,
        run: (c) => {
          const g = firstGroup(c)
          const faulted = g.resources.filter((r) => r.state === 'FAULTED')
          for (const r of faulted) {
            try {
              c.groupEngine.resourceClear(r.id)
            } catch {
              /* 已被连带清除 */
            }
          }
          return faulted.length ? undefined : '无 FAULTED 资源可清除'
        },
      },
      { afterMs: 14200, say: '【5/5】故障已清除（资源 OFFLINE）。可重新上线服务组，或继续其他演练' },
    ],
  },
  {
    key: 'storage-cascade',
    title: '存储故障级联传播',
    desc: '对最底层 DiskGroup 注入故障 → 观察故障沿依赖方向向全部上层资源传播；对照非 Critical 场景组只进入 PARTIAL。',
    needRunning: true,
    needGroupOnline: true,
    steps: [
      { afterMs: 0, say: '【1/4】对底层 DiskGroup（无依赖父）注入故障' },
      {
        afterMs: 200,
        run: (c) => {
          const g = firstGroup(c)
          const dg = findRes(g, (r) => r.typeCode === 'DiskGroup' && r.enabled)
          c.groupEngine.resourceFault(dg.id)
        },
      },
      { afterMs: 1200, say: '【2/4】故障沿 requires 方向传播：Volume/Mount/Oracle/Netlsnr 全部连带 FAULTED' },
      { afterMs: 1800, say: '【3/4】非 Critical 源 → 组 PARTIAL 不触发 failover；手动下线父资源时在线子资源同样会被动故障' },
      {
        afterMs: 2400,
        run: (c) => {
          const g = firstGroup(c)
          for (const r of g.resources.filter((x) => x.state === 'FAULTED')) {
            try {
              c.groupEngine.resourceClear(r.id)
            } catch {
              /* 忽略 */
            }
          }
        },
      },
      { afterMs: 2800, say: '【4/4】全部故障已清除，资源保持 OFFLINE，可重新上线' },
    ],
  },
  {
    key: 'brain-split',
    title: '心跳断链与脑裂冻结',
    desc: '依次断开 link0/link1 → 双链全断触发脑裂（AUTODISABLED）→ 编排被冻结 → 恢复链路解除脑裂。LLT/GAB 冗余心跳教学。',
    needRunning: true,
    steps: [
      { afterMs: 0, say: '【1/5】断开心跳链路 link0：LLT 降级运行（冗余链路兜底）' },
      { afterMs: 200, run: (c) => { c.groupEngine.setLink(c.clusterId, 'link0', 'DOWN') } },
      { afterMs: 1400, say: '【2/5】再断开 link1：双链全断 → GAB 组播失效 → 集群脑裂' },
      { afterMs: 1600, run: (c) => { c.groupEngine.setLink(c.clusterId, 'link1', 'DOWN') } },
      { afterMs: 2800, say: '【3/5】脑裂冻结（AUTODISABLED）：此时任何上线/下线/故障操作都会被引擎拒绝（409）' },
      { afterMs: 4000, say: '【4/5】恢复 link0：单链可用即解除脑裂（真实环境需排查网络后恢复 LLT）' },
      { afterMs: 4200, run: (c) => { c.groupEngine.setLink(c.clusterId, 'link0', 'UP') } },
      { afterMs: 5400, say: '【5/5】脑裂解除，编排恢复。建议把 link1 也恢复（UP）' },
      { afterMs: 5600, run: (c) => { c.groupEngine.setLink(c.clusterId, 'link1', 'UP') } },
    ],
  },
  {
    key: 'site-disaster',
    title: '站点级容灾接管（Global）',
    desc: '针对已建立 Global 分组的容灾对：主站集群整体宕机 → Global View 链路告红 → 备站具备接管条件（hagrp -online 于备站）。',
    needRunning: false,
    steps: [
      { afterMs: 0, say: '【1/4】查找本集群所属的 Global 容灾分组' },
      {
        afterMs: 200,
        run: (c) => {
          const grp = c.repo.listGlobalGroups().find((g) => (g.clusters as { id: number }[]).some((x) => x.id === c.clusterId))
          if (!grp) return '本集群未加入任何 Global 分组（先在 Global View 创建）'
          const primary = (grp.clusters as { id: number; status: string }[])[0]
          if (primary.id !== c.clusterId) return undefined // 在备集群上执行则跳过宕机步骤
          if (primary.status === 'RUNNING') c.clusterEngine.stop(c.clusterId)
        },
      },
      { afterMs: 3600, say: '【2/4】主站集群已停止（模拟站点灾难）：Global View 复制链路告红' },
      { afterMs: 4200, say: '【3/4】备站集群仍健康：可在备站对同名服务组执行上线接管（存储层需先完成 SRDF/VVR 切换——模拟器按已切换处理）' },
      { afterMs: 4800, say: '【4/4】演练完成。主站恢复启动后，可在 Global View 观察双站状态回归' },
    ],
  },
]

/** 运行中的剧本（clusterId → 定时器集合） */
export class ScenarioRunner {
  private running = new Map<number, Set<ReturnType<typeof setTimeout>>>()

  constructor(
    private repo: Repo,
    private bus: EventBus,
    private clusterEngine: ClusterEngine,
    private groupEngine: GroupEngine,
  ) {}

  /** 剧本元数据列表（给前端展示） */
  list(): { key: string; title: string; desc: string; needRunning: boolean; needGroupOnline: boolean; durationMs: number }[] {
    return SCENARIOS.map((s) => ({
      key: s.key,
      title: s.title,
      desc: s.desc,
      needRunning: !!s.needRunning,
      needGroupOnline: !!s.needGroupOnline,
      durationMs: Math.max(...s.steps.map((x) => x.afterMs)),
    }))
  }

  /** 某集群是否在跑剧本 */
  isRunning(clusterId: number): boolean {
    return this.running.has(clusterId)
  }

  /** 执行剧本：前置校验 + 时间线调度；每步 say 产出 SCENARIO 叙事事件 */
  run(clusterId: number, key: string): { steps: number } {
    const def = SCENARIOS.find((s) => s.key === key)
    if (!def) throw new Error(`剧本不存在: ${key}`)
    if (this.running.has(clusterId)) throw new Error('该集群已有剧本在执行，请先停止')
    const cluster = this.repo.getCluster(clusterId)
    const ctx: ScenarioCtx = { repo: this.repo, clusterEngine: this.clusterEngine, groupEngine: this.groupEngine, clusterId }

    if (def.needRunning && cluster.status !== 'RUNNING') throw new Error('请先启动集群再执行该剧本')
    if (def.needGroupOnline) {
      const g = this.repo.getTree(clusterId).groups[0]
      if (!g || !g.resources.some((r) => r.state === 'ONLINE')) throw new Error('请先将服务组上线再执行该剧本')
    }

    const timers = new Set<ReturnType<typeof setTimeout>>()
    this.running.set(clusterId, timers)
    const say = (text: string) => {
      this.repo.insertEvent(clusterId, 'INFO', 'ENGINE', def.title, 'SCENARIO', text)
      this.bus.publish('log.append', clusterId, { level: 'INFO', scope: 'ENGINE', target: def.title, action: 'SCENARIO', detail: text, narration: true, ts: Date.now() })
    }

    say(`▶ 开始演练：${def.title}`)
    for (const step of def.steps) {
      const t = setTimeout(() => {
        try {
          const err = step.run?.(ctx)
          if (typeof err === 'string' && err) say(`⚠ ${err}`)
          else if (step.say) say(step.say)
        } catch (e) {
          say(`⚠ 步骤执行失败：${(e as Error).message}`)
        } finally {
          timers.delete(t)
          if (!timers.size && this.running.get(clusterId) === timers) this.running.delete(clusterId)
        }
      }, step.afterMs)
      timers.add(t)
    }
    // 收尾事件
    const end = setTimeout(
      () => {
        timers.delete(end)
        if (!timers.size && this.running.get(clusterId) === timers) {
          this.running.delete(clusterId)
          say(`■ 演练结束：${def.title}`)
        }
      },
      Math.max(...def.steps.map((s) => s.afterMs)) + 400,
    )
    timers.add(end)
    return { steps: def.steps.length }
  }

  /** 停止剧本（清掉未执行的时间线） */
  stop(clusterId: number): void {
    const timers = this.running.get(clusterId)
    if (!timers) return
    for (const t of timers) clearTimeout(t)
    this.running.delete(clusterId)
    this.repo.insertEvent(clusterId, 'WARN', 'ENGINE', 'Scenario', 'SCENARIO_STOP', '剧本被手动停止')
  }
}
