<!--
  文件：src/components/AddClusterModal.vue
  用途：新建集群弹窗 —— 名称/平台/节点数，端口由后端自动分配
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api/client'
import { PLATFORMS } from '../domain-consts'
import { toastError } from '../utils/toast'

const emit = defineEmits<{ close: []; added: [] }>()

const name = ref('')
const platform = ref<string>('Solaris')
const systemCount = ref(2)
const submitting = ref(false)

/** 提交新建（前端先行校验命名规则，与后端一致） */
async function submit() {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name.value)) {
    toastError('集群名需字母开头，仅含字母/数字/下划线')
    return
  }
  submitting.value = true
  try {
    await api.createCluster({ name: name.value, platform: platform.value, systemCount: systemCount.value })
    emit('added')
  } catch (e) {
    toastError((e as Error).message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-title">Add Cluster</div>
      <div class="form">
        <label>
          <span>Cluster Name</span>
          <input v-model="name" placeholder="例如 MY_ORACLE" @keyup.enter="submit" />
        </label>
        <label>
          <span>Platform</span>
          <select v-model="platform">
            <option v-for="p in PLATFORMS" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label>
          <span>节点数 (System)</span>
          <select v-model.number="systemCount">
            <option :value="1">1（单节点）</option>
            <option :value="2">2（双机 HA）</option>
          </select>
        </label>
      </div>
      <div class="actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="submitting" @click="submit">Create</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="./modal.css"></style>
