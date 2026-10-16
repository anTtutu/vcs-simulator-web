/**
 * 文件：src/routes/roles.ts
 * 用途：演示级角色控制（P2-3）—— Administrator / Operator / Observer
 *       角色在登录时选择，经请求头 X-VCS-Role 传递；缺省 Administrator 兼容单测
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { Request, Response, NextFunction } from 'express'
import { BizError } from '../domain/clusterLifecycle.js'

/** 从请求解析角色 */
export function roleOf(req: Request): string {
  return (req.headers['x-vcs-role'] as string) || 'Administrator'
}

/** 角色中间件：roles 至少包含其一才放行 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = roleOf(req)
    if (!roles.includes(role)) {
      next(new BizError(403, `当前角色 ${role} 无权限执行该操作（需要 ${roles.join('/')}）`))
      return
    }
    next()
  }
}

/** 角色常量 */
export const OPERATOR = ['Administrator', 'Operator']
export const ADMIN = ['Administrator']
