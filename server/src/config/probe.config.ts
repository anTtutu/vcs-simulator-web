/**
 * 文件：src/config/probe.config.ts
 * 用途：MonScript 探测的灵活配置中心（全部可在 UI/JSON 配置，不写死）——
 *       ① 平台 → 解释器映射（Linux/Unix/Windows 各自的可执行文件与参数）；
 *       ② 各形态超时；
 *       ③ 属性注入环境变量前缀。
 * 加载优先级：VCS_PROBE_CONFIG 指向的 JSON > ./probe.config.json > 内置默认
 * （每次调用实时读取，改完无需重启；可通过 GET/PUT /api/probe-config 在 UI 配置）
 * 作者：Anttu
 * 日期：2026-10-16
 */
import fs from 'node:fs'

/** 单平台解释器 */
export interface Interpreter {
  file: string
  args: string[]
}

/** 探测配置结构（JSON 可全量/部分覆盖） */
export interface ProbeConfig {
  /** 平台 → 解释器映射（键 = cluster.platform：Linux|Unix|AIX|HP-UX|Solaris|W2K3|W2K8） */
  interpreters: Record<string, Interpreter>
  /** 未匹配平台时的兜底解释器 */
  fallback: Interpreter
  shell: { timeoutMs: number }
  powershell: { winFile: string; winArgs: string[]; unixFile: string; unixArgs: string[]; timeoutMs: number }
  http: { timeoutMs: number; method: string }
  /** 属性注入环境变量前缀 */
  envPrefix: string
}

/** 内置默认：Unix/Linux 用 /bin/sh，Windows 用 cmd.exe（bat），PowerShell 单独前缀 */
const DEFAULTS: ProbeConfig = {
  interpreters: {
    Linux: { file: '/bin/sh', args: ['-c'] },
    Unix: { file: '/bin/sh', args: ['-c'] },
    AIX: { file: '/bin/sh', args: ['-c'] },
    'HP-UX': { file: '/bin/sh', args: ['-c'] },
    Solaris: { file: '/bin/sh', args: ['-c'] },
    W2K3: { file: 'cmd.exe', args: ['/d', '/s', '/c'] },
    W2K8: { file: 'cmd.exe', args: ['/d', '/s', '/c'] },
  },
  fallback: { file: '/bin/sh', args: ['-c'] },
  shell: { timeoutMs: 5000 },
  powershell: {
    unixFile: 'pwsh',
    unixArgs: ['-NoProfile', '-NonInteractive', '-Command'],
    winFile: 'powershell.exe',
    winArgs: ['-NoProfile', '-NonInteractive', '-Command'],
    timeoutMs: 8000,
  },
  http: { timeoutMs: 5000, method: 'POST' },
  envPrefix: 'ATTR_',
}

/** 平台 → 解释器（含兜底；集群 platform 直接来自 PLATFORMS） */
export function interpreterFor(config: ProbeConfig, platform: string | null | undefined): Interpreter {
  return config.interpreters[platform ?? ''] ?? config.fallback
}

/** 浅合并一层对象字段 */
function merge<T extends Record<string, unknown>>(base: T, patch?: Partial<T>): T {
  return patch ? { ...base, ...patch } : { ...base }
}

/**
 * 加载探测配置（每次调用实时读取，UI 保存后立即生效，无需重启）
 */
export function loadProbeConfig(): ProbeConfig {
  const candidates = [process.env.VCS_PROBE_CONFIG, './probe.config.json'].filter(Boolean) as string[]
  let patch: Partial<ProbeConfig> | undefined
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        patch = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<ProbeConfig>
        break
      }
    } catch (e) {
      console.warn(`[probe.config] 配置文件 ${file} 解析失败，已跳过：${(e as Error).message}`)
    }
  }
  return {
    interpreters: { ...DEFAULTS.interpreters, ...(patch?.interpreters ?? {}) },
    fallback: patch?.fallback ?? DEFAULTS.fallback,
    shell: merge(DEFAULTS.shell, patch?.shell),
    powershell: merge(DEFAULTS.powershell, patch?.powershell),
    http: merge(DEFAULTS.http, patch?.http),
    envPrefix: patch?.envPrefix ?? DEFAULTS.envPrefix,
  }
}

/** 保存探测配置（UI「⚙ 探测设置」写入；写成功即生效） */
export function saveProbeConfig(config: ProbeConfig, explicitPath?: string): string {
  const file = explicitPath ?? process.env.VCS_PROBE_CONFIG ?? './probe.config.json'
  fs.writeFileSync(file, JSON.stringify(config, null, 2))
  return file
}
