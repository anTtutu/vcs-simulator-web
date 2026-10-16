/**
 * 文件：src/domain/types.ts
 * 用途：VCS 模拟器领域模型与状态枚举（全后端共享的唯一类型权威）
 *       M1 阶段前端在 src/api/types.ts 有一份只读镜像（避免引包复杂度）
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 集群生命周期状态（对应 Windows 版列表页灰色/绿色图标） */
export type ClusterStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING'

/** 节点（System）状态：集群 RUNNING 时 ONLINE */
export type SystemStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN'

/**
 * 资源状态机（对齐真实 VCS 子集）：
 * OFFLINE → STARTING → ONLINE →(探测失败)→ FAULTED →(clear)→ OFFLINE
 * STARTING/STOPPING 为过渡态；Enabled=false 的资源恒为 UNKNOWN
 */
export type ResourceState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'FAULTED'
  | 'STARTING'
  | 'STOPPING'
  | 'WAITING'
  | 'UNKNOWN'

/** 服务组状态（M1 仅 OFFLINE/ONLINE 展示，M2 引擎接管后启用全集） */
export type GroupState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'FAULTED'
  | 'PARTIAL'
  | 'STARTING'
  | 'STOPPING'
  | 'UNKNOWN'

/** 支持的平台（与 Windows 版列表一致） */
export const PLATFORMS = ['AIX', 'Solaris', 'HP-UX', 'Linux', 'W2K3', 'W2K8'] as const
export type Platform = (typeof PLATFORMS)[number]

/** 集群 */
export interface Cluster {
  id: number
  name: string
  platform: Platform | string
  status: ClusterStatus
  simulator_port: number
  wac_port: number
  global_enabled: number // 0/1
  created_at: string
}

/** 节点（sys1/sys2 ...） */
export interface VcsSystem {
  id: number
  cluster_id: number
  name: string
  status: SystemStatus
}

/** 服务组 */
export interface ServiceGroup {
  id: number
  cluster_id: number
  name: string
  /** JSON：[{ name, priority }]，priority 决定 failover 顺序（M2 使用） */
  system_list: string
  /** JSON：[name] 自动启动节点列表 */
  autostart_list: string
  state: GroupState
  current_system: string | null
}

/** 资源类型（组件模板，内置 13 种） */
export interface ResourceType {
  id: number
  code: string
  label: string
  category: string
  icon: string
  monitor_interval: number
  /** JSON：属性 schema [{ key,label,type,required,default }] */
  attr_schema: string
  builtin: number
}

/** 属性 schema 条目 */
export interface AttrSchemaItem {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  default?: string
}

/** 资源 */
export interface Resource {
  id: number
  group_id: number
  type_id: number
  name: string
  enabled: number // 0/1
  critical: number // 0/1
  state: ResourceState
  /** 注入的持续故障标记：1 时每次 probe 复燃为 FAULTED（M2 使用） */
  monitor_break: number
}

/** 资源依赖边：child requires parent（画布上 child 在上层） */
export interface ResourceLink {
  id: number
  group_id: number
  child_id: number
  parent_id: number
}

/** 引擎事件（SSE 包络）：前端动画的唯一驱动源 */
export interface EngineEvent {
  seq: number
  ts: number
  type:
    | 'cluster.status'
    | 'system.status'
    | 'group.state'
    | 'resource.state'
    | 'log.append'
  clusterId: number
  payload: Record<string, unknown>
}

/** 事件日志行（engine_A.log 对应物） */
export interface EventLogRow {
  id: number
  cluster_id: number
  level: 'INFO' | 'WARN' | 'ERROR'
  scope: 'CLUSTER' | 'GROUP' | 'RESOURCE' | 'SYSTEM' | 'ENGINE'
  target: string | null
  action: string
  detail: string | null
  created_at: string
}
