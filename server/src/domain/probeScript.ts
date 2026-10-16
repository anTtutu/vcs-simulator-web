/**
 * 文件：src/domain/probeScript.ts
 * 用途：MonScript 自定义探活的统一入口（三形态四写法，全部支持自定义）：
 *       ① `shell:<命令>`      → 本机脚本探活（解释器按集群平台映射，UI「⚙探测设置」可配）
 *       ② `powershell:<脚本>` → PowerShell 探活（Windows 服务/事件）
 *       ③ `http(s)://...`     → REST 探活（POST {attrs,state}，2xx=健康，可返回 {verdict}）
 *       ④ `{...}` JSON 多平台块 → 按集群平台自动选平台脚本（Linux/Unix/Windows，二开扩展）
 *       ⑤ 其他 → JS 沙箱表达式（attrs/state/random 判定）
 *       语义约定：退出码非 0 / 非 2xx / 返回含 FAULT → 资源故障；
 *                JS 语法错误视为健康 + 告警（监控脚本自身失败 ≠ 资源故障）
 * 作者：Anttu
 * 日期：2026-10-16
 */
import { loadProbeConfig, interpreterFor, type Interpreter } from '../config/probe.config.js'

/** 脚本执行结果 */
export interface ProbeScriptResult {
  /** 执行是否成功（JS 语法/运行错误 → false，此时视为健康） */
  ok: boolean
  /** 判定结果：FAULTED = 故障；ONLINE = 健康 */
  verdict: 'ONLINE' | 'FAULTED'
  /** ok=false 时的错误说明 */
  error?: string
  /** 返回原文（日志用） */
  raw?: string
}

/** 多平台探测 JSON 块（MonScript 值为以 { 开头的 JSON 串） */
export interface MultiPlatformProbe {
  /** 平台选择：auto=按集群 platform 自动匹配（推荐）；或显式 Linux/Unix/Windows */
  platform?: 'auto' | 'Linux' | 'Unix' | 'Windows'
  /** Linux 平台探活命令 */
  linux?: string
  /** 传统 Unix（AIX/HP-UX/Solaris）命令；缺省回落 linux */
  unix?: string
  /** Windows 命令（cmd/bat；以 PS> 开头则走 PowerShell） */
  windows?: string
  /** 本块超时（ms） */
  timeoutMs?: number
}

/** 沙箱黑名单：循环/IO/宿主访问（防死循环与逃逸，教学沙箱从简） */
const FORBIDDEN = ['while', 'for(', 'setInterval', 'setTimeout', 'require', 'process', 'globalThis', 'import', 'eval', 'Function', 'fetch']

/** 判定文本 → 结论 */
function verdictOf(text: string): 'ONLINE' | 'FAULTED' {
  return text.toUpperCase().includes('FAULT') ? 'FAULTED' : 'ONLINE'
}

/** 属性注入环境变量（VCS_STATE + envPrefix_属性名） */
function buildEnv(attrs: Record<string, string>, state: string): Record<string, string> {
  const cfg = loadProbeConfig()
  const env: Record<string, string> = { ...(process.env as Record<string, string>), VCS_STATE: state }
  for (const [k, v] of Object.entries(attrs)) {
    env[`${cfg.envPrefix}${k.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`] = v
  }
  return env
}

/**
 * shell 探活（还原真实 VCS Application agent 的 MonitorProgram 形态，跨平台）：
 * 解释器按集群平台从探测配置取（Linux/Unix/AIX/HP-UX/Solaris → /bin/sh；W2K3/W2K8 → cmd.exe），
 * Windows 专属服务探活可用 `powershell:` 前缀走 PowerShell
 * ⚠️ 命令在本机真实执行（教学专用），超时可配（默认 5s）强制终止
 */
export async function runProbeShell(
  cmd: string,
  attrs: Record<string, string>,
  state: string,
  platform: string | null | undefined,
  timeoutMs?: number,
): Promise<ProbeScriptResult> {
  const { execFile } = await import('node:child_process')
  const cfg = loadProbeConfig()
  const itp: Interpreter = interpreterFor(cfg, platform)
  return new Promise((resolve) => {
    execFile(itp.file, [...itp.args, cmd], { timeout: timeoutMs ?? cfg.shell.timeoutMs, env: buildEnv(attrs, state), windowsHide: true }, (err, stdout) => {
      if (err) {
        // 非 0 退出码 = 探活失败（对齐 MonitorProgram 退出码约定）；超时 kill 同
        const killed = (err as { killed?: boolean }).killed ? '（超时终止）' : ''
        resolve({ ok: true, verdict: 'FAULTED', raw: `exit ${String(err.code ?? '?')}${killed}` })
        return
      }
      resolve({ ok: true, verdict: 'ONLINE', raw: String(stdout ?? '').trim().slice(0, 120) })
    })
  })
}

/**
 * PowerShell 探活（`powershell:` 前缀，Windows 服务/事件探活）：
 * Windows → powershell.exe；非 Windows → pwsh（PowerShell Core）
 */
export async function runProbePowerShell(
  cmd: string,
  attrs: Record<string, string>,
  state: string,
  timeoutMs?: number,
): Promise<ProbeScriptResult> {
  const { execFile } = await import('node:child_process')
  const cfg = loadProbeConfig().powershell
  const win = process.platform === 'win32'
  const file = win ? cfg.winFile : cfg.unixFile
  const args = [...(win ? cfg.winArgs : cfg.unixArgs), cmd]
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs ?? cfg.timeoutMs, env: buildEnv(attrs, state), windowsHide: true }, (err, stdout) => {
      if (err) {
        const killed = (err as { killed?: boolean }).killed ? '（超时终止）' : ''
        resolve({ ok: true, verdict: 'FAULTED', raw: `exit ${String(err.code ?? '?')}${killed}` })
        return
      }
      resolve({ ok: true, verdict: 'ONLINE', raw: String(stdout ?? '').trim().slice(0, 120) })
    })
  })
}

/**
 * HTTP/REST 探活：POST {attrs, state} 到目标 URL
 * 2xx = 健康（响应体 {verdict} 可精确判定）；非 2xx / 超时 / 不可达 = 故障
 */
export async function runProbeHttp(
  url: string,
  attrs: Record<string, string>,
  state: string,
  timeoutMs?: number,
): Promise<ProbeScriptResult> {
  const cfg = loadProbeConfig().http
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs ?? cfg.timeoutMs)
  try {
    const resp = await fetch(url, {
      method: cfg.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attrs, state }),
      signal: ctl.signal,
    })
    if (!resp.ok) return { ok: true, verdict: 'FAULTED', raw: `HTTP ${resp.status}` }
    let body: { verdict?: string } = {}
    try {
      body = (await resp.json()) as { verdict?: string }
    } catch {
      /* 非 JSON 响应按状态码判定 */
    }
    const verdict = verdictOf(String(body.verdict ?? 'ONLINE'))
    return { ok: true, verdict, raw: `HTTP ${resp.status}${body.verdict ? ' verdict=' + body.verdict : ''}` }
  } catch (e) {
    // 超时/连接失败 = 探测不可达 = 故障（对齐真实监控语义）
    return { ok: true, verdict: 'FAULTED', error: `HTTP 探测失败: ${(e as Error).message}`, raw: 'HTTP FAILED' }
  } finally {
    clearTimeout(timer)
  }
}

/** JS 沙箱表达式探活 */
export function runProbeScript(
  code: string,
  attrs: Record<string, string>,
  state: string,
  random: number,
): ProbeScriptResult {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return { ok: true, verdict: 'ONLINE' }

  for (const bad of FORBIDDEN) {
    if (trimmed.toLowerCase().includes(bad.toLowerCase())) {
      return { ok: false, verdict: 'ONLINE', error: `模拟沙箱不支持 "${bad}"（禁止循环/IO/宿主访问）` }
    }
  }

  try {
    const fn = new Function('attrs', 'state', 'random', `"use strict";\n${trimmed}`)
    const raw = fn(attrs, state, random)
    return { ok: true, verdict: verdictOf(String(raw ?? '')), raw: String(raw ?? '') }
  } catch (e) {
    return { ok: false, verdict: 'ONLINE', error: (e as Error).message }
  }
}

/** 探测形态（供日志/试跑展示） */
export type ProbeKind = 'shell' | 'powershell' | 'http' | 'multi' | 'js'

/** 解析 MonScript 形态 */
export function probeKind(script: string): ProbeKind {
  const s = (script ?? '').trim()
  if (s.startsWith('shell:')) return 'shell'
  if (s.startsWith('powershell:')) return 'powershell'
  if (/^https?:\/\//i.test(s)) return 'http'
  if (s.startsWith('{') && s.includes('"linux"')) return 'multi'
  return 'js'
}

/**
 * 统一执行入口（引擎 probeAll / resourceProbe / testscript 共用）：
 * 按 MonScript 值的四形态分流，集群平台决定平台脚本与解释器
 * @param opts.platform 集群平台（AIX/HP-UX/Solaris/Linux/W2K3/W2K8）
 */
export async function runProbeEntry(opts: {
  platform: string | null | undefined
  script: string
  attrs: Record<string, string>
  state: string
  random: number
}): Promise<ProbeScriptResult & { kind: ProbeKind }> {
  const { platform, attrs, state, random } = opts
  const script = (opts.script ?? '').trim()
  const kind = probeKind(script)

  // ① shell 单命令：解释器按集群平台映射
  if (kind === 'shell') {
    const r = await runProbeShell(script.slice(6).trim(), attrs, state, platform)
    return { ...r, kind }
  }
  // ② PowerShell
  if (kind === 'powershell') {
    const r = await runProbePowerShell(script.slice(11).trim(), attrs, state)
    return { ...r, kind }
  }
  // ③ HTTP/REST
  if (kind === 'http') {
    const r = await runProbeHttp(script, attrs, state)
    return { ...r, kind }
  }
  // ④ JSON 多平台块：按集群平台选平台脚本（二开扩展）
  if (kind === 'multi') {
    try {
      const block = JSON.parse(script) as MultiPlatformProbe
      const isWin = platform === 'W2K3' || platform === 'W2K8'
      const cmd = isWin ? block.windows : block.platform === 'Unix' || ['AIX', 'HP-UX', 'Solaris'].includes(platform ?? '') ? (block.unix ?? block.linux) : block.linux
      if (!cmd) return { ok: false, verdict: 'ONLINE', kind: 'multi', error: `多平台块缺少 ${isWin ? 'windows' : 'linux'} 脚本` }
      const timeout = block.timeoutMs
      if (isWin && cmd.startsWith('PS>')) {
        const r = await runProbePowerShell(cmd.slice(3).trim(), attrs, state, timeout)
        return { ...r, kind: 'multi' }
      }
      const r = await runProbeShell(cmd, attrs, state, platform, timeout)
      return { ...r, kind: 'multi' }
    } catch (e) {
      return { ok: false, verdict: 'ONLINE', kind: 'multi', error: `多平台块解析失败: ${(e as Error).message}` }
    }
  }
  // ⑤ JS 沙箱
  const r = runProbeScript(script, attrs, state, random)
  return { ...r, kind: 'js' }
}

/** 内置示例脚本（前端提示与测试按钮用；覆盖四种形态） */
export const PROBE_EXAMPLES: { title: string; code: string }[] = [
  { title: 'JS：按属性判故障（Listener 为空则故障）', code: `return attrs.Listener ? 'ONLINE' : 'FAULTED'` },
  { title: 'JS：10% 概率偶发故障', code: `return random < 0.1 ? 'FAULTED' : 'ONLINE'` },
  { title: 'shell：Linux 进程探活（解释器随集群平台）', code: `shell:pgrep -x mysqld` },
  { title: 'PowerShell：Windows 服务探活', code: `powershell:(Get-Service MSSQLSERVER).Status -eq 'Running'` },
  { title: 'HTTP：REST 接口探活（POST {attrs,state}）', code: `http://127.0.0.1:8080/health` },
  {
    title: '多平台块：Linux/Windows 各配各的（按集群平台自动选择）',
    code: `{"linux":"pgrep -x mysqld","windows":"powershell (Get-Service MSSQLSERVER).Status -eq 'Running'","timeoutMs":5000}`,
  },
]
