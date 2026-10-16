<!--
  文件：src/components/LinkModal.vue
  用途：Link / Unlink 依赖编辑弹窗 —— Link 列出可候选父资源（排除自身与后代防成环）；
        Unlink 列出已有依赖
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useExplorerStore } from '../stores/explorer'
import { toastError, toastSuccess } from '../utils/toast'

const props = defineProps<{ mode: 'link' | 'unlink'; resourceId: number }>()
const emit = defineEmits<{ close: [] }>()

const store = useExplorerStore()
const group = store.activeGroup!
const res = group.resources.find((r) => r.id === props.resourceId)!
const picked = ref<number | null>(null)

/** Link 候选：组内其他资源，排除自身、现有父、以及自己的后代（防成环） */
const candidates = computed(() => {
  if (props.mode === 'unlink') {
    return res.parents.map((pid) => group.resources.find((r) => r.id === pid)!).filter(Boolean)
  }
  const exclude = new Set<number>([res.id, ...res.parents])
  // 后代收集
  const stack = [res.id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const r of group.resources) {
      if (r.parents.includes(cur) && !exclude.has(r.id)) {
        exclude.add(r.id)
        stack.push(r.id)
      }
    }
  }
  return group.resources.filter((r) => !exclude.has(r.id))
})

/** 提交 Link/Unlink */
async function submit() {
  if (!picked.value) return
  try {
    if (props.mode === 'link') await store.doLink(group.id, res.id, picked.value)
    else await store.doUnlink(group.id, res.id, picked.value)
    toastSuccess(props.mode === 'link' ? '依赖已建立' : '依赖已解除')
    emit('close')
  } catch (e) {
    toastError((e as Error).message)
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-title">{{ mode === 'link' ? 'Link：选择要依赖的父资源' : 'Unlink：选择要解除的依赖' }}</div>
      <div class="body">
        <div class="subject">{{ res.name }} {{ mode === 'link' ? 'requires →' : '当前依赖 →' }}</div>
        <div v-if="!candidates.length" class="empty">无可选项</div>
        <label v-for="c in candidates" :key="c.id" class="opt">
          <input type="radio" name="pick" :value="c.id" v-model="picked" />
          <span class="ico">{{ c.icon }}</span>
          <span>{{ c.name }}</span>
          <span class="state">{{ c.state }}</span>
        </label>
      </div>
      <div class="actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="!picked" @click="submit">OK</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 25, 30, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
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
  font-size: 13px;
}
.body {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow: auto;
}
.subject {
  font-size: 12.5px;
  color: #55606b;
  margin-bottom: 4px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12.5px;
}
.opt:hover {
  background: #eef4fd;
}
.state {
  margin-left: auto;
  color: #98a1aa;
  font-size: 11px;
}
.empty {
  color: #98a1aa;
  font-size: 12px;
  text-align: center;
  padding: 12px;
}
.actions {
  padding: 10px 14px;
  border-top: 1px solid #e3e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
