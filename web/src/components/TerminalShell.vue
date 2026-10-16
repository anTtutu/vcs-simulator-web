<!--
  文件：src/components/TerminalShell.vue
  用途：通用终端输入组件（keydown 驱动，非 <input> 元素）——
        彻底解决重渲染导致的光标丢失：行缓冲由组件内维护，
        可打印字符追加、Backspace 删除、↑↓ 历史、Tab 补全、Enter 执行
        父组件通过 defineExpose 的 print/clear 输出结果
  作者：Anttu
  日期：2026-10-16
-->
<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{
  /** 提示符文案 */
  prompt: string
  /** Tab 补全词表（可选） */
  completions?: string[]
  /** 执行期间禁止输入 */
  busy?: boolean
}>()
const emit = defineEmits<{ exec: [command: string]; clear: [] }>()

const lines = ref<{ text: string; kind: 'cmd' | 'out' | 'err' }[]>([])
const buffer = ref('')
const history = ref<string[]>([])
const histIdx = ref(-1)
const bodyRef = ref<HTMLDivElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)

let printSeq = 0

/** 输出一行 */
function print(text: string, kind: 'cmd' | 'out' | 'err' = 'out') {
  lines.value.push({ text, kind })
  nextTick(() => bodyRef.value?.scrollTo({ top: bodyRef.value.scrollHeight }))
}
function clearScreen() {
  lines.value = []
}
/** 滚动到底 */
function scrollBottom() {
  nextTick(() => bodyRef.value?.scrollTo({ top: bodyRef.value.scrollHeight }))
}
/** 抢焦点（点击终端区域 / 初始化） */
function focusTerm() {
  wrapRef.value?.focus()
  scrollBottom()
}
onMounted(focusTerm)
defineExpose({ print, clearScreen, focusTerm })

/** 执行当前缓冲 */
function submitBuffer() {
  const cmd = buffer.value.trim()
  if (props.busy) return
  buffer.value = ''
  if (!cmd) {
    print('')
    return
  }
  history.value.unshift(cmd)
  histIdx.value = -1
  print(`${props.prompt} ${cmd}`, 'cmd')
  emit('exec', cmd)
}

/** 键盘处理：可打印字符进缓冲，Backspace 删除，↑↓ 历史，Tab 补全，Enter 执行 */
function onKeydown(e: KeyboardEvent) {
  if (props.busy) return
  if (e.key === 'Enter') {
    e.preventDefault()
    submitBuffer()
    return
  }
  if (e.key === 'Backspace') {
    e.preventDefault()
    buffer.value = buffer.value.slice(0, -1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (histIdx.value < history.value.length - 1) {
      histIdx.value++
      buffer.value = history.value[histIdx.value]
    }
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (histIdx.value > 0) {
      histIdx.value--
      buffer.value = history.value[histIdx.value]
    } else {
      histIdx.value = -1
      buffer.value = ''
    }
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    const hit = (props.completions ?? []).find((w) => w.startsWith(buffer.value) && w !== buffer.value)
    if (hit) buffer.value = hit
    return
  }
  if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault()
    emit('clear')
    clearScreen()
    return
  }
  // 可打印单字符（排除组合键）
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    buffer.value += e.key
    scrollBottom()
  }
}
</script>

<template>
  <div
    ref="wrapRef"
    class="term"
    tabindex="0"
    @click="focusTerm"
    @keydown="onKeydown"
  >
    <div ref="bodyRef" class="lines">
      <div v-for="(l, i) in lines" :key="`l${i}`" class="line" :class="l.kind">{{ l.text }}</div>
      <div class="line current">
        <span class="prompt">{{ prompt }}</span><span class="buf">{{ buffer }}</span><span class="caret">▊</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.term {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
  font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.55;
  background: #10151a;
  outline: none;
  cursor: text;
}
.lines {
  white-space: pre-wrap;
  word-break: break-all;
}
.line.cmd {
  color: #7fd1ff;
}
.line.err {
  color: #ff7b6b;
}
.line.out {
  color: #b9e28c;
}
.current {
  color: #e6edf3;
}
.prompt {
  color: #e8d17f;
  margin-right: 8px;
}
.caret {
  animation: caret-blink 1s steps(1) infinite;
}
@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}
</style>
