<!--
  文件：src/views/Explorer.vue
  用途：Cluster Explorer 主界面（Windows 版拓扑浏览器还原）
        标题栏(集群+身份) / 左资源树 / 中拓扑画布(Status·Resources·Properties 三页签) / 底部系统页签
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useExplorerStore } from '../stores/explorer'
import { useAuthStore } from '../stores/auth'
import { api } from '../api/client'
import ResourceTree from '../components/ResourceTree.vue'
import TopologyCanvas from '../components/TopologyCanvas.vue'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import StatusView from '../components/StatusView.vue'
import ScenarioDrawer from '../components/ScenarioDrawer.vue'
import SnapshotDrawer from '../components/SnapshotDrawer.vue'
import CreateGroupModal from '../components/CreateGroupModal.vue'
import { toastError, toastSuccess } from '../utils/toast'

const route = useRoute()
const router = useRouter()
const store = useExplorerStore()
const auth = useAuthStore()

const clusterId = Number(route.params.clusterId)
const containerRef = ref<HTMLDivElement | null>(null)

/** 抽屉开关（P1-4 剧本 / P2-1 快照） */
const showScenario = ref(false)
const showSnapshot = ref(false)
/** 新建服务组弹窗（设计器入口：无组集群由此进入设计） */
const showCreateGroup = ref(false)

/** 删除空服务组（树上 🗑） */
async function onRemoveGroup() {
  const g = store.activeGroup
  if (!g) return
  if (g.resources.length) {
    toastError('服务组内还有资源，不能删除')
    return
  }
  if (!confirm(`删除空服务组 ${g.name}？`)) return
  try {
    await store.removeGroup(g.id)
    toastSuccess('服务组已删除')
  } catch (e) {
    toastError((e as Error).message)
  }
}

const clusterName = computed(() => store.tree?.cluster.name ?? '...')
const user = computed(() => auth.userOf(clusterId) || 'admin')

onMounted(async () => {
  try {
    await store.load(clusterId)
  } catch (e) {
    toastError((e as Error).message)
  }
})

// /explorer/:clusterId 路由复用同一组件实例（仅参数变化），必须监听参数变化重新加载
watch(
  () => route.params.clusterId,
  async (val, old) => {
    if (val && val !== old) {
      store.dispose()
      try {
        await store.load(Number(val))
      } catch (e) {
        toastError((e as Error).message)
      }
    }
  },
)

onBeforeUnmount(() => store.dispose())

/** 返回管理面板 */
function back() {
  router.push('/')
}

/** 下载文本文件（main.cf / types.cf） */
async function exportCf(withTypes: boolean) {
  try {
    const data = await api.exportCf(clusterId, withTypes)
    const text = withTypes ? data.types ?? '' : data.main
    const name = withTypes ? 'types.cf' : 'main.cf'
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
    toastSuccess(`${name} 已导出`)
  } catch (e) {
    toastError((e as Error).message)
  }
}
</script>

<template>
  <div class="explorer">
    <!-- 标题栏：还原 "SOL_ORACLE (Simulator) - Cluster Explorer : admin (Cluster Administrator)" -->
    <header class="titlebar">
      <span class="crumb link" @click="back">⬢ 集群面板</span>
      <span class="sep">›</span>
      <span>{{ clusterName }} (Simulator) - Cluster Explorer : {{ user }} (Cluster Administrator)</span>
      <span class="flex1"></span>
      <a class="tb-link" @click.prevent="showScenario = true">🎬 演练剧本</a>
      <a class="tb-link" @click.prevent="showSnapshot = true">🕘 快照</a>
      <a class="tb-link" @click.prevent="router.push(`/console/${clusterId}`)">⌨️ Console</a>
      <a class="tb-link" @click.prevent="exportCf(false)">⤓ main.cf</a>
      <a class="tb-link" @click.prevent="exportCf(true)">⤓ types.cf</a>
    </header>

    <!-- 主区页签 -->
    <nav class="view-tabs">
      <button :class="{ active: store.viewTab === 'status' }" @click="store.viewTab = 'status'">▦ Status</button>
      <button :class="{ active: store.viewTab === 'resources' }" @click="store.viewTab = 'resources'">⛃ Resources</button>
      <button :class="{ active: store.viewTab === 'properties' }" @click="store.viewTab = 'properties'">▤ Properties</button>
      <span class="flex1"></span>
      <button class="add-group" :disabled="!store.canOperate" title="新建服务组（设计入口）" @click="showCreateGroup = true">＋ 服务组</button>
    </nav>

    <div class="body">
      <!-- 左：资源树 -->
      <ResourceTree class="tree" @remove-group="onRemoveGroup" />

      <!-- 中：主视图 -->
      <main class="content" ref="containerRef">
        <StatusView v-if="store.viewTab === 'status'" />
        <template v-else-if="store.viewTab === 'resources'">
          <!-- 无服务组：设计入口引导 -->
          <div v-if="!store.activeGroup" class="design-entry">
            <div class="entry-icon">🛠</div>
            <div class="entry-text">该集群还没有服务组，无法进入拓扑设计</div>
            <button class="btn primary" :disabled="!store.canOperate" @click="showCreateGroup = true">＋ 新建服务组，开始设计</button>
          </div>
          <TopologyCanvas v-else :key="store.activeGroup.id" />
        </template>
        <PropertiesPanel v-else />
      </main>
    </div>

    <!-- 新建服务组 -->
    <CreateGroupModal v-if="showCreateGroup" @close="showCreateGroup = false" />

    <!-- 演练剧本 / 配置快照抽屉 -->
    <ScenarioDrawer v-if="showScenario" :cluster-id="clusterId" @close="showScenario = false" />
    <SnapshotDrawer v-if="showSnapshot" :cluster-id="clusterId" @close="showSnapshot = false" />
  </div>
</template>

<style scoped>
.explorer {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.titlebar {
  background: #2b2f36;
  color: #e8ecf1;
  padding: 9px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.crumb.link {
  cursor: pointer;
  color: #9ec1ff;
}
.flex1 {
  flex: 1;
}
.tb-link {
  color: #9ec1ff;
  font-size: 12px;
  cursor: pointer;
  margin-left: 10px;
}
.tb-link:hover {
  text-decoration: underline;
}
.sep {
  color: #7b848d;
}
.view-tabs {
  display: flex;
  gap: 2px;
  background: #f3f5f7;
  border-bottom: 1px solid #d8dde2;
  padding: 4px 10px 0;
}
.view-tabs button {
  border: 1px solid #d8dde2;
  border-bottom: none;
  background: #e7eaee;
  padding: 6px 18px;
  font-size: 12.5px;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  color: #55606b;
}
.view-tabs button.active {
  background: #fff;
  color: #1f2d3d;
  font-weight: 600;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.tree {
  width: 250px;
  border-right: 1px solid #d8dde2;
  background: #fff;
  overflow: auto;
}
.content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.placeholder {
  margin: auto;
  color: #98a1aa;
}
.view-tabs .flex1 {
  flex: 1;
}
.view-tabs .add-group {
  border: 1px solid #2f6cb5;
  background: #2f6cb5;
  color: #fff;
  border-radius: 4px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
  margin-bottom: 3px;
}
.view-tabs .add-group:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.design-entry {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #55606b;
}
.entry-icon {
  font-size: 42px;
}
.entry-text {
  font-size: 13.5px;
}
</style>
