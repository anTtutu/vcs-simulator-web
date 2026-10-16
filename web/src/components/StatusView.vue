<!--
  文件：src/components/StatusView.vue
  用途：Status 页签 —— 集群/节点/服务组概览 + 最近事件（Windows 版 Cluster Monitor 摘要条语义）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed } from 'vue'
import { useExplorerStore } from '../stores/explorer'
import { STATE_COLORS } from '../utils/icons'

const store = useExplorerStore()

const tree = computed(() => store.tree)
const onlineSystems = computed(() => tree.value?.systems.filter((s) => s.status === 'ONLINE').length ?? 0)
/** 实时事件流（SSE log.append 就地更新，引擎动作即时可见） */
const events = computed(() => store.sseLog)

/** 事件级别颜色 */
const levelCls = (lv: string) => ({ INFO: 'lv-info', WARN: 'lv-warn', ERROR: 'lv-err' })[lv] ?? 'lv-info'
const dot = (state: string) => ({ background: STATE_COLORS[state] ?? '#c0c4cc' })
</script>

<template>
  <div class="status-view">
    <!-- 摘要条（黄底，还原 loading.jpg 的连接摘要） -->
    <div class="summary" v-if="tree">
      <div class="sum-item">Group Status - Online: {{ tree.groups.filter((g) => g.state === 'ONLINE').length }} / {{ tree.groups.length }}</div>
      <div class="sum-item">System Status - Online: {{ onlineSystems }} / {{ tree.systems.length }}</div>
      <div class="sum-item">Link Status - {{ tree.cluster.status === 'RUNNING' ? 'Up' : 'Down' }}</div>
    </div>

    <div class="cards" v-if="tree">
      <!-- 节点卡片 -->
      <div class="card" v-for="s in tree.systems" :key="s.id">
        <div class="card-title">🖥 {{ s.name }}</div>
        <div class="card-line"><span class="dot" :style="dot(s.status)"></span>{{ s.status }}</div>
      </div>
      <!-- 服务组卡片 -->
      <div class="card" v-for="g in tree.groups" :key="g.id">
        <div class="card-title">📦 {{ g.name }}</div>
        <div class="card-line"><span class="dot" :style="dot(g.state)"></span>{{ g.state }}</div>
        <div class="card-sub">资源 {{ g.resources.length }} 个 · 可运行 {{ g.systemList.map((x) => x.name).join(', ') }}</div>
      </div>
    </div>

    <!-- 最近事件 -->
    <div class="events">
      <div class="sec-title">➤ 最近事件（engine_A.log）</div>
      <table>
        <tbody>
          <tr v-for="e in events.slice(0, 30)" :key="e.id">
            <td class="time">{{ e.created_at }}</td>
            <td :class="levelCls(e.level)">{{ e.level }}</td>
            <td>{{ e.scope }}</td>
            <td>{{ e.target }}</td>
            <td>{{ e.action }}</td>
            <td class="detail">{{ e.detail }}</td>
          </tr>
          <tr v-if="!events.length">
            <td colspan="6" class="none">暂无事件</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.status-view {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
}
.summary {
  background: #fdf6d8;
  border: 1px solid #f0e2a0;
  border-radius: 4px;
  padding: 10px 14px;
  display: flex;
  gap: 28px;
  font-size: 12.5px;
  color: #6b5d1f;
  margin-bottom: 12px;
}
.cards {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.card {
  border: 1px solid #e3e7eb;
  border-radius: 4px;
  padding: 10px 14px;
  min-width: 170px;
  background: #fbfcfd;
}
.card-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.card-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.card-sub {
  color: #98a1aa;
  font-size: 11.5px;
  margin-top: 4px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.sec-title {
  color: #2f6cb5;
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 12.5px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
td {
  padding: 4px 8px;
  border-bottom: 1px solid #eef1f3;
}
.time {
  color: #98a1aa;
  white-space: nowrap;
}
.lv-info {
  color: #2f6cb5;
}
.lv-warn {
  color: #b07d1a;
}
.lv-err {
  color: #c0392b;
}
.detail {
  color: #55606b;
}
.none {
  color: #98a1aa;
  text-align: center;
}
</style>
