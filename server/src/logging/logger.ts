/**
 * 文件：src/logging/logger.ts
 * 用途：统一调试日志模块（零依赖）——
 *       · 分级：DEBUG/INFO/WARN/ERROR（VCS_LOG_LEVEL 控制，默认 INFO）
 *       · 按天落盘：logs/server-YYYYMMDD.log；ERROR 另写 logs/error-YYYYMMDD.log 便于只看问题
 *       · 业务事件日志镜像（event_log → logs/event-YYYYMMDD.log）见 eventFile.ts
 *       · 目录由 VCS_LOG_DIR 控制（默认 ./logs；单测指向临时目录）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import fs from 'node:fs'
import path from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** 当前级别（每次调用动态读环境变量，便于单测切换） */
function currentLevel(): Level {
  const raw = (process.env.VCS_LOG_LEVEL || 'info').toLowerCase()
  return (['debug', 'info', 'warn', 'error'].includes(raw) ? raw : 'info') as Level
}

/** 日志目录 */
function logDir(): string {
  return process.env.VCS_LOG_DIR || './logs'
}

/** 本地时间戳：2026-10-15 21:30:00.123 */
function ts(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** 按天文件名后缀：20261015 */
function ymd(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 追加一行到指定按天文件（目录不存在自动建） */
function append(base: string, line: string): void {
  try {
    const dir = logDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, `${base}-${ymd()}.log`), line + '\n')
  } catch {
    // 日志写失败不反噬业务（磁盘满/权限等），静默
  }
}

/** 核心输出 */
function emit(level: Level, mod: string, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return
  const line = `${ts()} [${level.toUpperCase().padEnd(5)}] [${mod}] ${msg}${meta ? ' ' + safeJson(meta) : ''}`
  append('server', line)
  if (level === 'error') append('error', line) // 错误单独成文件，只看问题
  // 控制台同步输出（dev 观感；error/warn 走 stderr）
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/** meta 序列化兜底（循环引用等） */
function safeJson(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta)
  } catch {
    return '(unserializable meta)'
  }
}

export const logger = {
  debug: (mod: string, msg: string, meta?: Record<string, unknown>) => emit('debug', mod, msg, meta),
  info: (mod: string, msg: string, meta?: Record<string, unknown>) => emit('info', mod, msg, meta),
  warn: (mod: string, msg: string, meta?: Record<string, unknown>) => emit('warn', mod, msg, meta),
  error: (mod: string, msg: string, meta?: Record<string, unknown>) => emit('error', mod, msg, meta),

  /** 初始化：建目录 + 清理保留期外的旧日志（默认 14 天） */
  init(keepDays = 14): { dir: string; removed: number } {
    const dir = logDir()
    fs.mkdirSync(dir, { recursive: true })
    let removed = 0
    const cutoff = Date.now() - keepDays * 86400_000
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/-(\d{8})\.log$/)
      if (!m) continue
      const d = m[1]
      const fileTime = new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))).getTime()
      if (fileTime < cutoff) {
        try {
          fs.rmSync(path.join(dir, f))
          removed++
        } catch {
          /* 忽略 */
        }
      }
    }
    return { dir, removed }
  },
}
