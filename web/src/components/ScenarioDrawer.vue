<!--
  文件：src/components/ScenarioDrawer.vue
  用途：演练剧本抽屉（P1-4）—— 剧本清单、一键执行/停止、叙事字幕实时流（SSE log SCENARIO）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { useExplorerStore } from '../stores/explorer'
import type { ScenarioDef } from '../api/types'
import { toastError, toastSuccess } from '../utils/toast'

const props = defineProps<{ clusterId: number }>()
const emit = defineEmits<{ close: [] }>()

const store = useExplorerStore()
const list = ref<ScenarioDef[]>([])
const runningKey = ref('')
const busy = ref(false)

onMounted(async () => {
  try {
    list.value = await api.listScenarios()
  } catch (e) {
    toastError((e as Error).message)
  }
})

/** 剧本叙事流（SSE 事件里 scope=ENGINE 且 action=SCENARIO 的条目，新的在前） */
const narrations = computed(() => store.sseLog.filter((e) => e.action === 'SCENARIO').slice(0, 12))

/** 执行/停止剧本 */
async function toggle(key: string) {
  busy.value = true
  try {
    if (runningKey.value === key) {
      await api.stopScenario(props.clusterId)
      runningKey.value = ''
    } else {
      await api.runScenario(props.clusterId, key)
      runningKey.value = key
      toastSuccess('剧本开始执行，按字幕观察右侧画布与事件流')
      // 剧本时长后自动复位按钮
      const def = list.value.find((s) => s.key === key)
      if (def) setTimeout(() => (runningKey.value = ''), def.durationMs + 5000)
    }
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <teleport to="body">
    <div class="mask" @click="emit('close')">
      <div class="drawer" @click.stop>
        <div class="head">
          <span>🎬 演练剧本</span>
          <button class="btn mini" @click="emit('close')">✕</button>
        </div>
        <div class="list">
          <div v-for="s in list" :key="s.key" class="item" :class="{ running: runningKey === s.key }">
            <div class="title-row">
              <span class="title">{{ s.title }}</span>
              <button class="btn mini" :disabled="busy || !store.canOperate" @click="toggle(s.key)">
                {{ runningKey === s.key ? '⏹ 停止' : '▶ 执行' }}
              </button>
            </div>
            <div class="desc">{{ s.desc }}</div>
            <div class="meta">时长约 {{ Math.round(s.durationMs / 1000) }}s<template v-if="s.needRunning"> · 需集群 RUNNING</template><template v-if="s.needGroupOnline"> · 需组已上线</template></div>
          </div>
        </div>
        <div class="feed">
          <div class="feed-title">叙事字幕</div>
          <div v-for="n in narrations" :key="n.id" class="line">{{ n.detail }}</div>
          <div v-if="!narrations.length" class="empty">执行剧本后，解说字幕将在此滚动</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 25, 30, 0.35);
  z-index: 120;
}
.drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 400px;
  background: #fff;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e3e7eb;
  font-weight: 600;
}
.list {
  flex: 1;
  overflow: auto;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.item {
  border: 1px solid #e3e7eb;
  border-radius: 6px;
  padding: 10px 12px;
}
.item.running {
  border-color: #2e7d32;
  background: #f2fbf3;
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-weight: 600;
  font-size: 12.5px;
}
.desc {
  font-size: 11.5px;
  color: #55606b;
  margin: 5px 0 4px;
  line-height: 1.5;
}
.meta {
  font-size: 11px;
  color: #98a1aa;
}
.feed {
  border-top: 1px solid #e3e7eb;
  padding: 10px 14px;
  max-height: 220px;
  overflow: auto;
  background: #10151a;
}
.feed-title {
  color: #e8d17f;
  font-size: 11.5px;
  margin-bottom: 6px;
}
.line {
  color: #b9e28c;
  font-size: 11.5px;
  font-family: Consolas, monospace;
  line-height: 1.6;
}
.empty {
  color: #55606b;
  font-size: 11.5px;
}
</style>
