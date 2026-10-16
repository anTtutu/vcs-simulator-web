<!--
  文件：src/components/CreateGroupModal.vue
  用途：新建服务组弹窗（集群设计器入口）—— 组名 + 可运行节点勾选（缺省全部）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useExplorerStore } from '../stores/explorer'
import { toastError, toastSuccess } from '../utils/toast'

const emit = defineEmits<{ close: [] }>()
const store = useExplorerStore()

const name = ref('')
const picked = ref<string[]>(store.tree?.systems.map((s) => s.name) ?? [])
const busy = ref(false)

const valid = computed(() => /^[A-Za-z][A-Za-z0-9_]*$/.test(name.value) && picked.value.length > 0)

async function submit() {
  if (!valid.value) {
    toastError('组名需字母开头（仅字母/数字/下划线），且至少勾选 1 个节点')
    return
  }
  busy.value = true
  try {
    await store.createGroup(name.value, picked.value)
    toastSuccess(`服务组 ${name.value} 已创建，可开始设计资源拓扑`)
    emit('close')
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-title">＋ 新建服务组（{{ store.tree?.cluster.name }}）</div>
      <div class="form">
        <label>
          <span>组名</span>
          <input v-model="name" placeholder="例如 ORA_PROD_Group" @keyup.enter="submit" />
        </label>
        <div class="row">
          <span>可运行节点</span>
          <span class="checks">
            <!-- 注意：label 不可嵌套 label，勾选项用 span -->
            <span v-for="s in store.tree?.systems ?? []" :key="s.id" class="check">
              <input type="checkbox" :value="s.name" v-model="picked" /> 🖥 {{ s.name }}
            </span>
          </span>
        </div>
      </div>
      <div class="hint">创建后自动选中该组，直接进入拓扑设计（右键/＋资源 添加组件，Link 建依赖）</div>
      <div class="actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy || !valid" @click="submit">创建</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="./modal.css"></style>
<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 12.5px;
}
.row > span:first-child {
  width: 110px;
  text-align: right;
  color: #55606b;
  flex: none;
  padding-top: 5px;
}
.checks {
  display: flex;
  gap: 12px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  cursor: pointer;
}
</style>
