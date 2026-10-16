/**
 * 文件：src/logging/middleware.ts
 * 用途：HTTP 请求日志中间件 —— method/path/status/耗时；
 *       5xx → ERROR、4xx → WARN、其余 → DEBUG（避免 INFO 噪音）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Request, Response, NextFunction } from 'express'
import { logger } from './logger.js'

/**
 * 请求日志：响应完成时（finish）记录一条
 * @param req 请求
 * @param res 响应
 * @param next 下一步
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - start
    const msg = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`
    if (res.statusCode >= 500) logger.error('http', msg)
    else if (res.statusCode >= 400) logger.warn('http', msg)
    else logger.debug('http', msg)
  })
  next()
}
