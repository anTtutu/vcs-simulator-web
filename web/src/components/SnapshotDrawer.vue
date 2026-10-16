<!--
  文件：src/components/SnapshotDrawer.vue
  用途：配置快照抽屉（P2-1）—— 拍快照 / 列表 / 回滚（Admin）/ 与当前配置对比（LCS 行级 diff）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { useExplorerStore } from '../stores/explorer'
import { diffLines } from '../utils/diff'
import type { SnapshotRow } from '../api/types'
import { toastError, toastSuccess } from '../utils/toast'

const props = defineProps<{ clusterId: number }>()
const emit = defineEmits<{ close: [] }>()

const store = useExplorerStore()
const list = ref<SnapshotRow[]>([])
const label = ref('')
const busy = ref(false)
/** 对比视图：选中快照 vs 当前配置 */
const compare = ref<{ label: string; left: { text: string; changed: boolean }[]; right: { text: string; changed: boolean }[] } | null>(null)

onMounted(refresh)

async function refresh() {
  try {
    list.value = await api.listSnapshots(props.clusterId)
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 拍快照 */
async function create() {
  busy.value = true
  try {
    await api.createSnapshot(props.clusterId, label.value.trim() || `快照 ${new Date().toLocaleString()}`)
    label.value = ''
    toastSuccess('快照已保存')
    await refresh()
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    busy.value = false
  }
}

/** 回滚（Admin，集群须停止） */
async function restore(row: SnapshotRow) {
  if (!confirm(`回滚到「${row.label}」？\n要求集群已停止；将整体替换该集群当前配置。`)) return
  try {
    await api.restoreSnapshot(row.id)
    toastSuccess('已回滚到所选快照，重新启动集群即可使用还原后的配置')
    await refresh()
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 对比：快照（左）vs 当前（右） */
async function compareWithCurrent(row: SnapshotRow) {
  try {
    const [snap, cur] = await Promise.all([api.getSnapshot(row.id), api.exportCf(props.clusterId)])
    const [left, right] = diffLines(snap.main_cf, cur.main)
    compare.value = { label: row.label, left, right }
  } catch (e) {
    toastError((e as Error).message)
  }
}

const changedCount = computed(() => (compare.value ? compare.value.left.filter((x) => x.changed).length + compare.value.right.filter((x) => x.changed).length : 0))
</script>

<template>
  <teleport to="body">
    <div class="mask" @click="emit('close')">
      <div class="drawer" @click.stop>
        <div class="head">
          <span>🕘 配置快照</span>
          <button class="btn mini" @click="emit('close')">✕</button>
        </div>

        <!-- 新建 -->
        <div class="create">
          <input v-model="label" placeholder="快照标签（可空，自动时间戳）" @keyup.enter="create" />
          <button class="btn primary mini" :disabled="busy || !store.canOperate" title="需要 Operator 及以上" @click="create">＋ 拍快照</button>
        </div>

        <!-- 列表 -->
        <div class="list">
          <div v-for="row in list" :key="row.id" class="item">
            <div class="row">
              <span class="label">{{ row.label }}</span>
              <span class="time">{{ row.created_at }}</span>
            </div>
            <div class="ops">
              <button class="btn mini" @click="compareWithCurrent(row)">⇹ 与当前对比</button>
              <button class="btn mini danger" :disabled="!store.isAdmin" title="需要 Administrator，且集群须停止" @click="restore(row)">↺ 回滚</button>
            </div>
          </div>
          <div v-if="!list.length" class="empty">暂无快照，点上方「拍快照」保存当前配置基线</div>
        </div>

        <!-- 对比视图 -->
        <div v-if="compare" class="compare">
          <div class="cmp-head">
            <span>对比：{{ compare.label }}（左）vs 当前（右）· 差异 {{ changedCount }} 行</span>
            <button class="btn mini" @click="compare = null">关闭对比</button>
          </div>
          <div class="cmp-body">
            <pre class="col"><code v-for="(l, i) in compare.left" :key="'l' + i" :class="{ changed: l.changed }">{{ l.text }}
</code></pre>
            <pre class="col"><code v-for="(l, i) in compare.right" :key="'r' + i" :class="{ changed: l.changed }">{{ l.text }}
</code></pre>
          </div>
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
  width: 720px;
  max-width: 96vw;
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
.create {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #eef1f3;
}
.create input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #b8bfc7;
  border-radius: 3px;
  font-size: 12.5px;
}
.list {
  padding: 10px 16px;
  max-height: 260px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  border: 1px solid #e3e7eb;
  border-radius: 4px;
  padding: 8px 10px;
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
}
.time {
  color: #98a1aa;
  font-size: 11.5px;
}
.ops {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.empty {
  color: #98a1aa;
  font-size: 12px;
  text-align: center;
  padding: 14px;
}
.compare {
  border-top: 1px solid #e3e7eb;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.cmp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #f7f9fa;
  font-size: 12px;
}
.cmp-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: #e3e7eb;
  overflow: auto;
}
.col {
  margin: 0;
  padding: 8px 10px;
  background: #fff;
  font-family: Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
}
code.changed {
  background: #fdecea;
  color: #c0392b;
  display: block;
}
</style>
