<!--
  文件：src/views/ConsoleView.vue
  用途：ha 命令控制台（模拟模式）—— SSH 式连续输入（TerminalShell keydown 驱动），
        后端 execCommand 执行；示例命令一键填入执行
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { toastError } from '../utils/toast'
import TerminalShell from '../components/TerminalShell.vue'

const route = useRoute()
const router = useRouter()
const clusterId = Number(route.params.clusterId)

const clusterName = ref('...')
const port = ref(0)
const busy = ref(false)
const termRef = ref<InstanceType<typeof TerminalShell> | null>(null)

/** 示例命令（点击即执行，P1-4 说明样例补充） */
const EXAMPLES = [
  'help',
  'hagrp -state',
  'hares -state',
  'gabconfig -a',
  'lltstat -n',
  'haconf -dump',
]

/** Tab 补全词表 */
const completions = ref<string[]>([])

onMounted(async () => {
  try {
    const c = await api.getCluster(clusterId)
    clusterName.value = c.name
    port.value = c.simulator_port
    termRef.value?.print(`VCS Simulator Console — localhost:${c.simulator_port} (${c.name})`, 'out')
    termRef.value?.print('输入 help 查看可用命令；↑/↓ 历史，Tab 补全，Ctrl+L 清屏', 'out')
    // 组装补全词表
    const tree = await api.getTree(clusterId)
    const words = new Set<string>([
      'hastart', 'hastop', 'hagrp', 'hares', 'hasys', 'haconf', 'gabconfig', 'lltstat', 'help', 'clear',
      '-state', '-list', '-online', '-offline', '-switch', '-clear', '-probe', '-prop', '-sys', '-to', '-dump', '-a', '-all',
    ])
    for (const g of tree.groups) {
      words.add(g.name)
      for (const r of g.resources) words.add(r.name)
    }
    for (const s of tree.systems) words.add(s.name)
    completions.value = [...words].sort()
  } catch (e) {
    toastError((e as Error).message)
  }
})

const prompt = computed(() => `admin@localhost:${port.value}>`)

/** 执行命令（结果打印由 TerminalShell.print 输出） */
async function onExec(cmd: string) {
  busy.value = true
  try {
    const r = await api.console(clusterId, cmd)
    if (r.clear) {
      termRef.value?.clearScreen()
    } else {
      for (const line of r.output) termRef.value?.print(line, line.startsWith('[error]') ? 'err' : 'out')
    }
  } catch (e) {
    termRef.value?.print(`[error] ${(e as Error).message}`, 'err')
  } finally {
    busy.value = false
  }
}

/** 清屏（Ctrl+L） */
function onClear() {
  termRef.value?.clearScreen()
}
</script>

<template>
  <div class="console-page">
    <header class="titlebar">
      <span class="link" @click="router.push('/')">⬢ 集群面板</span>
      <span class="sep">›</span>
      <span>{{ clusterName }} (Simulator) - Console : admin</span>
      <span class="flex1"></span>
      <span class="hint">↑/↓ 历史 · Tab 补全 · Ctrl+L 清屏</span>
    </header>

    <!-- 示例命令（点击即执行） -->
    <div class="examples">
      <span class="ex-label">示例：</span>
      <button v-for="ex in EXAMPLES" :key="ex" class="ex-chip" @click="onExec(ex)">{{ ex }}</button>
    </div>

    <TerminalShell
      ref="termRef"
      :prompt="prompt"
      :completions="completions"
      :busy="busy"
      @exec="onExec"
      @clear="onClear"
    />
  </div>
</template>

<style scoped>
.console-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #10151a;
}
.titlebar {
  background: #2b2f36;
  color: #e8ecf1;
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
.hint {
  color: #7b848d;
  font-size: 11.5px;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px;
  background: #171d24;
  border-bottom: 1px solid #232b33;
}
.ex-label {
  color: #7b848d;
  font-size: 11.5px;
  align-self: center;
}
.ex-chip {
  border: 1px solid #2c3540;
  background: #1b2229;
  color: #9ec1ff;
  border-radius: 12px;
  padding: 2px 10px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: Consolas, monospace;
}
.ex-chip:hover {
  border-color: #2f6cb5;
  color: #cfe6ff;
}
</style>
