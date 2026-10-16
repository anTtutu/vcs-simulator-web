/**
 * 文件：src/db/connection.ts
 * 用途：better-sqlite3 连接管理 + PRAGMA 初始化 + 建表迁移入口
 * 作者：Anttu
 * 日期：2026-10-15
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { migrate } from './migrate.js'

/**
 * 打开（必要时创建）SQLite 数据库并完成迁移
 * @param dbPath 库文件路径；缺省取环境变量 VCS_DB_PATH，最终回退 server/data/vcs-simulator.db
 * @returns Database 实例（WAL + 外键已开启）
 */
export function openDb(dbPath?: string): Database.Database {
  const file = path.resolve(dbPath ?? process.env.VCS_DB_PATH ?? './data/vcs-simulator.db')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL') // 写并发友好
  db.pragma('foreign_keys = ON') // 级联删除依赖外键
  db.pragma('synchronous = NORMAL')
  migrate(db)
  return db
}
