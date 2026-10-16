<!--
  文件：src/views/RealConsoleView.vue
  用途：真实模式（真实服务器 SSH 连接）——
        连接管理（host/port/user/password）+ 集群状态聚合（hasys/hagrp/hares/gabconfig/lltstat）
        + SSH 命令终端（白名单前缀 ha*/gabconfig/lltstat…，变更类命令需前端二次确认）
  ⚠️ 真实命令直接作用于真实集群，请确认目标环境后再执行
  作者：Anttu
  日期：2026-10-16
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'
import TerminalShell from '../components/TerminalShell.vue'
import { toastError, toastSuccess } from '../utils/toast'

const router = useRouter()
const auth = useAuthStore()
/** 操作权限（Operator/Administrator 才能连接与执行） */
function authCan() {
  return auth.canOperate()
}

/** 连接表单 */
const host = ref('')
const port = ref(22)
const username = ref('root')
const password = ref('')
const connecting = ref(false)

/** 已连接列表 */
interface RealConn {
  id: string
  host: string
  port: number
  username: string
}
const connections = ref<RealConn[]>([])
const activeId = ref<string | null>(null)
const active = computed(() => connections.value.find((c) => c.id === activeId.value) ?? null)

const prompt = computed(() => `${active.value?.username ?? 'user'}@${active.value?.host ?? 'no-conn'}#`)

const termRef = ref<InstanceType<typeof TerminalShell> | null>(null)
const busy = ref(false)

const completions = ref(['hastatus', 'hasys -state', 'hagrp -state', 'hares -state', 'hagrp -online ', 'hagrp -offline ', 'hagrp -switch ', 'hares -online ', 'hares -offline ', 'hares -clear ', 'hares -probe ', 'gabconfig -a', 'lltstat -nvv', 'haconf -dump -makelocal'])

/** 状态聚合数据（折叠展示） */
interface StatusBlock {
  command: string
  stdout: string
  stderr: string
  code: number | null
}
const statusBlocks = ref<Record<string, StatusBlock>>({})

async function refreshConnections() {
  try {
    connections.value = await api.realConnections()
    if (!activeId.value && connections.value.length) activeId.value = connections.value[0].id
  } catch (e) {
    toastError((e as Error).message)
  }
}

onMounted(refreshConnections)

/** 建立连接 */
async function connect() {
  if (!host.value || !username.value) {
    toastError('请填写主机与用户名')
    return
  }
  connecting.value = true
  try {
    const created = await api.realConnect({
      host: host.value,
      port: port.value,
      username: username.value,
      password: password.value || undefined,
    })
    toastSuccess(`已连接 ${created.host}`)
    host.value = ''
    password.value = ''
    activeId.value = created.id
    await refreshConnections()
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    connecting.value = false
  }
}

/** 断开 */
async function disconnect(id: string) {
  try {
    await api.realDisconnect(id)
    if (activeId.value === id) activeId.value = null
    await refreshConnections()
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 拉取状态聚合 */
async function loadStatus() {
  if (!activeId.value) {
    toastError('请先建立连接')
    return
  }
  busy.value = true
  try {
    statusBlocks.value = await api.realStatus(activeId.value)
    termRef.value?.print('── 状态聚合已刷新（详见上方折叠面板）', 'out')
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    busy.value = false
  }
}

/** 变更类命令 → 前端二次确认 */
function needConfirm(cmd: string): boolean {
  return /(-online|-offline|-switch|-clear|-probe|hastop|hastart)/.test(cmd)
}

/** 终端执行 */
async function onExec(command: string) {
  if (!activeId.value) {
    termRef.value?.print('[error] 尚未建立连接，请先在上方连接真实服务器', 'err')
    return
  }
  if (needConfirm(command) && !confirm(`将在真实服务器 ${active.value?.host} 执行：\n${command}\n\n确认执行？（会直接作用于真实集群）`)) {
    termRef.value?.print('[canceled] 已取消执行', 'err')
    return
  }
  busy.value = true
  try {
    const r = await api.realExec(activeId.value, command)
    if (r.stdout.trim()) termRef.value?.print(r.stdout.trimEnd(), 'out')
    if (r.stderr.trim()) termRef.value?.print(r.stderr.trimEnd(), 'err')
    termRef.value?.print(`[exit ${r.code ?? '?'}]`, 'out')
  } catch (e) {
    termRef.value?.print(`[error] ${(e as Error).message}`, 'err')
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => {
  /* 连接保持（后端池），页面重进可复用 */
})
</script>

<template>
  <div class="real-page">
    <header class="titlebar">
      <span class="link" @click="router.push('/')">⬢ 集群面板</span>
      <span class="sep">›</span>
      <span>真实模式（SSH 连接真实 VCS 节点）</span>
      <span class="flex1"></span>
      <span class="warn">⚠ 真实命令直接作用于真实集群</span>
    </header>

    <div class="layout">
      <!-- 左：连接管理 + 状态聚合 -->
      <aside class="side">
        <div class="panel">
          <div class="p-title">连接</div>
          <div class="conn-form">
            <input v-model="host" placeholder="主机 (IP/域名)" />
            <input v-model.number="port" type="number" placeholder="22" style="width: 70px" />
            <input v-model="username" placeholder="用户名" style="width: 110px" />
            <input v-model="password" type="password" placeholder="密码（或私钥路径留空用密钥）" />
            <button class="btn primary mini" :disabled="connecting || !authCan()" @click="connect">
              {{ connecting ? '连接中…' : '🔗 连接' }}
            </button>
          </div>
          <div v-for="c in connections" :key="c.id" class="conn-item" :class="{ active: c.id === activeId }" @click="activeId = c.id">
            <span class="dot"></span>
            <span class="c-host">{{ c.username }}@{{ c.host }}:{{ c.port }}</span>
            <button class="btn mini danger" title="断开" @click.stop="disconnect(c.id)">✕</button>
          </div>
        </div>

        <div class="panel">
          <div class="p-title">
            集群状态聚合
            <button class="btn mini" style="float: right" :disabled="!activeId || busy" @click="loadStatus">⟳ 刷新</button>
          </div>
          <details v-for="(b, name) in statusBlocks" :key="name" class="st-block" open>
            <summary>{{ name }} · {{ b.command }}</summary>
            <pre :class="{ err: b.stderr }">{{ b.stdout || b.stderr || '(空)' }}</pre>
          </details>
          <div v-if="!Object.keys(statusBlocks).length" class="empty">连接后点「刷新」拉取真实集群状态</div>
        </div>
      </aside>

      <!-- 右：SSH 终端 -->
      <div class="term-wrap">
        <div class="term-head">
          <span>{{ active ? `SSH 终端 — ${active.username}@${active.host}` : '未连接（先在左侧建立连接）' }}</span>
          <span class="flex1"></span>
          <span class="hint">白名单：{{ 'ha* / gabconfig / lltstat / hasys / haconf' }}</span>
        </div>
        <TerminalShell ref="termRef" :prompt="prompt" :completions="completions" :busy="busy" @exec="onExec" />
      </div>
    </div>
  </div>
</template>


<style scoped>
.real-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #10151a;
  color: #e6edf3;
}
.titlebar {
  background: #2b2f36;
  padding: 9px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.link {
  cursor: pointer;
  color: #9ec1ff;
}
.sep {
  color: #7b848d;
}
.flex1 {
  flex: 1;
}
.warn {
  color: #ffb86c;
  font-size: 11.5px;
}
.layout {
  flex: 1;
  display: grid;
  grid-template-columns: 380px 1fr;
  min-height: 0;
}
.side {
  border-right: 1px solid #232b33;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel {
  border: 1px solid #232b33;
  border-radius: 6px;
  padding: 10px;
}
.p-title {
  font-weight: 600;
  font-size: 12.5px;
  margin-bottom: 8px;
}
.conn-form {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.conn-form input {
  flex: 1;
  min-width: 0;
  background: #171d24;
  border: 1px solid #2c3540;
  border-radius: 3px;
  color: #e6edf3;
  padding: 5px 8px;
  font-size: 12px;
}
.conn-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.conn-item:hover {
  background: #1b2229;
}
.conn-item.active {
  background: #1d2c3f;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2e9e44;
}
.c-host {
  flex: 1;
  font-family: Consolas, monospace;
}
.st-block {
  margin-bottom: 8px;
  font-size: 12px;
}
.st-block summary {
  cursor: pointer;
  color: #9ec1ff;
  font-family: Consolas, monospace;
}
.st-block pre {
  background: #171d24;
  padding: 8px;
  border-radius: 4px;
  overflow: auto;
  max-height: 200px;
  font-size: 11px;
  color: #b9e28c;
  white-space: pre-wrap;
}
.st-block pre.err {
  color: #ff7b6b;
}
.term-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.term-head {
  padding: 8px 16px;
  font-size: 12px;
  color: #7b848d;
  border-bottom: 1px solid #232b33;
  display: flex;
  gap: 8px;
}
.empty {
  color: #55606b;
  font-size: 12px;
  text-align: center;
  padding: 10px;
}
/* 移动端单列 */
@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
