<!--
  文件：src/components/ResourceTree.vue
  用途：左侧资源树 —— 双模式：按类型分组（Windows 版 resources.jpg）/ 组下平铺
        点击资源 → 切到 Properties 并联动画布高亮
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useExplorerStore } from '../stores/explorer'
import { STATE_COLORS } from '../utils/icons'

const store = useExplorerStore()
const emit = defineEmits<{ removeGroup: [] }>()

/** 折叠状态（类型文件夹与平铺模式共用 key） */
const collapsed = ref(new Set<string>())
function toggle(key: string) {
  const s = new Set(collapsed.value)
  s.has(key) ? s.delete(key) : s.add(key)
  collapsed.value = s
}

/** 当前组按类型分组视图：[{ type, items }]（用数组规避 Vue 对 Map 的 v-for 解构差异） */
const byType = computed(() => {
  const map = new Map<string, typeof resources>()
  const resources = store.activeGroup?.resources ?? []
  for (const r of resources) {
    if (!map.has(r.typeCode)) map.set(r.typeCode, [])
    map.get(r.typeCode)!.push(r)
  }
  return Array.from(map.entries()).map(([type, items]) => ({ type, items }))
})

const flatResources = computed(() => store.activeGroup?.resources ?? [])

/** 选中资源 */
function pick(id: number) {
  store.selectResource(id)
}

/** 状态色点 */
const dot = (state: string) => ({ background: STATE_COLORS[state] ?? '#c0c4cc' })
</script>

<template>
  <div class="rtree">
    <!-- 树模式切换 -->
    <div class="mode">
      <button :class="{ active: store.treeMode === 'grouped' }" title="按资源类型分组（Windows 版 Resources 视图）" @click="store.treeMode = 'grouped'">
        🗂 按类型
      </button>
      <button :class="{ active: store.treeMode === 'flat' }" title="组下平铺" @click="store.treeMode = 'flat'">
        ☰ 平铺
      </button>
    </div>

    <div v-if="!store.activeGroup" class="empty">无服务组</div>

    <template v-else>
      <!-- 根：集群 → 服务组 -->
      <div class="node root" @click="toggle('group:' + store.activeGroup.id)">
        <span class="caret">{{ collapsed.has('group:' + store.activeGroup.id) ? '▸' : '▾' }}</span>
        <span class="icon">❀</span>
        <span class="name strong">{{ store.tree?.cluster.name }}</span>
      </div>
      <div v-if="!collapsed.has('group:' + store.activeGroup.id)" class="indent">
        <div class="node group" :class="{ picked: true }" @click="store.activeGroupId = store.activeGroup!.id">
          <span class="icon">📦</span>
          <span class="name strong">{{ store.activeGroup.name }}</span>
          <button
            v-if="!store.activeGroup.resources.length && store.canOperate"
            class="grp-del"
            title="删除空服务组"
            @click.stop="$emit('removeGroup')"
          >
            🗑
          </button>
        </div>

        <!-- 按类型分组 -->
        <div v-if="store.treeMode === 'grouped'" class="indent">
          <template v-for="grp in byType" :key="grp.type">
            <div class="node" @click="toggle('type:' + grp.type)">
              <span class="caret">{{ collapsed.has('type:' + grp.type) ? '▸' : '▾' }}</span>
              <span class="icon">📁</span>
              <span class="name">{{ grp.type }}</span>
              <span class="count">{{ grp.items.length }}</span>
            </div>
            <div v-if="!collapsed.has('type:' + grp.type)" class="indent">
              <div
                v-for="r in grp.items"
                :key="r.id"
                class="node leaf"
                :class="{ picked: r.id === store.selectedResourceId }"
                @click="pick(r.id)"
              >
                <span class="caret-space"></span>
                <span class="icon">{{ r.icon }}</span>
                <span class="name" :title="r.name">{{ r.name }}</span>
                <span class="dot" :class="{ breathing: r.state === 'ONLINE' }" :style="dot(r.state)"></span>
                <span v-if="r.critical" class="crit" title="Critical 资源">C</span>
              </div>
            </div>
          </template>
        </div>

        <!-- 平铺 -->
        <div v-else class="indent">
          <div
            v-for="r in flatResources"
            :key="r.id"
            class="node leaf"
            :class="{ picked: r.id === store.selectedResourceId }"
            @click="pick(r.id)"
          >
            <span class="icon">{{ r.icon }}</span>
            <span class="name" :title="r.name">{{ r.name }}</span>
            <span class="dot" :class="{ breathing: r.state === 'ONLINE' }" :style="dot(r.state)"></span>
            <span v-if="r.critical" class="crit" title="Critical 资源">C</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rtree {
  padding: 8px 6px;
  font-size: 12.5px;
}
.mode {
  display: flex;
  gap: 4px;
  padding: 0 4px 8px;
  border-bottom: 1px solid #eef1f3;
}
.mode button {
  border: 1px solid #d8dde2;
  background: #f7f9fa;
  border-radius: 3px;
  font-size: 11.5px;
  padding: 3px 8px;
  cursor: pointer;
}
.mode button.active {
  background: #2f6cb5;
  color: #fff;
  border-color: #2a5e9e;
}
.node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3.5px 6px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.node:hover {
  background: #eef4fd;
}
.node.picked {
  background: #d8e7fb;
}
.node .name {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}
.grp-del {
  margin-left: auto;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 11px;
  opacity: 0.6;
}
.grp-del:hover {
  opacity: 1;
}
.strong {
  font-weight: 600;
}
.caret {
  width: 12px;
  color: #7b848d;
  font-size: 10px;
}
.caret-space {
  width: 12px;
}
.count {
  color: #98a1aa;
  font-size: 11px;
}
.indent {
  margin-left: 16px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: auto;
  flex: none;
  transition: background 0.4s ease;
}
/* ONLINE 呼吸灯（监控心跳的视觉隐喻） */
.dot.breathing {
  animation: breathe 2.2s ease-in-out infinite;
}
@keyframes breathe {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(46, 158, 68, 0.55);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(46, 158, 68, 0);
  }
}
.crit {
  color: #d63a2f;
  font-size: 10px;
  font-weight: 700;
  border: 1px solid #d63a2f;
  border-radius: 2px;
  padding: 0 2px;
  flex: none;
}
.empty {
  color: #98a1aa;
  text-align: center;
  padding: 20px;
}
</style>
