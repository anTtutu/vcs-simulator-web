<!--
  文件：src/App.vue
  用途：应用外壳 —— 路由出口 + 全局 Toast 渲染
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { toasts } from './utils/toast'
</script>

<template>
  <router-view />
  <!-- 全局通知 -->
  <div class="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  padding: 8px 16px;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  background: #4a5560;
  animation: drop 0.2s ease;
}
.toast.error {
  background: #c0392b;
}
.toast.success {
  background: #2e7d32;
}
@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}
</style>
