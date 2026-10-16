<!--
  文件：src/components/ResourceContextMenu.vue
  用途：资源右键菜单（Windows 版 rightClickMenu.jpg 的 20 项全量还原，按状态动态灰显）
        View/Online/Offline/Offline Prop/Fault Resource/Clear Fault/Probe/Enabled/Critical/
        Link/Unlink/Actions/Refresh/Override/Copy/Paste/Delete
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed } from 'vue'
import type { TreeResource } from '../api/types'

const props = defineProps<{
  x: number
  y: number
  resource: TreeResource
  hasClipboard: boolean
}>()
const emit = defineEmits<{ close: []; action: [name: string, payload?: string] }>()

/** 菜单项定义：disabled 按资源状态动态计算（还原 Windows 版灰显逻辑） */
const items = computed(() => {
  const r = props.resource
  const online = r.state === 'ONLINE'
  const faulted = r.state === 'FAULTED'
  const canAct = r.enabled
  return [
    { key: 'view', label: 'View', icon: '👁', disabled: false },
    { key: 'sep1', sep: true },
    { key: 'online', label: 'Online', icon: '▶', disabled: !canAct || online, hint: '要求父资源已 ONLINE' },
    { key: 'offline', label: 'Offline', icon: '⏹', disabled: !canAct || (!online && !faulted) },
    { key: 'prop', label: 'Offline Prop', icon: '⏏', disabled: !canAct || (!online && !faulted), hint: '优雅下线并传播' },
    { key: 'sep2', sep: true },
    { key: 'fault', label: 'Fault Resource', icon: '⚡', disabled: !canAct || faulted, hint: '注入持续故障' },
    { key: 'clear', label: 'Clear Fault', icon: '🧹', disabled: !faulted },
    { key: 'probe', label: 'Probe', icon: '📡', disabled: !canAct },
    { key: 'sep3', sep: true },
    { key: 'enabled', label: `Enabled  ${r.enabled ? '✓' : ''}`, icon: '🔘', disabled: false },
    { key: 'critical', label: `Critical  ${r.critical ? '✓' : ''}`, icon: '❗', disabled: false },
    { key: 'sep4', sep: true },
    { key: 'link', label: 'Link...', icon: '🔗', disabled: false },
    { key: 'unlink', label: 'Unlink...', icon: '✂', disabled: r.parents.length === 0 },
    { key: 'actions', label: 'Actions...', icon: '🛠', disabled: !canAct, hint: '类型内置动作（online/offline/clean/monitor）' },
    { key: 'sep5', sep: true },
    { key: 'refresh', label: 'Refresh Resource Info', icon: '🔄', disabled: !canAct },
    { key: 'clearinfo', label: 'Clear Resource Info', icon: '🗑', disabled: false },
    { key: 'override', label: 'Override Attributes', icon: '🧬', hint: '按系统覆盖属性' },
    { key: 'removeOverrides', label: 'Remove Attribute Overrides', icon: '❌', disabled: r.overrides.length === 0 },
    { key: 'sep6', sep: true },
    { key: 'copy', label: 'Copy', icon: '⧉', disabled: false },
    { key: 'paste', label: 'Paste', icon: '📋', disabled: !props.hasClipboard },
    { key: 'sep7', sep: true },
    { key: 'delete', label: 'Delete', icon: '🗑', disabled: online || r.state === 'STARTING' || r.state === 'STOPPING' },
  ]
})

/** 菜单项点击 */
function onItem(key: string) {
  emit('action', key)
  emit('close')
}
</script>

<template>
  <teleport to="body">
    <div class="ctx-mask" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div class="ctx-menu" :style="{ left: x + 'px', top: y + 'px' }" @click.stop>
        <template v-for="it in items" :key="it.key">
          <div v-if="it.sep" class="ctx-sep"></div>
          <div v-else class="ctx-item" :class="{ disabled: it.disabled }" :title="it.hint" @click="!it.disabled && onItem(it.key!)">
            <span class="ico">{{ it.icon }}</span>
            <span>{{ it.label }}</span>
          </div>
        </template>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
}
.ctx-menu {
  position: fixed;
  min-width: 190px;
  background: #fff;
  border: 1px solid #c6ccd2;
  border-radius: 4px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.22);
  padding: 4px 0;
  font-size: 12.5px;
  user-select: none;
}
.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  cursor: pointer;
}
.ctx-item:hover:not(.disabled) {
  background: #2f6cb5;
  color: #fff;
}
.ctx-item.disabled {
  color: #b6bdc4;
  cursor: not-allowed;
}
.ctx-item .ico {
  width: 16px;
  text-align: center;
}
.ctx-sep {
  height: 1px;
  background: #e3e7eb;
  margin: 4px 8px;
}
</style>
