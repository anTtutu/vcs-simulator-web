/**
 * 文件：src/db/migrate.ts
 * 用途：建表 DDL（设计报告 §4.3 的 7 张表），幂等执行
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type Database from 'better-sqlite3'

/**
 * 执行建表迁移（CREATE TABLE IF NOT EXISTS，可重复调用）
 * @param db 已打开的数据库连接
 */
export function migrate(db: Database.Database): void {
  db.exec(`
-- 集群
CREATE TABLE IF NOT EXISTS cluster (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  platform       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'STOPPED',
  simulator_port INTEGER NOT NULL,
  wac_port       INTEGER NOT NULL DEFAULT -1,
  global_enabled INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 节点（系统）
CREATE TABLE IF NOT EXISTS system (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL REFERENCES cluster(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OFFLINE',
  UNIQUE(cluster_id, name)
);

-- 服务组
CREATE TABLE IF NOT EXISTS service_group (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id     INTEGER NOT NULL REFERENCES cluster(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  system_list    TEXT NOT NULL,
  autostart_list TEXT NOT NULL DEFAULT '[]',
  state          TEXT NOT NULL DEFAULT 'OFFLINE',
  current_system TEXT,
  UNIQUE(cluster_id, name)
);

-- 资源类型（组件模板库）
CREATE TABLE IF NOT EXISTS resource_type (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  category         TEXT NOT NULL,
  icon             TEXT NOT NULL,
  monitor_interval INTEGER NOT NULL DEFAULT 60,
  attr_schema      TEXT NOT NULL DEFAULT '[]',
  builtin          INTEGER NOT NULL DEFAULT 1
);

-- 资源
CREATE TABLE IF NOT EXISTS resource (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES service_group(id) ON DELETE CASCADE,
  type_id       INTEGER NOT NULL REFERENCES resource_type(id),
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  critical      INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'OFFLINE',
  monitor_break INTEGER NOT NULL DEFAULT 0,
  UNIQUE(group_id, name)
);

-- 资源属性（system_id 为空 = 全局值，非空 = per-system 覆盖）
CREATE TABLE IF NOT EXISTS resource_attr (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT,
  system_id   INTEGER REFERENCES system(id) ON DELETE CASCADE,
  UNIQUE(resource_id, key, system_id)
);

-- 依赖边：child requires parent
CREATE TABLE IF NOT EXISTS resource_link (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL REFERENCES service_group(id) ON DELETE CASCADE,
  child_id  INTEGER NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  parent_id INTEGER NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  UNIQUE(child_id, parent_id)
);

-- 事件日志
CREATE TABLE IF NOT EXISTS event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL,
  level      TEXT NOT NULL,
  scope      TEXT NOT NULL,
  target     TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_resource_group ON resource(group_id);
CREATE INDEX IF NOT EXISTS idx_attr_resource ON resource_attr(resource_id);
CREATE INDEX IF NOT EXISTS idx_link_group ON resource_link(group_id);
CREATE INDEX IF NOT EXISTS idx_event_cluster ON event_log(cluster_id, id);

-- 跨集群容灾分组（Global View）：cluster_ids JSON 顺序即 主站→备站
CREATE TABLE IF NOT EXISTS global_group (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  cluster_ids TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 心跳链路（LLT）：每集群固定 link0/link1，双断 = 脑裂冻结
CREATE TABLE IF NOT EXISTS cluster_link (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL REFERENCES cluster(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'UP',
  UNIQUE(cluster_id, name)
);

-- 配置快照（回滚/对比）
CREATE TABLE IF NOT EXISTS config_snapshot (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL REFERENCES cluster(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  main_cf    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 资源画布坐标（自由拖拽持久化；无记录 = 走自动分层布局）
CREATE TABLE IF NOT EXISTS resource_pos (
  resource_id INTEGER PRIMARY KEY REFERENCES resource(id) ON DELETE CASCADE,
  x REAL NOT NULL,
  y REAL NOT NULL
);
`)

  // ---- 心跳链路回填：为所有尚无 link0/link1 的集群补齐（幂等） ----
  db.prepare(
    `INSERT INTO cluster_link (cluster_id, name)
     SELECT c.id, 'link0' FROM cluster c
     WHERE NOT EXISTS (SELECT 1 FROM cluster_link l WHERE l.cluster_id = c.id AND l.name = 'link0')`,
  ).run()
  db.prepare(
    `INSERT INTO cluster_link (cluster_id, name)
     SELECT c.id, 'link1' FROM cluster c
     WHERE NOT EXISTS (SELECT 1 FROM cluster_link l WHERE l.cluster_id = c.id AND l.name = 'link1')`,
  ).run()
}
