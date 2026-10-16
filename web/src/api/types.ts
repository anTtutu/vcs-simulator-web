/**
 * 文件：src/api/types.ts
 * 用途：后端 REST/SSE 数据结构的前端镜像（与服务端 src/domain/types.ts 保持一致）
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 集群 */
export interface Cluster {
  id: number
  name: string
  platform: string
  status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING'
  simulator_port: number
  wac_port: number
  global_enabled: number
  created_at: string
  /** 仅详情接口携带 */
  systems?: SystemInfo[]
}

/** 节点 */
export interface SystemInfo {
  id: number
  name: string
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
}

/** 属性 schema 条目（动态表单用） */
export interface AttrSchemaItem {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  default?: string
}

/** 拓扑树资源节点 */
export interface TreeResource {
  id: number
  name: string
  typeCode: string
  icon: string
  enabled: boolean
  critical: boolean
  state: string
  schema: AttrSchemaItem[]
  /** 画布保存坐标（自由拖拽持久化） */
  pos: { x: number; y: number } | null
  attrs: Record<string, string>
  overrides: { systemId: number; key: string; value: string }[]
  parents: number[]
  children: number[]
}

/** 拓扑树服务组 */
export interface TreeGroup {
  id: number
  name: string
  state: string
  systemList: { name: string; priority: number }[]
  autostartList: string[]
  currentSystem: string | null
  resources: TreeResource[]
}

/** 拓扑树整体 */
export interface ClusterTree {
  cluster: Cluster
  systems: SystemInfo[]
  groups: TreeGroup[]
}

/** 资源类型模板 */
export interface ResourceType {
  id: number
  code: string
  label: string
  category: string
  icon: string
  monitor_interval: number
  attr_schema: string
  builtin: number
}

/** Verify 结果 */
export interface VerifyResult {
  ok: boolean
  items: { level: 'error' | 'warning'; target: string; message: string }[]
}

/** 事件日志行 */
export interface EventLogRow {
  id: number
  level: 'INFO' | 'WARN' | 'ERROR'
  scope: string
  target: string | null
  action: string
  detail: string | null
  created_at: string
}

/** main.cf 导入结果 */
export interface CfImportResult {
  clusterId: number
  clusterName: string
  groups: number
  resources: number
  links: number
  warnings: string[]
}

/** CLI 执行结果 */
export interface CliResult {
  output: string[]
  clear?: boolean
}

/** 监控总览行（P0-2） */
export interface OverviewRow {
  id: number
  name: string
  platform: string
  status: string
  simulator_port: number
  groupsTotal: number
  groupsOnline: number
  sysTotal: number
  sysOnline: number
  linksDown: number
  linkStatus: 'Up' | 'Degraded' | 'Down'
}

/** Global 容灾分组（P0-1） */
export interface GlobalGroup {
  id: number
  name: string
  clusters: {
    id: number
    name: string
    platform: string
    status: string
    port: number
    groups: { name: string; state: string; currentSystem: string | null }[]
  }[]
}

/** 快照 */
export interface SnapshotRow {
  id: number
  label: string
  created_at: string
}

/** 剧本定义 */
export interface ScenarioDef {
  key: string
  title: string
  desc: string
  needRunning: boolean
  needGroupOnline: boolean
  durationMs: number
}

/** 探测脚本试跑结果 */
export interface ProbeScriptResult {
  ok: boolean
  verdict: 'ONLINE' | 'FAULTED'
  error?: string
  raw?: string
}

/** 探测脚本示例 */
export interface ProbeExample {
  title: string
  code: string
}

/** 心跳链路 */
export interface ClusterLink {
  name: string
  status: 'UP' | 'DOWN'
}

/** SSE 引擎事件包络 */
export interface EngineEvent {
  seq: number
  ts: number
  type: 'cluster.status' | 'system.status' | 'group.state' | 'resource.state' | 'log.append'
  clusterId: number
  payload: Record<string, unknown>
}
