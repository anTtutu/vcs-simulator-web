<!--
  文件：src/views/MonitorView.vue
  用途：监控总览（P0-2，Windows 版 Cluster Monitor 还原）
        多集群卡片墙 + 摘要条（Group/System/Link Status）；SSE 全局流触发刷新 + 5s 兜底轮询
        响应式：窄屏单列（移动端观摩看板，P2-5）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { openEventStream } from '../api/sse'
import { PLATFORM_BADGES, clusterStatusIcon } from '../utils/icons'
import type { OverviewRow } from '../api/types'
import { toastError } from '../utils/toast'

const router = useRouter()
const rows = ref<OverviewRow[]>([])
let closeSse: (() => void) | null = null
let poll: ReturnType<typeof setInterval> | null = null

async function refresh() {
  try {
    rows.value = await api.overview()
  } catch (e) {
    toastError((e as Error).message)
  }
}

onMounted(() => {
  refresh()
  // 全局事件流：任一集群状态变化即刷新（含 5s 兜底轮询）
  closeSse = openEventStream(undefined, () => refresh())
  poll = setInterval(refresh, 5000)
})
onBeforeUnmount(() => {
  closeSse?.()
  if (poll) clearInterval(poll)
})

const badge = (p: string) => PLATFORM_BADGES[p] ?? { text: p, bg: '#666' }
/** 链路状态显示 */
const linkText = (s: string) => ({ Up: 'Up', Degraded: 'Degraded（单链路断）', Down: 'Down（脑裂）' })[s] ?? s
const linkCls = (s: string) => ({ Up: 'up', Degraded: 'degraded', Down: 'down' })[s] ?? 'up'
</script>

<template>
  <div class="monitor">
    <header class="bar">
      <span class="crumb link" @click="router.push('/')">⬢ 集群面板</span>
      <span class="sep">›</span>
      <span>Cluster Monitor（监控总览）</span>
      <span class="flex1"></span>
      <a class="nav-link" @click.prevent="router.push('/global')">🌐 Global View</a>
    </header>

    <div class="cards">
      <div v-for="r in rows" :key="r.id" class="card" @dblclick="router.push(`/explorer/${r.id}`)">
        <div class="card-head">
          <span class="ico">{{ clusterStatusIcon(r.status).text }}</span>
          <span class="name">{{ r.name }}</span>
          <span class="plat" :style="{ background: badge(r.platform).bg }">{{ badge(r.platform).text }}</span>
        </div>
        <!-- 摘要条（还原 loading.jpg 黄色摘要） -->
        <div class="summary">
          <div>Group Status - Online: {{ r.groupsOnline }} / {{ r.groupsTotal }}</div>
          <div>System Status - Online: {{ r.sysOnline }} / {{ r.sysTotal }}</div>
          <div :class="linkCls(r.linkStatus)">Link Status - {{ linkText(r.linkStatus) }}</div>
        </div>
        <div class="foot">
          <span class="port">localhost:{{ r.simulator_port }}</span>
          <span class="flex1"></span>
          <button class="btn mini" @click="router.push(`/explorer/${r.id}`)"> explorer</button>
          <button class="btn mini" @click="router.push(`/console/${r.id}`)">⌨ console</button>
        </div>
      </div>
      <div v-if="!rows.length" class="empty">暂无集群</div>
    </div>
  </div>
</template>

<style scoped>
.monitor {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #e8eaed;
}
.bar {
  background: #2b2f36;
  color: #e8ecf1;
  padding: 9px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.crumb.link {
  cursor: pointer;
  color: #9ec1ff;
}
.sep {
  color: #7b848d;
}
.flex1 {
  flex: 1;
}
.nav-link {
  color: #9ec1ff;
  font-size: 12px;
  cursor: pointer;
}
.cards {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  align-content: start;
}
.card {
  background: #fff;
  border: 1px solid #c6ccd2;
  border-radius: 6px;
  padding: 12px 14px;
  cursor: pointer;
}
.card:hover {
  border-color: #2f6cb5;
  box-shadow: 0 2px 10px rgba(47, 108, 181, 0.15);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.name {
  font-weight: 600;
  font-size: 13.5px;
}
.plat {
  color: #fff;
  font-size: 10.5px;
  border-radius: 3px;
  padding: 1px 6px;
  margin-left: auto;
}
.summary {
  background: #fdf6d8;
  border: 1px solid #f0e2a0;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 11.5px;
  color: #6b5d1f;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.summary .up {
  color: #2e7d32;
}
.summary .degraded {
  color: #b07d1a;
}
.summary .down {
  color: #c0392b;
  font-weight: 600;
}
.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.port {
  color: #98a1aa;
  font-size: 11px;
}
.empty {
  grid-column: 1 / -1;
  text-align: center;
  color: #98a1aa;
  padding: 40px;
}
/* 移动端观摩（P2-5） */
@media (max-width: 640px) {
  .cards {
    grid-template-columns: 1fr;
    padding: 10px;
  }
}
</style>
