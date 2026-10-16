/**
 * 文件：src/index.ts
 * 用途：服务入口 —— Express 装配、DB 初始化与种子、静态托管前端构建产物
 * 作者：Anttu
 * 日期：2026-10-15
 */
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db/connection.js'
import { seedResourceTypes } from './db/seed/types.seed.js'
import { seedDemoClusters } from './db/seed/clusters.seed.js'
import { Repo } from './db/repo.js'
import { EventBus } from './events/bus.js'
import { ClusterEngine } from './engine/clusterEngine.js'
import { GroupEngine } from './engine/groupEngine.js'
import { ScenarioRunner } from './engine/scenario.js'
import { BizError } from './domain/clusterLifecycle.js'
import { clusterRoutes } from './routes/clusters.routes.js'
import { miscRoutes } from './routes/misc.routes.js'
import { opsRoutes } from './routes/ops.routes.js'
import { realRoutes } from './routes/real.routes.js'
import { logger } from './logging/logger.js'
import { requestLogger } from './logging/middleware.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------- 初始化：日志 → DB → 种子 → 组件 ----------
const logInfo = logger.init(14) // 建目录 + 清理 14 天前旧日志
logger.info('boot', 'VCS Simulator 服务启动', { logDir: logInfo.dir, removedOld: logInfo.removed, node: process.version })

const db = openDb()
seedResourceTypes(db)
seedDemoClusters(db)

const repo = new Repo(db)
const bus = new EventBus()
const groupEngine = new GroupEngine(repo, bus)
const engine = new ClusterEngine(
  repo,
  bus,
  (clusterId) => groupEngine.cancelClusterOps(clusterId),
  (clusterId) => groupEngine.autoStartGroups(clusterId),
)
const scenarioRunner = new ScenarioRunner(repo, bus, engine, groupEngine)

const app = express()
app.use(requestLogger)
app.use(express.json())

// ---------- 路由 ----------
app.use('/api/clusters', clusterRoutes(repo, engine))
app.use('/api', opsRoutes(repo, groupEngine, engine, scenarioRunner, db))
app.use('/api/real', realRoutes())
app.use('/api', miscRoutes(repo, bus))

// ---------- 生产模式：托管前端构建产物（web/dist） ----------
const webDist = path.resolve(__dirname, '../../web/dist')
app.use(express.static(webDist))
// SPA history 路由回退（/explorer/:id 刷新直达）
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'))
})

// ---------- 统一错误处理：BizError 携带 HTTP 状态码 ----------
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof BizError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    // SQLite 唯一键冲突等常见错误兜底
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: '名称冲突：' + msg })
      return
    }
    // 资源不存在类错误统一 404（NaN/越界 id 等）
    if (msg.includes('不存在')) {
      res.status(404).json({ error: msg })
      return
    }
    console.error('[server] 未处理异常:', err)
    logger.error('http', '未处理异常', { err: String(err) })
    res.status(500).json({ error: '服务器内部错误：' + msg })
  },
)

// ---------- 进程级兜底：未捕获异常/Reject 必须落盘 ----------
process.on('uncaughtException', (err) => {
  logger.error('process', 'uncaughtException', { err: String(err?.stack ?? err) })
})
process.on('unhandledRejection', (reason) => {
  logger.error('process', 'unhandledRejection', { reason: String(reason) })
})

const PORT = Number(process.env.PORT) || 3100
app.listen(PORT, () => {
  logger.info('boot', `HTTP 服务已监听`, { port: PORT, db: process.env.VCS_DB_PATH ?? './data/vcs-simulator.db' })
  console.log(`[server] VCS Simulator 已启动: http://localhost:${PORT}`)
})

export { app }
