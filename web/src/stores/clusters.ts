/**
 * 文件：src/stores/clusters.ts
 * 用途：集群管理面板状态 —— 集群列表、选中项、启停等待框、SSE 状态同步
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { defineStore } from 'pinia'
import { api } from '../api/client'
import { openEventStream } from '../api/sse'
import type { Cluster } from '../api/types'

export const useClusterStore = defineStore({
  id: 'clusters',
  state: () => ({
    list: [] as Cluster[],
    selectedId: null as number | null,
    loading: false,
    /** 正在启动/停止的集群 id（弹「请稍候」模态） */
    busyId: null as number | null,
    busyText: '',
  }),
  getters: {
    selected(state): Cluster | null {
      return state.list.find((c) => c.id === state.selectedId) ?? null
    },
  },
  actions: {
    /** 拉取集群列表；成功后建立全局 SSE 订阅（仅首次） */
    async refresh() {
      this.loading = true
      try {
        this.list = await api.listClusters()
        this.connectSse()
      } finally {
        this.loading = false
      }
    },
    select(id: number | null) {
      this.selectedId = id
    },
    /** 全局事件流：集群/节点状态实时刷新（不重拉列表，仅改字段） */
    connectSse() {
      if ((this as unknown as { _sseOn?: boolean })._sseOn) return
      ;(this as unknown as { _sseOn?: boolean })._sseOn = true
      openEventStream(undefined, (evt) => {
        if (evt.type !== 'cluster.status' && evt.type !== 'system.status') return
        const c = this.list.find((x) => x.id === evt.clusterId)
        if (!c) return
        if (evt.type === 'cluster.status') {
          c.status = evt.payload.status as Cluster['status']
          if (this.busyId === c.id && (c.status === 'RUNNING' || c.status === 'STOPPED')) {
            this.busyId = null // 启停完成 → 关闭等待框
          }
        }
      })
    },
    /** 启动集群：先置 busy 弹窗，完成由 SSE 关闭 */
    async start(id: number) {
      this.busyId = id
      this.busyText = 'Starting a cluster may take a few seconds. Please wait...'
      try {
        await api.startCluster(id)
      } catch (e) {
        this.busyId = null
        throw e
      }
    },
    /** 停止集群 */
    async stop(id: number) {
      this.busyId = id
      this.busyText = 'Stopping the cluster. Please wait...'
      try {
        await api.stopCluster(id)
      } catch (e) {
        this.busyId = null
        throw e
      }
    },
  },
})
