<!--
  文件：src/components/AddResourceModal.vue
  用途：新建资源向导（二期 P1-2）—— 从模板库选类型 → 命名/属性 → 选择依赖父资源 → 创建
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/client'
import { useExplorerStore } from '../stores/explorer'
import { resourceIconSvg } from '../utils/icons'
import type { AttrSchemaItem, ResourceType } from '../api/types'
import { toastError, toastSuccess } from '../utils/toast'

const props = defineProps<{ groupId: number }>()
const emit = defineEmits<{ close: [] }>()

const store = useExplorerStore()
const types = ref<ResourceType[]>([])
const step = ref(1)
const pickedType = ref<ResourceType | null>(null)
const name = ref('')
const critical = ref(false)
const draft = ref<Record<string, string>>({})
const pickedParents = ref<number[]>([])

onMounted(async () => {
  try {
    types.value = await api.listResourceTypes()
  } catch (e) {
    toastError((e as Error).message)
  }
})

/** 当前类型的 schema */
const schema = computed<AttrSchemaItem[]>(() => (pickedType.value ? JSON.parse(pickedType.value.attr_schema) : []))
/** Link 候选父资源：排除自身外全部（成环由后端校验兜底） */
const parentCandidates = computed(() => store.activeGroup?.resources ?? [])

/** 选类型 */
function pick(t: ResourceType) {
  pickedType.value = t
  name.value = `${t.code}_new`
  draft.value = Object.fromEntries(
    (JSON.parse(t.attr_schema) as AttrSchemaItem[]).map((s) => [s.key, s.default ?? '']),
  )
  step.value = 2
}

/** 提交创建（含依赖边） */
async function submit() {
  if (!pickedType.value) return
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name.value)) {
    toastError('资源名需字母开头，仅字母/数字/下划线')
    return
  }
  for (const s of schema.value) {
    if (s.required && !(draft.value[s.key] ?? '').trim()) {
      toastError(`必填属性 ${s.key} 未填写`)
      return
    }
  }
  try {
    const created = await api.addResource(props.groupId, {
      name: name.value,
      typeCode: pickedType.value.code,
      critical: critical.value,
      attrs: draft.value,
    })
    for (const pid of pickedParents.value) {
      await api.link(props.groupId, created.id, pid)
    }
    await store.reload()
    toastSuccess(`资源 ${name.value} 已创建`)
    emit('close')
  } catch (e) {
    toastError((e as Error).message)
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal wizard">
      <div class="modal-title">新建资源向导 {{ pickedType ? `· ${pickedType.label}` : '· 选择类型' }}</div>

      <!-- 步骤 1：选类型 -->
      <div v-if="step === 1" class="body">
        <div class="type-grid">
          <div v-for="t in types" :key="t.id" class="type-card" @click="pick(t)">
            <img class="type-ico" :src="resourceIconSvg(t.code)" alt="" />
            <span class="code">{{ t.code }}</span>
            <span class="lbl">{{ t.label }}</span>
          </div>
        </div>
      </div>

      <!-- 步骤 2：命名 + 属性 + 依赖 -->
      <div v-else class="body">
        <label class="row">
          <span>资源名</span>
          <input v-model="name" />
        </label>
        <label class="row">
          <span>Critical</span>
          <span><input type="checkbox" v-model="critical" /> 故障时触发整组 failover</span>
        </label>
        <div class="sec">类型属性</div>
        <label v-for="s in schema" :key="s.key" class="row">
          <span>{{ s.key }}<b v-if="s.required" class="req">*</b></span>
          <input v-model="draft[s.key]" :placeholder="s.default ? `默认 ${s.default}` : ''" />
        </label>
        <div class="sec">依赖的父资源（可多选）</div>
        <div class="parents">
          <label v-for="p in parentCandidates" :key="p.id" class="pitem">
            <input type="checkbox" :value="p.id" v-model="pickedParents" />
            {{ p.icon }} {{ p.name }}
          </label>
        </div>
      </div>

      <div class="actions">
        <button v-if="step === 2" class="btn" @click="step = 1">上一步</button>
        <span class="flex1"></span>
        <button class="btn" @click="emit('close')">Cancel</button>
        <button v-if="step === 2" class="btn primary" @click="submit">创建</button>
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
.modal.wizard {
  background: #fff;
  border-radius: 6px;
  width: 620px;
  max-width: 94vw;
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
  max-height: 60vh;
  overflow: auto;
}
.type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.type-card {
  border: 1px solid #dfe4e9;
  border-radius: 6px;
  padding: 10px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  font-size: 11.5px;
}
.type-card:hover {
  border-color: #2f6cb5;
  background: #eef4fd;
}
.type-card .type-ico {
  width: 40px;
  height: 40px;
}
.type-card .code {
  font-weight: 600;
}
.type-card .lbl {
  color: #98a1aa;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12.5px;
}
.row > span:first-child {
  width: 110px;
  text-align: right;
  color: #55606b;
}
.row input[type='text'],
.row input:not([type]) {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #b8bfc7;
  border-radius: 3px;
  font-size: 12.5px;
}
.req {
  color: #d63a2f;
}
.sec {
  color: #2f6cb5;
  font-weight: 600;
  font-size: 12px;
  margin: 10px 0 6px;
}
.parents {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pitem {
  border: 1px solid #dfe4e9;
  border-radius: 3px;
  padding: 3px 8px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.actions {
  padding: 10px 14px;
  border-top: 1px solid #e3e7eb;
  display: flex;
  gap: 8px;
}
.flex1 {
  flex: 1;
}
</style>
