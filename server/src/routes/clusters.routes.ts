/**
 * 文件：src/routes/clusters.routes.ts
 * 用途：集群管理 REST 路由 —— 列表/新建/详情/修改/删除/启停/校验/拓扑树/事件日志
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { Router } from 'express'
import type { Repo } from '../db/repo.js'
import type { ClusterEngine } from '../engine/clusterEngine.js'
import { BizError } from '../domain/clusterLifecycle.js'
import { verifyCluster } from '../domain/verify.js'
import { requireRole, ADMIN } from './roles.js'
import { PLATFORMS } from '../domain/types.js'

/**
 * 组装集群路由
 * @param repo 数据仓储
 * @param engine 集群引擎
 * @returns Express Router
 */
export function clusterRoutes(repo: Repo, engine: ClusterEngine): Router {
  const router = Router()

  /** 集群列表 */
  router.get('/', (_req, res) => {
    res.json(repo.listClusters())
  })

  /** 新建集群（Admin）{ name, platform, systemCount? } */
  router.post('/', requireRole(...ADMIN), (req, res) => {
    const { name, platform, systemCount = 2 } = req.body ?? {}
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      throw new BizError(400, '集群名不合法（字母开头，仅字母/数字/下划线）')
    }
    if (!PLATFORMS.includes(platform)) throw new BizError(400, `平台必须为：${PLATFORMS.join('/')}`)
    if (repo.listClusters().some((c) => c.name === name)) throw new BizError(409, `集群名 ${name} 已存在`)
    const n = Math.min(Math.max(Number(systemCount) || 2, 1), 4)
    const id = repo.createCluster(name, platform, Array.from({ length: n }, (_, i) => `sys${i + 1}`))
    // 返回详情（含节点列表），与 GET /:id 结构一致
    res.status(201).json({ ...repo.getCluster(id), systems: repo.listSystems(id) })
  })

  /** 集群详情（含节点与心跳链路） */
  router.get('/:id', (req, res) => {
    const id = Number(req.params.id)
    res.json({ ...repo.getCluster(id), systems: repo.listSystems(id), links: repo.listLinks(id) })
  })

  /** 修改集群（M1：全局选项 / WAC 端口） */
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id)
    repo.updateCluster(id, {
      global_enabled: req.body?.global_enabled === true || req.body?.global_enabled === 1 ? 1 : 0,
      wac_port: Number.isFinite(Number(req.body?.wac_port)) ? Number(req.body.wac_port) : undefined,
    })
    res.json(repo.getCluster(id))
  })

  /** 删除集群（Admin；仅 STOPPED 且非启停中） */
  router.delete('/:id', requireRole(...ADMIN), (req, res) => {
    const id = Number(req.params.id)
    const cluster = repo.getCluster(id)
    if (engine.isBusy(id)) throw new BizError(409, '集群正在启停中，不能删除')
    if (cluster.status !== 'STOPPED') throw new BizError(409, `集群状态为 ${cluster.status}，请先停止集群`)
    engine.cancelPending(id)
    repo.deleteCluster(id)
    res.status(204).end()
  })

  /** 启动集群 */
  router.post('/:id/start', (req, res) => {
    engine.start(Number(req.params.id))
    res.json({ ok: true })
  })

  /** 停止集群 */
  router.post('/:id/stop', (req, res) => {
    engine.stop(Number(req.params.id))
    res.json({ ok: true })
  })

  /** 校验配置（Verify Configuration） */
  router.post('/:id/verify', (req, res) => {
    const id = Number(req.params.id)
    repo.getCluster(id)
    res.json(verifyCluster(repo.getVerifyModel(id)))
  })

  /** 拓扑树（Explorer 页数据源） */
  router.get('/:id/tree', (req, res) => {
    res.json(repo.getTree(Number(req.params.id)))
  })

  /** 事件日志（?limit=50） */
  router.get('/:id/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    res.json(repo.listEvents(Number(req.params.id), limit))
  })

  return router
}
