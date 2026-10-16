/**
 * 文件：test/helpers.ts
 * 用途：单测公共装配 —— 每个测试文件独立临时 SQLite + 完整应用上下文
 * 作者：Anttu
 * 日期：2026-10-15
 */
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { openDb } from '../src/db/connection.js'
import { seedResourceTypes } from '../src/db/seed/types.seed.js'
import { seedDemoClusters } from '../src/db/seed/clusters.seed.js'
import { Repo } from '../src/db/repo.js'
import { EventBus } from '../src/events/bus.js'
import { ClusterEngine } from '../src/engine/clusterEngine.js'
import { GroupEngine } from '../src/engine/groupEngine.js'
import { ScenarioRunner } from '../src/engine/scenario.js'
import { clusterRoutes } from '../src/routes/clusters.routes.js'
import { miscRoutes } from '../src/routes/misc.routes.js'
import { opsRoutes } from '../src/routes/ops.routes.js'
import { requestLogger } from '../src/logging/middleware.js'

/** 测试上下文：DB + 各层组件 + 可供 supertest 的 app */
export interface TestCtx {
  db: Database.Database
  dbFile: string
  repo: Repo
  bus: EventBus
  engine: ClusterEngine
  groupEngine: GroupEngine
  scenario: ScenarioRunner
  app: express.Express
}

/**
 * 创建独立测试上下文（真实临时文件库 + 完整种子数据）
 * @returns 测试上下文
 */
export function createTestCtx(): TestCtx {
  const dbFile = path.join(os.tmpdir(), `vcs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  // 日志同样指向独立临时目录，避免污染开发日志（logger/eventFile 每次调用动态读环境变量）
  process.env.VCS_LOG_DIR = path.join(os.tmpdir(), `vcs-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const db = openDb(dbFile)
  seedResourceTypes(db)
  seedDemoClusters(db)
  const repo = new Repo(db)
  const bus = new EventBus()
  const groupEngine = new GroupEngine(repo, bus)
  const engine = new ClusterEngine(
    repo,
    bus,
    (cid) => groupEngine.cancelClusterOps(cid),
    (cid) => groupEngine.autoStartGroups(cid),
  )
  const scenario = new ScenarioRunner(repo, bus, engine, groupEngine)
  const app = express()
  app.use(requestLogger)
  app.use(express.json())
  app.use('/api/clusters', clusterRoutes(repo, engine))
  app.use('/api', opsRoutes(repo, groupEngine, engine, scenario, db))
  app.use('/api', miscRoutes(repo, bus))
  return { db, dbFile, repo, bus, engine, groupEngine, scenario, app }
}

/** 清理临时库文件 */
export function cleanupCtx(ctx: TestCtx): void {
  ctx.db.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(ctx.dbFile + suffix)
    } catch {
      /* 忽略清理失败 */
    }
  }
}

/** 按名称取种子集群 id */
export function clusterIdByName(ctx: TestCtx, name: string): number {
  const row = ctx.db.prepare('SELECT id FROM cluster WHERE name = ?').get(name) as { id: number }
  if (!row) throw new Error(`种子集群不存在: ${name}`)
  return row.id
}
