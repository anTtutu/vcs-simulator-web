/**
 * 文件：src/stores/explorer.ts
 * 用途：Explorer 页状态 —— 拓扑树数据、SSE 实时状态流、引擎操作 actions、
 *       Copy/Paste 剪贴板、视图页签与树模式
 *       （树对象在 SSE 事件到达时就地变更，画布与属性面板自动联动）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { defineStore } from 'pinia'
import { api } from '../api/client'
import { openEventStream } from '../api/sse'
import { useAuthStore } from './auth'
import type { ClusterTree, EventLogRow, TreeResource } from '../api/types'

/** SSE 关闭函数存放（store 之外，避免被序列化） */
let closeSse: (() => void) | null = null

export const useExplorerStore = defineStore({
  id: 'explorer',
  state: () => ({
    tree: null as ClusterTree | null,
    loading: false,
    /** 主区页签：status / resources / properties */
    viewTab: 'resources' as 'status' | 'resources' | 'properties',
    /** 树模式：grouped=按类型分组 / flat=组下平铺 */
    treeMode: 'grouped' as 'grouped' | 'flat',
    /** 当前展示的服务组 */
    activeGroupId: null as number | null,
    /** 选中资源（属性页签与画布高亮联动） */
    selectedResourceId: null as number | null,
    /** 底部系统页签：all / sys1 / sys2 ... */
    systemTab: 'all' as string,
    /** 组切换目标节点（工具条下拉） */
    switchTarget: '',
    /** SSE 实时事件流（Status 页与控制台展示用，新的在前） */
    sseLog: [] as EventLogRow[],
    /** Copy/Paste 剪贴板（资源类型 + 属性） */
    clipboard: null as { typeCode: string; attrs: Record<string, string>; critical: boolean } | null,
    /** 右键 Override Attributes 时置 true：属性面板自动进入编辑并聚焦覆盖区 */
    autoEditOverrides: false,
  }),
  getters: {
    /** 当前登录角色是否可编排（Operator/Administrator） */
    canOperate(): boolean {
      return useAuthStore().canOperate()
    },
    isAdmin(): boolean {
      return useAuthStore().isAdmin()
    },
    /** 当前服务组 */
    activeGroup(state) {
      return state.tree?.groups.find((g) => g.id === state.activeGroupId) ?? null
    },
    /** 选中资源对象 */
    selectedResource(state): TreeResource | null {
      return this.activeGroup?.resources.find((r) => r.id === state.selectedResourceId) ?? null
    },
    /** 系统页签文案（on all systems / on sys1） */
    systemTitleSuffix(state): string {
      return state.systemTab === 'all' ? 'on all systems' : `on ${state.systemTab}`
    },
  },
  actions: {
    /** 加载集群拓扑树；默认选中第一个服务组；建立 SSE 订阅 */
    async load(clusterId: number) {
      this.loading = true
      try {
        this.tree = await api.getTree(clusterId)
        this.activeGroupId = this.tree.groups[0]?.id ?? null
        this.selectedResourceId = null
        this.systemTab = 'all'
        this.sseLog = await api.listEvents(clusterId, 30).catch(() => [])
        this.connectSse(clusterId)
      } finally {
        this.loading = false
      }
    },
    /** 结构性变更（link/add/delete/attrs）后整体重拉 */
    async reload() {
      if (!this.tree) return
      const cid = this.tree.cluster.id
      const activeGid = this.activeGroupId
      const selRid = this.selectedResourceId
      this.tree = await api.getTree(cid)
      this.activeGroupId = this.tree.groups.some((g) => g.id === activeGid) ? activeGid : (this.tree.groups[0]?.id ?? null)
      this.selectedResourceId = this.tree.groups.some((g) => g.resources.some((r) => r.id === selRid)) ? selRid : null
    },

    /** SSE 事件流：就地变更树对象（不重建，保留画布/面板引用） */
    connectSse(clusterId: number) {
      closeSse?.()
      closeSse = openEventStream(clusterId, (evt) => {
        if (!this.tree) return
        if (evt.type === 'resource.state') {
          const { resourceId, state } = evt.payload as { resourceId: number; state: string }
          for (const g of this.tree.groups) {
            const r = g.resources.find((x) => x.id === resourceId)
            if (r) {
              r.state = state
              break
            }
          }
        } else if (evt.type === 'group.state') {
          const { groupId, state, currentSystem } = evt.payload as { groupId: number; state: string; currentSystem: string | null }
          const g = this.tree.groups.find((x) => x.id === groupId)
          if (g) {
            g.state = state
            g.currentSystem = currentSystem
          }
        } else if (evt.type === 'system.status') {
          const { status } = evt.payload as { status: string }
          // SSE 广播为整组节点状态（无单节点 id），此处仅刷新集群运行态展示
          void status
        } else if (evt.type === 'log.append') {
          const p = evt.payload as { level: string; scope: string; target: string; action: string; detail: string }
          this.sseLog.unshift({
            id: evt.seq,
            level: p.level as EventLogRow['level'],
            scope: p.scope,
            target: p.target ?? null,
            action: p.action,
            detail: p.detail ?? null,
            created_at: new Date(evt.ts).toLocaleTimeString(),
          })
          if (this.sseLog.length > 60) this.sseLog.pop()
        }
      })
    },

    /** 离开页面时释放 SSE（Explorer 卸载/切集群时调用） */
    dispose() {
      closeSse?.()
      closeSse = null
      this.$reset()
    },

    selectResource(id: number | null) {
      this.selectedResourceId = id
      if (id !== null) this.viewTab = 'properties'
    },

    // ==================== 引擎操作（对应右键菜单 / 工具条） ====================

    async resAction(rid: number, action: 'online' | 'offline' | 'prop' | 'fault' | 'clear' | 'probe') {
      await api.resourceAction(rid, action)
    },
    async setFlags(rid: number, patch: { enabled?: boolean; critical?: boolean }) {
      await api.updateResource(rid, patch)
      const r = this.tree?.groups.flatMap((g) => g.resources).find((x) => x.id === rid)
      if (r) Object.assign(r, patch)
    },
    async saveAttrs(rid: number, attrs: Record<string, string>, overrides: { systemId: number; key: string; value: string }[]) {
      await api.saveAttributes(rid, { attrs, overrides })
      await this.reload()
    },
    async doLink(gid: number, childId: number, parentId: number) {
      await api.link(gid, childId, parentId)
      await this.reload()
    },
    async doUnlink(gid: number, childId: number, parentId: number) {
      await api.unlink(gid, childId, parentId)
      await this.reload()
    },
    async pasteResource(gid: number, name: string, data: { typeCode: string; attrs: Record<string, string>; critical: boolean }) {
      await api.addResource(gid, { name, typeCode: data.typeCode, critical: data.critical, attrs: data.attrs })
      await this.reload()
    },
    async deleteRes(rid: number) {
      await api.deleteResource(rid)
      if (this.selectedResourceId === rid) this.selectedResourceId = null
      await this.reload()
    },
    /** 新建服务组（集群设计器入口：无组集群由此进入设计） */
    async createGroup(name: string, systems: string[]) {
      if (!this.tree) return
      await api.createGroup(this.tree.cluster.id, name, systems)
      await this.reload()
      // 选中新组，直接进入设计视图
      const created = this.tree.groups.find((g) => g.name === name)
      if (created) this.activeGroupId = created.id
    },
    /** 删除空服务组 */
    async removeGroup(gid: number) {
      await api.deleteGroup(gid)
      if (this.activeGroupId === gid) this.activeGroupId = null
      await this.reload()
    },

    async groupOnline(system?: string) {
      if (!this.activeGroup) return
      await api.groupOnline(this.activeGroup.id, system)
    },
    async groupOffline() {
      if (!this.activeGroup) return
      await api.groupOffline(this.activeGroup.id)
    },
    async groupSwitch(to: string) {
      if (!this.activeGroup) return
      await api.groupSwitch(this.activeGroup.id, to)
    },
  },
})
