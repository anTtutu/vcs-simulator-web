<!--
  文件：src/views/ClusterPanel.vue
  用途：集群管理面板（Windows 版主窗还原）—— 集群列表 / Task 面板 / Cluster Details
        顶部 Add Cluster、Make Clusters Global；右上 Global View / Help
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useClusterStore } from '../stores/clusters'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import { PLATFORM_BADGES, clusterStatusIcon } from '../utils/icons'
import { toast, toastError, toastSuccess } from '../utils/toast'
import AddClusterModal from '../components/AddClusterModal.vue'
import LoginModal from '../components/LoginModal.vue'
import TypeManagerModal from '../components/TypeManagerModal.vue'
import { api as apiClient } from '../api/client'
import type { ClusterLink } from '../api/types'

const router = useRouter()
const clusterStore = useClusterStore()
const auth = useAuthStore()

/** 弹窗控制 */
const showAdd = ref(false)
const showLogin = ref(false)
/** Verify 结果弹窗内容 */
const verifyItems = ref<{ level: string; target: string; message: string }[] | null>(null)
/** main.cf 导入弹窗 */
const showImport = ref(false)
const importContent = ref('')
const importBusy = ref(false)
const importResult = ref<{ clusterName: string; groups: number; resources: number; links: number; warnings: string[] } | null>(null)
/** 登录后准备跳转的集群 id */
const pendingClusterId = ref<number | null>(null)
/** 类型管理弹窗（P2-2） */
const showTypes = ref(false)
/** 心跳链路（P1-1）：随选中集群加载 */
const links = ref<ClusterLink[]>([])

/** 选中变化 → 拉取心跳链路 */
async function loadLinks(id: number) {
  links.value = []
  try {
    const detail = await apiClient.getCluster(id)
    links.value = detail.links ?? []
  } catch {
    /* 忽略 */
  }
}

watch(
  () => clusterStore.selectedId,
  (id) => {
    if (id) loadLinks(id)
    else links.value = []
  },
)

/** 断开/恢复心跳链路 */
async function toggleLink(name: string, status: 'UP' | 'DOWN') {
  const c = selected.value
  if (!c) return
  try {
    links.value = await apiClient.setLink(c.id, name, status === 'UP' ? 'down' : 'up')
    toastSuccess(status === 'UP' ? `${name} 已断开（LLT 降级）` : `${name} 已恢复`)
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 脑裂状态提示 */
const isSplit = computed(() => links.value.length > 0 && links.value.every((l) => l.status === 'DOWN'))

const selected = computed(() => clusterStore.selected)

onMounted(() => clusterStore.refresh().catch((e) => toastError(String(e.message ?? e))))

/** 平台徽标 */
const badge = (p: string) => PLATFORM_BADGES[p] ?? { text: p, bg: '#666' }

/** 选中集群 */
function selectRow(id: number) {
  clusterStore.select(id)
  loadLinks(id)
}

/** Task 面板动作入口（对应 Windows 版右侧 Task 列表） */
async function onVerify() {
  if (!selected.value) return
  try {
    const result = await api.verifyCluster(selected.value.id)
    verifyItems.value = result.items.length ? result.items : [{ level: 'ok', target: '-', message: '配置校验通过，未发现问题' }]
  } catch (e) {
    toastError((e as Error).message)
  }
}

async function onStartOrStop() {
  const c = selected.value
  if (!c) return
  try {
    if (c.status === 'STOPPED') await clusterStore.start(c.id)
    else if (c.status === 'RUNNING') await clusterStore.stop(c.id)
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** Launch Console：未登录先弹登录框，成功后进 Explorer */
function onLaunchConsole() {
  const c = selected.value
  if (!c) return
  if (auth.isLoggedIn(c.id)) {
    router.push(`/explorer/${c.id}`)
    return
  }
  pendingClusterId.value = c.id
  showLogin.value = true
}

/** CLI 控制台（登录门控与 Explorer 相同） */
function onConsole() {
  const c = selected.value
  if (!c) return
  if (auth.isLoggedIn(c.id)) {
    router.push(`/console/${c.id}`)
    return
  }
  pendingClusterId.value = c.id
  showLogin.value = true
}

/** 导入 main.cf：成功后刷新列表并展示结果/warnings */
async function doImport() {
  if (!importContent.value.trim()) {
    toastError('请粘贴 main.cf 内容')
    return
  }
  importBusy.value = true
  try {
    importResult.value = await api.importCf(importContent.value)
    await clusterStore.refresh()
    toastSuccess(`已导入集群 ${importResult.value.clusterName}`)
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    importBusy.value = false
  }
}

/** 登录成功回调 */
function onLoginOk() {
  showLogin.value = false
  if (pendingClusterId.value) router.push(`/explorer/${pendingClusterId.value}`)
}

/** 删除集群（带确认） */
async function onDelete() {
  const c = selected.value
  if (!c) return
  if (!confirm(`确定删除集群 ${c.name} 吗？该操作不可恢复。`)) return
  try {
    await api.deleteCluster(c.id)
    toastSuccess(`集群 ${c.name} 已删除`)
    clusterStore.select(null)
    await clusterStore.refresh()
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 新建成功回调 */
async function onAdded() {
  showAdd.value = false
  toastSuccess('集群已创建')
  await clusterStore.refresh()
}

/** Task 面板按钮禁用态（还原 Windows 版灰显逻辑） */
const taskDisabled = computed(() => {
  const c = selected.value
  if (!c) return { verify: true, startStop: true, launch: true, del: true }
  const busy = c.status === 'STARTING' || c.status === 'STOPPING'
  return {
    verify: busy,
    startStop: busy,
    launch: c.status !== 'RUNNING',
    del: busy,
  }
})
</script>

<template>
  <div class="panel">
    <!-- 顶栏：品牌区（Windows 版红色标题带） -->
    <header class="brand">
      <div class="brand-bar">
        <span class="logo">⬢</span>
        <span class="brand-text">Veritas™ Cluster Server (Simulator)</span>
      </div>
      <div class="toolbar">
        <span class="nav">
          <a class="on" @click.prevent>▤ 集群面板</a>
          <a @click.prevent="router.push('/monitor')">📺 Monitor</a>
          <a @click.prevent="router.push('/global')">🌐 Global View</a>
          <a @click.prevent="router.push('/real')">🛰 真实模式</a>
        </span>
        <span class="flex1"></span>
        <span class="role-badge" :class="auth.role.toLowerCase()" title="登录时选择的角色（演示级权限）">{{ auth.role }}</span>
        <button class="btn" @click="showAdd = true">➕ Add Cluster</button>
        <button class="btn" @click="showImport = true; importResult = null">⤒ Import main.cf</button>
        <button class="btn" :disabled="!auth.isAdmin" title="自定义 Agent 类型管理（需要 Administrator）" @click="showTypes = true">🧩 类型管理</button>
        <button class="btn" disabled title="二期功能：跨集群 Global View 分组入口已移至 Global View 页">🔗 Make Clusters Global</button>
        <a class="help" href="https://anttutu.github.io/post/2017-05-12-vcs1" target="_blank" rel="noreferrer">Help</a>
      </div>
    </header>

    <!-- 主体：左列表 + 右 Task -->
    <div class="main">
      <div class="left">
        <table class="cluster-table">
          <thead>
            <tr>
              <th style="width: 46%"></th>
              <th>Cluster Name /</th>
              <th style="width: 20%">Status</th>
              <th style="width: 22%">Platform</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in clusterStore.list"
              :key="c.id"
              :class="{ active: c.id === clusterStore.selectedId }"
              @click="selectRow(c.id)"
              @dblclick="c.status === 'RUNNING' && (clusterStore.select(c.id), onLaunchConsole())"
            >
              <td class="icon-cell">❀</td>
              <td>{{ c.name }}</td>
              <td class="status-cell">
                <span class="status-icon" :class="clusterStatusIcon(c.status).cls">{{
                  clusterStatusIcon(c.status).text
                }}</span>
              </td>
              <td>
                <span class="platform-badge" :style="{ background: badge(c.platform).bg }">{{
                  badge(c.platform).text
                }}</span>
              </td>
            </tr>
            <tr v-if="!clusterStore.list.length && !clusterStore.loading">
              <td colspan="4" class="empty">暂无集群，点击「Add Cluster」创建</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Task 面板 -->
      <aside class="task">
        <div class="task-title">Task</div>
        <button class="task-item" :disabled="taskDisabled.verify" @click="onVerify">☑️ Verify Configuration</button>
        <button v-if="!selected || (selected.status !== 'RUNNING' && selected.status !== 'STARTING' && selected.status !== 'STOPPING')" class="task-item" :disabled="taskDisabled.startStop" @click="onStartOrStop">
          ▶️ Start Cluster
        </button>
        <button v-else class="task-item" :disabled="taskDisabled.startStop" @click="onStartOrStop">
          ⏹️ Stop Cluster
        </button>
        <button class="task-item" :disabled="taskDisabled.launch" @click="onLaunchConsole">🖥️ Launch Console</button>
        <button class="task-item" :disabled="taskDisabled.launch" title="ha 命令控制台（hastart/hagrp/hares…）" @click="onConsole">⌨️ ha Console</button>
        <button class="task-item" :disabled="taskDisabled.del" @click="onDelete">🗑️ Delete Cluster</button>
      </aside>
    </div>

    <!-- 底部：Cluster Details（含心跳链路 P1-1） -->
    <footer class="details" v-if="selected">
      <div class="details-title">Cluster Details</div>
      <div class="kv"><span class="k">Cluster Name</span><span>:</span><span class="v">{{ selected.name }}</span></div>
      <div class="kv">
        <span class="k">Port Configuration</span><span>:</span>
        <span class="v">Simulator port is {{ selected.simulator_port }} and Wide Area Connector port is {{ selected.wac_port }}</span>
      </div>
      <div class="kv">
        <span class="k">Global Option enabled</span><span>:</span>
        <span class="v">{{ selected.global_enabled ? 'Yes' : 'No' }}</span>
      </div>
      <div class="kv">
        <span class="k">LLT Heartbeat Links</span><span>:</span>
        <span class="v links">
          <span v-for="l in links" :key="l.name" class="link-chip" :class="l.status.toLowerCase()">
            {{ l.name }} · {{ l.status }}
            <button
              v-if="auth.canOperate"
              class="chip-btn"
              :title="l.status === 'UP' ? '断开该心跳链路（模拟链路故障）' : '恢复该心跳链路'"
              @click="toggleLink(l.name, l.status)"
            >{{ l.status === 'UP' ? '断开' : '恢复' }}</button>
          </span>
          <span v-if="isSplit" class="split-warn">⚠ 脑裂中：服务组已冻结（AUTODISABLED），编排操作将被拒绝</span>
        </span>
      </div>
    </footer>
    <footer class="details empty-footer" v-else>Cluster Details：请在上方列表选择一个集群</footer>

    <!-- 启停等待模态（还原 Windows 版 "Starting a cluster may take a few seconds"） -->
    <div v-if="clusterStore.busyId" class="modal-mask">
      <div class="modal busy-modal">
        <div class="modal-title">⏳ {{ selected?.status === 'STOPPING' ? 'Stopping Cluster' : 'Starting Cluster' }}</div>
        <div class="busy-body">
          <span class="spinner"></span>
          <span>{{ clusterStore.busyText }}</span>
        </div>
      </div>
    </div>

    <!-- 新建集群弹窗 -->
    <AddClusterModal v-if="showAdd" @close="showAdd = false" @added="onAdded" />
    <!-- 演示级登录弹窗（localhost:port） -->
    <LoginModal v-if="showLogin" :cluster-id="pendingClusterId!" @close="showLogin = false" @ok="onLoginOk" />

    <!-- main.cf 导入弹窗 -->
    <div v-if="showImport" class="modal-mask" @click.self="showImport = false">
      <div class="modal import-modal">
        <div class="modal-title">Import main.cf（新建集群导入）</div>
        <div class="import-body">
          <textarea
            v-model="importContent"
            class="cf-textarea"
            placeholder='粘贴 main.cf 内容，例如：
include "types.cf"
cluster MY_CLUSTER ( )
system sys1 ( )
service group MY_GROUP ( SystemList = { sys1 = 0 } )
    MY_IP requires MY_NIC
    MY_NIC ( Device = eth0 )'
            rows="12"
          ></textarea>
          <div v-if="importResult" class="import-result">
            <div class="ok">✔ 已导入 {{ importResult.clusterName }}：{{ importResult.groups }} 组 / {{ importResult.resources }} 资源 / {{ importResult.links }} 依赖</div>
            <div v-for="(w, i) in importResult.warnings" :key="i" class="warn">⚠ {{ w }}</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showImport = false">关闭</button>
          <button class="btn primary" :disabled="importBusy" @click="doImport">{{ importBusy ? '导入中…' : '导入' }}</button>
        </div>
      </div>
    </div>

    <!-- 类型管理弹窗（P2-2） -->
    <TypeManagerModal v-if="showTypes" @close="showTypes = false" />

    <!-- Verify 结果弹窗 -->
    <div v-if="verifyItems" class="modal-mask" @click.self="verifyItems = null">
      <div class="modal verify-modal">
        <div class="modal-title">Verify Configuration</div>
        <ul class="verify-list">
          <li v-for="(it, i) in verifyItems" :key="i" :class="it.level">
            [{{ it.level.toUpperCase() }}] {{ it.target }}：{{ it.message }}
          </li>
        </ul>
        <div class="modal-actions">
          <button class="btn" @click="verifyItems = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.brand {
  background: #2b2f36;
  color: #fff;
}
.brand-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px 8px;
}
.logo {
  color: #e5352b;
  font-size: 22px;
}
.brand-text {
  font-size: 20px;
  font-weight: 600;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 18px 10px;
}
.flex1 {
  flex: 1;
}
.toolbar a.help {
  color: #9ec1ff;
  font-size: 12px;
}
.toolbar .nav {
  display: inline-flex;
  gap: 2px;
  background: #22262c;
  border-radius: 4px;
  padding: 3px;
}
.toolbar .nav a {
  color: #9aa4ae;
  font-size: 12px;
  padding: 3px 12px;
  border-radius: 3px;
  cursor: pointer;
}
.toolbar .nav a.on {
  background: #2f6cb5;
  color: #fff;
}
.toolbar .nav a:not(.on):hover {
  color: #fff;
  background: #3a4149;
}
.role-badge {
  font-size: 10.5px;
  border-radius: 8px;
  padding: 2px 8px;
  background: #3a4149;
  color: #b9e28c;
  border: 1px solid #565e67;
}
.role-badge.observer {
  color: #7fd1ff;
}
.role-badge.operator {
  color: #e8d17f;
}
.details .links {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.link-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  border-radius: 3px;
  padding: 2px 8px;
  border: 1px solid #d8dde2;
  background: #f7f9fa;
}
.link-chip.down {
  background: #fdecea;
  border-color: #e2a69f;
  color: #c0392b;
}
.chip-btn {
  border: none;
  background: #2f6cb5;
  color: #fff;
  font-size: 10.5px;
  border-radius: 2px;
  padding: 1px 6px;
  cursor: pointer;
}
.chip-btn:hover {
  background: #2a5e9e;
}
.split-warn {
  color: #c0392b;
  font-weight: 600;
  font-size: 11.5px;
}

.main {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  min-height: 0;
}
.left {
  flex: 1;
  background: #fff;
  border: 1px solid #c6ccd2;
  border-radius: 4px;
  overflow: auto;
}
.cluster-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.cluster-table th {
  text-align: left;
  padding: 7px 10px;
  background: #f3f5f7;
  border-bottom: 1px solid #d8dde2;
  color: #55606b;
  position: sticky;
  top: 0;
}
.cluster-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #eef1f3;
}
.cluster-table tbody tr {
  cursor: pointer;
  background: #f4f8de;
}
.cluster-table tbody tr:nth-child(even) {
  background: #eef4d8;
}
.cluster-table tbody tr:hover {
  background: #e4efc8;
}
.cluster-table tbody tr.active {
  background: #3d80e5 !important;
  color: #fff;
}
.icon-cell {
  color: #d47b1f;
}
.status-icon.ok {
  color: #2e9e44;
}
.status-icon.busy {
  color: #e6a23c;
}
.status-icon.stopped {
  color: #98a1aa;
}
.platform-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  color: #fff;
  font-size: 11px;
}
.empty {
  text-align: center;
  color: #98a1aa;
  padding: 24px !important;
}

.task {
  width: 210px;
  background: #fff;
  border: 1px solid #c6ccd2;
  border-radius: 4px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-self: flex-start;
}
.task-title {
  color: #2f6cb5;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid #e3e7eb;
  padding-bottom: 6px;
}
.task-item {
  text-align: left;
  border: none;
  background: none;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12.5px;
}
.task-item:hover:not(:disabled) {
  background: #eaf2fd;
}
.task-item:disabled {
  color: #b6bdc4;
  cursor: not-allowed;
}

.details {
  background: #fff;
  border-top: 1px solid #c6ccd2;
  padding: 10px 16px 14px;
}
.details-title {
  color: #2f6cb5;
  font-weight: 600;
  margin-bottom: 8px;
}
.kv {
  display: flex;
  gap: 8px;
  padding: 2px 0;
  font-size: 12.5px;
}
.k {
  width: 180px;
  color: #55606b;
}
.empty-footer {
  color: #98a1aa;
  font-size: 12px;
}

/* 模态通用 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 25, 30, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: #fff;
  border-radius: 6px;
  min-width: 380px;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.3);
}
.modal-title {
  padding: 10px 14px;
  background: #f3f5f7;
  border-bottom: 1px solid #e3e7eb;
  border-radius: 6px 6px 0 0;
  font-weight: 600;
}
.busy-body {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 22px 18px;
  font-size: 12.5px;
}
.spinner {
  width: 18px;
  height: 18px;
  border: 3px solid #d7e2ef;
  border-top-color: #2f6cb5;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.verify-modal {
  max-width: 560px;
}
.import-modal {
  width: 640px;
  max-width: 92vw;
}
.import-body {
  padding: 12px 14px;
}
.cf-textarea {
  width: 100%;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  border: 1px solid #b8bfc7;
  border-radius: 4px;
  padding: 8px;
  resize: vertical;
}
.import-result {
  margin-top: 8px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.import-result .ok {
  color: #2e7d32;
}
.import-result .warn {
  color: #b07d1a;
}
.verify-list {
  list-style: none;
  max-height: 300px;
  overflow: auto;
  padding: 12px 16px;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.verify-list .error {
  color: #c0392b;
}
.verify-list .warning {
  color: #b07d1a;
}
.verify-list .ok {
  color: #2e7d32;
}
.modal-actions {
  padding: 10px 14px;
  border-top: 1px solid #e3e7eb;
  display: flex;
  justify-content: flex-end;
}
</style>
