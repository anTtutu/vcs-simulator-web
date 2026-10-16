/**
 * 文件：test/logger-helpers.ts
 * 用途：logger 测试辅助 —— 本地日期的按天文件后缀（与 logger.ts 的 ymd 保持同一时区口径）
 * 作者：Anttu
 * 日期：2026-10-15
 */

/**
 * 取本地日期后缀 20261015
 * @param d 日期
 */
export function ymdOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}
