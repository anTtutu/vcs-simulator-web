<!--
  文件：src/components/LoginModal.vue
  用途：演示级登录弹窗（D2 + P2-3）—— 还原 Windows 版 localhost:port 登录框
        admin / 任意非空密码 / 角色三选一（Administrator|Operator|Observer）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { ref } from 'vue'
import { useClusterStore } from '../stores/clusters'
import { useAuthStore, ROLES, type Role } from '../stores/auth'
import { toastError } from '../utils/toast'

const props = defineProps<{ clusterId: number }>()
const emit = defineEmits<{ close: []; ok: [] }>()

const clusterStore = useClusterStore()
const auth = useAuthStore()
const cluster = clusterStore.list.find((c) => c.id === props.clusterId)

const username = ref('admin')
const password = ref('')
const role = ref<Role>((sessionStorage.getItem('vcs_role') as Role) || 'Administrator')

const ROLE_HINT: Record<Role, string> = {
  Administrator: '全权：集群/类型管理、导入导出、快照回滚',
  Operator: '可编排：引擎动作、属性保存、剧本、心跳',
  Observer: '只读观摩：仅查看状态与只读命令',
}

/** 提交登录 */
function submit() {
  const result = auth.login(props.clusterId, username.value, password.value, role.value)
  if (result === true) emit('ok')
  else toastError(result)
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-title">localhost:{{ cluster?.simulator_port ?? '????' }}</div>
      <div class="form">
        <label>
          <span>User name</span>
          <input v-model="username" @keyup.enter="submit" />
        </label>
        <label>
          <span>Password</span>
          <input v-model="password" type="password" @keyup.enter="submit" />
        </label>
        <label>
          <span>Role</span>
          <select v-model="role">
            <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <div class="role-hint">{{ ROLE_HINT[role] }}</div>
      </div>
      <div class="hint">演示环境：用户名 admin，密码任意非空；角色决定操作权限（随请求头传递）</div>
      <div class="actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" @click="submit">OK</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="./modal.css"></style>
<style scoped>
.role-hint {
  margin: -4px 0 0 140px;
  font-size: 11px;
  color: #98a1aa;
}
</style>
