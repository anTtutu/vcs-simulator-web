/**
 * 文件：src/cli/commands.ts
 * 用途：ha* 命令控制台（Launch Console 的 Web 对应物，D3 决策）
 *       支持：hastart/hastop/hagrp/hares/hasys/haconf/gabconfig/lltstat/help
 *       命令语义与真实 VCS 对齐（hagrp -switch、hares -probe 等）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Repo } from '../db/repo.js'
import type { ClusterEngine } from '../engine/clusterEngine.js'
import type { GroupEngine } from '../engine/groupEngine.js'
import { BizError } from '../domain/clusterLifecycle.js'
import { generateMainCf } from '../cf/generator.js'

/** 命令执行上下文 */
export interface CliContext {
  repo: Repo
  clusterEngine: ClusterEngine
  groupEngine: GroupEngine
  clusterId: number
  /** 当前角色（Observer 只能执行只读命令） */
  role?: string
}

/** 执行结果 */
export interface CliResult {
  output: string[]
  /** 是否为清除屏幕命令 */
  clear?: boolean
}

const HELP = [
  'VCS Simulator Web - 可用命令：',
  '  hastart                        启动集群（含 AutoStartList 自动上线）',
  '  hastop -all|-local             停止集群',
  '  hagrp -state | -list           服务组状态 / 清单',
  '  hagrp -online <组> -sys <节点>  在指定节点上线服务组',
  '  hagrp -offline <组>            下线服务组',
  '  hagrp -switch <组> -to <节点>  切换服务组到目标节点（failover 演练）',
  '  hares -state                   查看资源状态',
  '  hares -online <资源>           上线资源（要求父资源已 ONLINE）',
  '  hares -offline <资源>          下线资源',
  '  hares -clear <资源>            清除故障',
  '  hares -probe <资源>            立即探测',
  '  hares -prop <资源>             查看资源属性',
  '  hasys -state [节点]            查看节点状态（可指定单节点）',
  '  haconf -dump                   导出 main.cf',
  '  gabconfig -a                   查看 GAB 端口成员（含脑裂分区输出）',
  '  lltstat -n                     查看 LLT 链路状态',
  '  help | clear',
]

/** 拆分参数（支持引号） */
function tokenize(cmd: string): string[] {
  const m = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  return m.map((s) => s.replace(/"/g, ''))
}

/**
 * 执行一条控制台命令
 * @param ctx 上下文
 * @param raw 命令原文
 * @returns 输出行
 */
export function execCommand(ctx: CliContext, raw: string): CliResult {
  const argv = tokenize(raw.trim())
  if (!argv.length) return { output: [] }
  const [cmd, ...rest] = argv
  const { repo, clusterEngine, groupEngine, clusterId } = ctx

  // Observer 角色只放行只读命令（P2-3）
  const READONLY = ['help', 'clear', 'hagrp', 'hares', 'hasys', 'haconf', 'gabconfig', 'lltstat']
  const MUTATING_SUB = ['-online', '-offline', '-switch', '-clear', '-probe', '-start', '-stop']
  if ((ctx.role ?? 'Administrator') === 'Observer') {
    if (!READONLY.includes(cmd) || MUTATING_SUB.some((f) => rest.includes(f))) {
      return { output: ['[error] Observer 角色为只读观察者，无权执行变更命令'] }
    }
  }
  const cluster = repo.getCluster(clusterId)

  switch (cmd) {
    case 'help':
      return { output: HELP }
    case 'clear':
      return { output: [], clear: true }

    case 'hastart': {
      clusterEngine.start(clusterId)
      return { output: [`[info] 集群 ${cluster.name} 启动中（请用 hagrp -state 观察后续状态）`] }
    }
    case 'hastop': {
      clusterEngine.stop(clusterId)
      return { output: [`[info] 集群 ${cluster.name} 停止中`] }
    }

    case 'gabconfig': {
      if (rest[0] !== '-a') return { output: ['用法: gabconfig -a'] }
      const running = cluster.status === 'RUNNING'
      const links = repo.listLinks(clusterId)
      const down = links.filter((l) => l.status === 'DOWN').length
      if (!running) return { output: ['GAB 未运行（集群未启动）'] }
      if (down === 2) {
        return {
          output: [
            'GAB Port Memberships',
            '========================================',
            '!! 脑裂：双心跳断链，分区各自成组 !!',
            'port h :  1  (HAD)   sys1',
            'port h :  1  (HAD)   sys2',
          ],
        }
      }
      return {
        output: [
          'GAB Port Memberships',
          '========================================',
          `port a :  2  (LLT心跳, links ${2 - down}/2 UP)   sys1  sys2`,
          'port h :  2  (HAD)       sys1  sys2',
          'port g :  2  (GMS)       sys1  sys2',
        ],
      }
    }
    case 'lltstat': {
      const running = cluster.status === 'RUNNING'
      const links = repo.listLinks(clusterId)
      if (!running) return { output: ['LLT 未运行（集群未启动）'] }
      return {
        output: [
          'LLT links:',
          ...links.map((l, i) => `  ${l.name}  eth${i}    ${l.status.padEnd(5)} sys1<->sys2`),
        ],
      }
    }
    case 'haconf': {
      if (rest[0] === '-dump') {
        const tree = repo.getTree(clusterId)
        return { output: generateMainCf({ cluster, groups: tree.groups }).split('\n') }
      }
      if (rest[0] === '-makerw') return { output: ['[info] 配置已进入读写模式（模拟器恒为可写）'] }
      return { output: ['用法: haconf -dump | -makerw'] }
    }

    case 'hasys': {
      if (rest[0] === '-state') {
        const systems = repo.listSystems(clusterId)
        const target = rest[1]
        const shown = target ? systems.filter((s) => s.name === target) : systems
        if (target && !shown.length) return { output: [`[error] 节点 ${target} 不存在`] }
        return { output: ['#System   Status', ...shown.map((s) => `${s.name.padEnd(10)}${s.status}`)] }
      }
      if (rest.length === 0) {
        const systems = repo.listSystems(clusterId)
        return { output: ['#System   Status', ...systems.map((s) => `${s.name.padEnd(10)}${s.status}`)] }
      }
      return { output: ['用法: hasys -state [节点名]'] }
    }

    case 'hagrp': {
      const tree = repo.getTree(clusterId)
      if (rest[0] === '-list') {
        return { output: ['#Group', ...tree.groups.map((g) => g.name)] }
      }
      if (rest[0] === '-state' || rest.length === 0) {
        return {
          output: [
            '#Group            #System  State',
            ...tree.groups.map((g) => `${g.name.padEnd(18)}${(g.currentSystem ?? '-').padEnd(9)}${g.state}`),
          ],
        }
      }
      const groupName = rest[1]
      const group = tree.groups.find((g) => g.name === groupName)
      if (rest[0] === '-online') {
        if (!group) return { output: [`[error] 服务组 ${groupName} 不存在`] }
        const sysIdx = rest.indexOf('-sys')
        const sys = sysIdx >= 0 ? rest[sysIdx + 1] : undefined
        try {
          groupEngine.groupOnline(group.id, sys)
          return { output: [`[info] ${groupName} 在 ${sys ?? '(默认节点)'} 上线编排中…`] }
        } catch (e) {
          return { output: [`[error] ${(e as Error).message}`] }
        }
      }
      if (rest[0] === '-offline') {
        if (!group) return { output: [`[error] 服务组 ${groupName} 不存在`] }
        try {
          groupEngine.groupOffline(group.id)
          return { output: [`[info] ${groupName} 下线编排中…`] }
        } catch (e) {
          return { output: [`[error] ${(e as Error).message}`] }
        }
      }
      if (rest[0] === '-switch') {
        if (!group) return { output: [`[error] 服务组 ${groupName} 不存在`] }
        const toIdx = rest.indexOf('-to')
        if (toIdx < 0) return { output: ['用法: hagrp -switch <组> -to <节点>'] }
        try {
          groupEngine.groupSwitch(group.id, rest[toIdx + 1])
          return { output: [`[info] ${groupName} 正在切换到 ${rest[toIdx + 1]}…`] }
        } catch (e) {
          return { output: [`[error] ${(e as Error).message}`] }
        }
      }
      return { output: ['用法: hagrp -state | -online <组> -sys <节点> | -offline <组> | -switch <组> -to <节点>'] }
    }

    case 'hares': {
      const tree = repo.getTree(clusterId)
      const allRes = tree.groups.flatMap((g) => g.resources.map((r) => ({ ...r, groupName: g.name })))
      if (rest[0] === '-state' || rest.length === 0) {
        return {
          output: [
            '#Resource              State     Group',
            ...allRes.map((r) => `${r.name.padEnd(22)}${r.state.padEnd(10)}${r.groupName}`),
          ],
        }
      }
      const resName = rest[1]
      const res = allRes.find((r) => r.name === resName)
      if (!resName || !res) return { output: [`[error] 资源 ${resName ?? '(空)'} 不存在`] }
      const act = (fn: () => void, okMsg: string): CliResult => {
        try {
          fn()
          return { output: [`[info] ${okMsg}`] }
        } catch (e) {
          if (e instanceof BizError) return { output: [`[error] ${e.message}`] }
          throw e
        }
      }
      switch (rest[0]) {
        case '-online':
          return act(() => groupEngine.resourceOnline(res.id), `${res.name} 上线编排中…`)
        case '-offline':
          return act(() => groupEngine.resourceOffline(res.id), `${res.name} 下线编排中…`)
        case '-clear':
          return act(() => groupEngine.resourceClear(res.id), `${res.name} 故障已清除`)
        case '-probe':
          return act(() => groupEngine.resourceProbe(res.id), `${res.name} 探测完成`)
        case '-prop':
          return {
            output: [
              `#Resource  ${res.name}  (${res.typeCode})`,
              ...Object.entries(res.attrs).map(([k, v]) => `  ${k.padEnd(18)}${v === '' ? '(空)' : v}`),
              `  Enabled            ${res.enabled}`,
              `  Critical           ${res.critical}`,
            ],
          }
        default:
          return { output: ['用法: hares -state | -online/-offline/-clear/-probe/-prop <资源>'] }
      }
    }

    default:
      return { output: [`[error] 未知命令: ${cmd}（输入 help 查看可用命令）`] }
  }
}
