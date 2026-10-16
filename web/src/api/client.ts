/**
 * 文件：src/api/client.ts
 * 用途：REST 客户端 —— 统一 json fetch 封装与错误透传
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type {
  CfImportResult,
  CliResult,
  Cluster,
  ClusterTree,
  EventLogRow,
  GlobalGroup,
  OverviewRow,
  ProbeExample,
  ProbeScriptResult,
  ResourceType,
  ScenarioDef,
  SnapshotRow,
  VerifyResult,
  ClusterLink,
} from './types'

/** 演示级角色（登录时选择，随请求头传递；缺省 Administrator 兼容） */
function roleHeader(): Record<string, string> {
  return { 'X-VCS-Role': sessionStorage.getItem('vcs_role') || 'Administrator' }
}

/** 通用请求：非 2xx 抛出后端 error 信息 */
async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...roleHeader() },
    ...init,
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `请求失败(${res.status})`)
  return body as T
}

/** 集群相关 API */
export const api = {
  listClusters: () => http<Cluster[]>('/api/clusters'),
  getCluster: (id: number) => http<Cluster>(`/api/clusters/${id}`),
  createCluster: (data: { name: string; platform: string; systemCount: number }) =>
    http<Cluster>('/api/clusters', { method: 'POST', body: JSON.stringify(data) }),
  deleteCluster: (id: number) => http<void>(`/api/clusters/${id}`, { method: 'DELETE' }),
  startCluster: (id: number) => http<{ ok: true }>(`/api/clusters/${id}/start`, { method: 'POST' }),
  stopCluster: (id: number) => http<{ ok: true }>(`/api/clusters/${id}/stop`, { method: 'POST' }),
  verifyCluster: (id: number) => http<VerifyResult>(`/api/clusters/${id}/verify`, { method: 'POST' }),
  getTree: (id: number) => http<ClusterTree>(`/api/clusters/${id}/tree`),
  listEvents: (id: number, limit = 30) => http<EventLogRow[]>(`/api/clusters/${id}/events?limit=${limit}`),
  listResourceTypes: () => http<ResourceType[]>('/api/resource-types'),

  // ---- M2：组/资源引擎动作 ----
  createGroup: (clusterId: number, name: string, systems: string[]) =>
    http<{ id: number }>(`/api/clusters/${clusterId}/groups`, { method: 'POST', body: JSON.stringify({ name, systems }) }),
  deleteGroup: (gid: number) => http<void>(`/api/groups/${gid}`, { method: 'DELETE' }),
  groupOnline: (gid: number, system?: string) =>
    http<{ ok: true }>(`/api/groups/${gid}/online`, { method: 'POST', body: JSON.stringify({ system }) }),
  groupOffline: (gid: number) => http<{ ok: true }>(`/api/groups/${gid}/offline`, { method: 'POST' }),
  groupSwitch: (gid: number, toSystem: string) =>
    http<{ ok: true }>(`/api/groups/${gid}/switch`, { method: 'POST', body: JSON.stringify({ toSystem }) }),
  link: (gid: number, childId: number, parentId: number) =>
    http<{ ok: true }>(`/api/groups/${gid}/links`, { method: 'POST', body: JSON.stringify({ childId, parentId }) }),
  unlink: (gid: number, childId: number, parentId: number) =>
    http<{ ok: true }>(`/api/groups/${gid}/links`, { method: 'DELETE', body: JSON.stringify({ childId, parentId }) }),
  addResource: (gid: number, data: { name: string; typeCode: string; critical?: boolean; attrs?: Record<string, string> }) =>
    http<{ id: number }>(`/api/groups/${gid}/resources`, { method: 'POST', body: JSON.stringify(data) }),
  resourceAction: (rid: number, action: 'online' | 'offline' | 'prop' | 'fault' | 'clear' | 'probe') =>
    http<{ ok: true }>(`/api/resources/${rid}/${action}`, { method: 'POST' }),
  updateResource: (rid: number, patch: { enabled?: boolean; critical?: boolean }) =>
    http<{ ok: true }>(`/api/resources/${rid}`, { method: 'PUT', body: JSON.stringify(patch) }),
  saveAttributes: (rid: number, data: { attrs: Record<string, string>; overrides: { systemId: number; key: string; value: string }[] }) =>
    http<{ ok: true }>(`/api/resources/${rid}/attributes`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteResource: (rid: number) => http<void>(`/api/resources/${rid}`, { method: 'DELETE' }),

  // ---- M3：cf 导入导出 ----
  exportCf: (id: number, withTypes = false) =>
    http<{ main: string; types?: string }>(`/api/clusters/${id}/cf${withTypes ? '?types=1' : ''}`),
  importCf: (content: string) =>
    http<CfImportResult>('/api/clusters/cf/import', { method: 'POST', body: JSON.stringify({ content }) }),

  // ---- M4：CLI 控制台 ----
  console: (id: number, command: string) =>
    http<CliResult>(`/api/clusters/${id}/console`, { method: 'POST', body: JSON.stringify({ command }) }),

  // ---- 二期 P0-2：监控总览 ----
  overview: () => http<OverviewRow[]>('/api/overview'),

  // ---- 二期 P0-1：Global 容灾分组 ----
  listGlobal: () => http<GlobalGroup[]>('/api/global'),
  createGlobal: (name: string, clusterIds: number[]) =>
    http<{ id: number }>('/api/global', { method: 'POST', body: JSON.stringify({ name, clusterIds }) }),
  deleteGlobal: (gid: number) => http<void>(`/api/global/${gid}`, { method: 'DELETE' }),

  // ---- 二期 P1-1：心跳链路 ----
  setLink: (id: number, name: string, action: 'down' | 'up') =>
    http<ClusterLink[]>(`/api/clusters/${id}/links/${name}/${action}`, { method: 'POST' }),

  // ---- 二期 P1-2：位置持久化（自由拖拽） ----
  savePosition: (rid: number, x: number, y: number) =>
    http<{ ok: true }>(`/api/resources/${rid}/position`, { method: 'PUT', body: JSON.stringify({ x, y }) }),
  clearPositions: (gid: number) => http<{ ok: true }>(`/api/groups/${gid}/positions/clear`, { method: 'POST' }),

  // ---- 二期 P1-4：演练剧本 ----
  listScenarios: () => http<ScenarioDef[]>('/api/scenarios'),
  runScenario: (id: number, key: string) =>
    http<{ steps: number }>(`/api/clusters/${id}/scenarios/${key}/run`, { method: 'POST' }),
  stopScenario: (id: number) => http<{ ok: true }>(`/api/clusters/${id}/scenarios/stop`, { method: 'POST' }),

  // ---- 二期 P2-1：配置快照 ----
  listSnapshots: (id: number) => http<SnapshotRow[]>(`/api/clusters/${id}/snapshots`),
  createSnapshot: (id: number, label: string) =>
    http<{ id: number }>(`/api/clusters/${id}/snapshots`, { method: 'POST', body: JSON.stringify({ label }) }),
  getSnapshot: (sid: number) => http<{ id: number; main_cf: string; label: string }>(`/api/snapshots/${sid}`),
  restoreSnapshot: (sid: number) => http<{ ok: true }>(`/api/snapshots/${sid}/restore`, { method: 'POST' }),

  // ---- 二期 P2-2：自定义类型 ----
  createType: (data: { code: string; label: string; category?: string; icon?: string; attrs: { key: string; label?: string; type?: string; required?: boolean; default?: string }[] }) =>
    http<{ id: number }>('/api/resource-types', { method: 'POST', body: JSON.stringify(data) }),
  updateType: (tid: number, data: { label: string; category?: string; icon?: string; attrs: { key: string; label?: string; type?: string; required?: boolean; default?: string }[] }) =>
    http<{ ok: true }>(`/api/resource-types/${tid}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteType: (tid: number) => http<void>(`/api/resource-types/${tid}`, { method: 'DELETE' }),

  // ---- 二期：MonScript 探测脚本 ----
  probeExamples: () => http<ProbeExample[]>('/api/probe-examples'),
  testScript: (rid: number, script: string) =>
    http<ProbeScriptResult>(`/api/resources/${rid}/testscript`, { method: 'POST', body: JSON.stringify({ script }) }),

  // ---- 真实模式（SSH 连接真实 VCS 节点） ----
  realConnections: () => http<{ id: string; host: string; port: number; username: string }[]>('/api/real/connections'),
  realConnect: (data: { host: string; port?: number; username: string; password?: string; privateKey?: string }) =>
    http<{ id: string; host: string; username: string }>('/api/real/connections', { method: 'POST', body: JSON.stringify(data) }),
  realDisconnect: (id: string) => http<void>(`/api/real/connections/${id}`, { method: 'DELETE' }),
  realStatus: (id: string) =>
    http<Record<string, { command: string; stdout: string; stderr: string; code: number | null }>>(`/api/real/${id}/status`),
  realExec: (id: string, command: string, timeoutMs?: number) =>
    http<{ command: string; stdout: string; stderr: string; code: number | null }>(`/api/real/${id}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command, timeoutMs }),
    }),
}
