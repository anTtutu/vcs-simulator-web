/**
 * 文件：src/logging/eventFile.ts
 * 用途：业务事件日志（event_log 表）的按天文件镜像 —— 方便直接翻文件查阅问题
 *       格式对齐真实 VCS engine_A.log 的观感：
 *       2026-10-15 21:14:10 [ERROR] [RESOURCE] ORA_oraprod FAULT 周期监控发现持续故障
 * 作者：Anttu
 * 日期：2026-10-15
 */
import fs from 'node:fs'
import path from 'node:path'

/** 事件日志行（与 event_log 表字段对齐） */
export interface EventMirrorRow {
  level: string
  scope: string
  target: string | null
  action: string
  detail: string | null
}

/** 本地时间戳（秒级，与表内 created_at 观感一致） */
function ts(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 按天文件名后缀 */
function ymd(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/**
 * 追加一条事件到 logs/event-YYYYMMDD.log（写失败静默，不反噬业务）
 * @param row 事件行
 */
export function appendEventFile(row: EventMirrorRow): void {
  try {
    const dir = process.env.VCS_LOG_DIR || './logs'
    fs.mkdirSync(dir, { recursive: true })
    const line = `${ts()} [${row.level.padEnd(5)}] [${row.scope}] ${row.target ?? '-'} ${row.action} ${row.detail ?? ''}`.trimEnd()
    fs.appendFileSync(path.join(dir, `event-${ymd()}.log`), line + '\n')
  } catch {
    // 静默
  }
}
