/**
 * 文件：src/routes/real.routes.ts
 * 用途：真实模式路由（真实服务器 SSH 连接）—— 连接管理 / 命令执行（白名单） / 状态聚合
 *       ⚠️ 真实命令直接作用于真实 VCS 集群，前端操作需二次确认；白名单可用 VCS_REAL_ALLOW_ANY=1 放开
 * 作者：Anttu
 * 日期：2026-10-16
 */
import { Router } from 'express'
import { BizError } from '../domain/clusterLifecycle.js'
import { requireRole, OPERATOR } from './roles.js'
import {
  connectReal,
  disconnectReal,
  execReal,
  getRealConnection,
  listRealConnections,
  commandAllowed,
  REAL_ALLOW_PREFIX,
} from '../real/sshPool.js'

/**
 * 组装真实模式路由（/api/real/*）
 * @returns Express Router
 */
export function realRoutes(): Router {
  const router = Router()

  /** 连接列表 */
  router.get('/connections', (_req, res) => {
    res.json(listRealConnections())
  })

  /** 建立连接 { host, port?, username, password?, privateKey? }（Operator+） */
  router.post('/connections', requireRole(...OPERATOR), async (req, res, next) => {
    try {
      const { host, port = 22, username, password, privateKey } = req.body ?? {}
      if (!host || !username) throw new BizError(400, 'host 与 username 必填')
      const conn = await connectReal({
        host: String(host),
        port: Number(port) || 22,
        username: String(username),
        password: password ? String(password) : undefined,
        privateKey: privateKey ? String(privateKey) : undefined,
      })
      res.status(201).json({ id: conn.id, host: conn.host, port: conn.port, username: conn.username })
    } catch (e) {
      next(e)
    }
  })

  /** 断开连接（Operator+） */
  router.delete('/connections/:id', requireRole(...OPERATOR), (req, res) => {
    if (!disconnectReal(req.params.id)) throw new BizError(404, '连接不存在')
    res.status(204).end()
  })

  /**
   * 状态聚合：一次拉取真实集群全景（hastatus/hasys/hagrp/hares/gabconfig）
   * GET /api/real/:id/status
   */
  router.get('/:id/status', async (req, res, next) => {
    try {
      const id = req.params.id
      if (!getRealConnection(id)) throw new BizError(404, '连接不存在或已断开')
      const commands: { name: string; command: string }[] = [
        { name: 'nodes', command: 'hasys -state' },
        { name: 'groups', command: 'hagrp -state' },
        { name: 'resources', command: 'hares -state' },
        { name: 'gab', command: 'gabconfig -a' },
        { name: 'llt', command: 'lltstat -nvv' },
      ]
      const out: Record<string, { command: string; stdout: string; stderr: string; code: number | null }> = {}
      for (const c of commands) {
        try {
          out[c.name] = { command: c.command, ...(await execReal(id, c.command, 12_000)) }
        } catch (e) {
          out[c.name] = { command: c.command, stdout: '', stderr: (e as Error).message, code: -1 }
        }
      }
      res.json(out)
    } catch (e) {
      next(e)
    }
  })

  /** 执行命令 { command }（Operator+，白名单前缀；返回 stdout/stderr/exitCode） */
  router.post('/:id/exec', requireRole(...OPERATOR), async (req, res, next) => {
    try {
      const command = String(req.body?.command ?? '').trim()
      if (!command) throw new BizError(400, '命令不能为空')
      if (!commandAllowed(command)) {
        throw new BizError(
          403,
          `命令不在白名单内（允许前缀：${REAL_ALLOW_PREFIX.join(' / ')}）。如需放开设置环境变量 VCS_REAL_ALLOW_ANY=1（风险自担）`,
        )
      }
      const timeoutMs = Math.min(Number(req.body?.timeoutMs) || 15_000, 60_000)
      res.json({ command, ...(await execReal(req.params.id, command, timeoutMs)) })
    } catch (e) {
      next(e)
    }
  })

  return router
}
