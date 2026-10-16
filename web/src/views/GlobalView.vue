<!--
  文件：src/views/GlobalView.vue
  用途：Global View 跨集群容灾视图（P0-1，Windows 版 Make Clusters Global / Global View 还原）
        · 容灾分组管理（建/删）
        · 双站点布局：主站/备站集群卡片（含各服务组状态），同名服务组之间绘制复制链路（虚线流动动画）
        · 站点级演练：主站宕机 → 链路告红 + 备站可接管提示；主站恢复
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { openEventStream } from '../api/sse'
import type { Cluster, GlobalGroup } from '../api/types'
import { toastError, toastSuccess } from '../utils/toast'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()
const groups = ref<GlobalGroup[]>([])
const clusters = ref<Cluster[]>([])
const showCreate = ref(false)
const newName = ref('')
const picked = ref<number[]>([])

async function refresh() {
  try {
    ;[groups.value, clusters.value] = await Promise.all([api.listGlobal(), api.listClusters()])
  } catch (e) {
    toastError((e as Error).message)
  }
}

let closeSse: (() => void) | null = null
onMounted(() => {
  refresh()
  closeSse = openEventStream(undefined, () => refresh())
})
onBeforeUnmount(() => closeSse?.())

/** 站点角色文案 */
const siteLabel = (i: number) => (i === 0 ? '生产站点' : i === 1 ? '容灾站点' : `站点 ${i + 1}`)
const siteCls = (i: number) => (i === 0 ? 'primary' : 'secondary')

/** 同名服务组配对（复制链路） */
function pairedGroups(g: GlobalGroup): { name: string; left: { state: string } | undefined; right: { state: string } | undefined }[] {
  const l = g.clusters[0]
  const r = g.clusters[1]
  if (!l || !r) return []
  const names = new Set([...l.groups.map((x) => x.name), ...r.groups.map((x) => x.name)])
  return [...names].map((name) => ({
    name,
    left: l.groups.find((x) => x.name === name),
    right: r.groups.find((x) => x.name === name),
  }))
}

/** 主站是否宕机（演练中） */
const primaryDown = (g: GlobalGroup) => g.clusters[0]?.status !== 'RUNNING'

/** 建分组 */
async function create() {
  if (!newName.value.trim() || picked.value.length < 2) {
    toastError('填写分组名并选择至少 2 个集群')
    return
  }
  try {
    await api.createGlobal(newName.value.trim(), picked.value)
    toastSuccess('容灾分组已创建')
    showCreate.value = false
    newName.value = ''
    picked.value = []
    await refresh()
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 站点演练：停/启主站集群（对齐 scenario 的 site-disaster 叙事） */
async function togglePrimary(g: GlobalGroup) {
  const primary = g.clusters[0]
  if (!primary) return
  try {
    if (primary.status === 'RUNNING') {
      if (!confirm(`模拟主站灾难：停止集群 ${primary.name}？`)) return
      await api.stopCluster(primary.id)
      toastSuccess('主站已停止：复制链路告红，备站可执行接管上线')
    } else {
      await api.startCluster(primary.id)
      toastSuccess('主站恢复启动中…')
    }
  } catch (e) {
    toastError((e as Error).message)
  }
}
</script>

<template>
  <div class="global-view">
    <header class="bar">
      <span class="crumb link" @click="router.push('/')">⬢ 集群面板</span>
      <span class="sep">›</span>
      <span>Global View（跨集群容灾）</span>
      <span class="flex1"></span>
      <a class="nav-link" @click.prevent="router.push('/monitor')">📺 Monitor</a>
      <button class="btn mini light" :disabled="!auth.isAdmin" title="需要 Administrator" @click="showCreate = true">🔗 Make Clusters Global</button>
    </header>

    <div class="content">
      <!-- 分组画布 -->
      <section v-for="g in groups" :key="g.id" class="pair">
        <div class="pair-head">
          <span class="pair-name">🌐 {{ g.name }}</span>
          <span class="pair-tag" :class="{ down: primaryDown(g) }">{{ primaryDown(g) ? '⚠ 主站不可用' : '双站运行中' }}</span>
          <span class="flex1"></span>
          <button class="btn mini" :disabled="!auth.canOperate" @click="togglePrimary(g)">
            {{ primaryDown(g) ? '▶ 恢复主站' : '⚡ 模拟主站灾难' }}
          </button>
          <button class="btn mini danger" :disabled="!auth.isAdmin" @click="api.deleteGlobal(g.id).then(refresh).catch(toastError)">删除分组</button>
        </div>

        <div class="sites">
          <!-- 左站 -->
          <div class="site" :class="[siteCls(0), { down: primaryDown(g) }]">
            <div class="site-label">{{ siteLabel(0) }}</div>
            <template v-for="c in [g.clusters[0]]">
              <div v-if="c" class="cluster-card" @click="router.push(`/explorer/${c.id}`)">
                <div class="c-name">{{ c.name }} <span class="c-status">{{ c.status }}</span></div>
                <div class="c-groups">
                  <span v-for="grp in c.groups" :key="grp.name" class="grp" :class="grp.state.toLowerCase()">
                    📦 {{ grp.name }}<template v-if="grp.currentSystem"> @{{ grp.currentSystem }}</template>
                  </span>
                  <span v-if="!c.groups.length" class="none">无服务组</span>
                </div>
              </div>
              <div v-else class="cluster-card none">集群已被删除</div>
            </template>
          </div>

          <!-- 中间复制链路 -->
          <div class="links">
            <div v-for="p in pairedGroups(g)" :key="p.name" class="link-row" :class="{ red: primaryDown(g) }">
              <div class="link-line"></div>
              <div class="link-name">VVR/SRDF · {{ p.name }}</div>
            </div>
            <div v-if="!pairedGroups(g).length" class="link-none">两站暂无可配对服务组</div>
          </div>

          <!-- 右站 -->
          <div class="site secondary">
            <div class="site-label">{{ siteLabel(1) }}</div>
            <template v-for="c in [g.clusters[1]]">
              <div v-if="c" class="cluster-card" @click="router.push(`/explorer/${c.id}`)">
                <div class="c-name">{{ c.name }} <span class="c-status">{{ c.status }}</span></div>
                <div class="c-groups">
                  <span v-for="grp in c.groups" :key="grp.name" class="grp" :class="grp.state.toLowerCase()">
                    📦 {{ grp.name }}<template v-if="grp.currentSystem"> @{{ grp.currentSystem }}</template>
                  </span>
                  <span v-if="!c.groups.length" class="none">无服务组</span>
                </div>
              </div>
              <div v-else class="cluster-card none">集群已被删除</div>
            </template>
          </div>
        </div>
        <div v-if="primaryDown(g)" class="takeover-hint">
          💡 备站接管路径：存储层完成 SRDF/VVR 切换（模拟器按已切换处理）→ 在备站集群对同名服务组执行「组上线」
        </div>
      </section>

      <div v-if="!groups.length" class="empty">
        尚无容灾分组。点击右上「🔗 Make Clusters Global」把成对集群（如 SOL_ORA_SRDF_C1/C2）编为一组。
      </div>
    </div>

    <!-- 新建分组弹窗 -->
    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <div class="modal">
        <div class="modal-title">Make Clusters Global</div>
        <div class="m-body">
          <label class="row"><span>分组名</span><input v-model="newName" placeholder="SRDF-ORA" /></label>
          <div class="sec">选择集群（≥2，顺序即 主站→备站）</div>
          <label v-for="c in clusters" :key="c.id" class="pick">
            <input type="checkbox" :value="c.id" v-model="picked" />
            {{ c.name }}（{{ c.platform }}）
          </label>
        </div>
        <div class="m-actions">
          <button class="btn" @click="showCreate = false">Cancel</button>
          <button class="btn primary" @click="create">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.global-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #e8eaed;
}
.bar {
  background: #2b2f36;
  color: #e8ecf1;
  padding: 9px 16px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.crumb.link {
  cursor: pointer;
  color: #9ec1ff;
}
.sep {
  color: #7b848d;
}
.flex1 {
  flex: 1;
}
.nav-link {
  color: #9ec1ff;
  font-size: 12px;
  cursor: pointer;
}
.btn.light {
  background: #3a4149;
  border-color: #565e67;
  color: #e8ecf1;
}
.content {
  flex: 1;
  overflow: auto;
  padding: 14px;
}
.pair {
  background: #fff;
  border: 1px solid #c6ccd2;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 14px;
}
.pair-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.pair-name {
  font-weight: 700;
  font-size: 14px;
  color: #24313f;
}
.pair-tag {
  font-size: 11.5px;
  border-radius: 10px;
  padding: 2px 10px;
  background: #e8f5e9;
  color: #2e7d32;
}
.pair-tag.down {
  background: #fdecea;
  color: #c0392b;
  font-weight: 600;
}
.sites {
  display: grid;
  grid-template-columns: 1fr 180px 1fr;
  gap: 10px;
  align-items: stretch;
}
.site {
  border: 1px dashed #b8c4cf;
  border-radius: 8px;
  padding: 10px;
}
.site.primary {
  background: #f7fbf7;
}
.site.secondary {
  background: #f7f9fc;
}
.site.down {
  background: #fdf3f2;
  border-color: #e2a69f;
}
.site-label {
  font-size: 11.5px;
  color: #7b848d;
  font-weight: 600;
  margin-bottom: 6px;
}
.cluster-card {
  background: #fff;
  border: 1px solid #dfe4e9;
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
}
.cluster-card:hover {
  border-color: #2f6cb5;
}
.c-name {
  font-weight: 600;
  font-size: 12.5px;
}
.c-status {
  font-size: 10.5px;
  color: #98a1aa;
  margin-left: 4px;
}
.c-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.grp {
  font-size: 11.5px;
  border-radius: 3px;
  padding: 2px 6px;
  background: #f1f3f5;
}
.grp.online {
  background: #e8f5e9;
  color: #2e7d32;
}
.grp.faulted {
  background: #fdecea;
  color: #c0392b;
}
.none {
  color: #98a1aa;
  font-size: 11.5px;
}
.links {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 0 4px;
}
.link-row {
  position: relative;
  height: 26px;
  display: flex;
  align-items: center;
}
.link-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 3px dashed #7fb0e8;
  animation: linkflow 1s linear infinite;
}
@keyframes linkflow {
  to {
    opacity: 0.45;
  }
}
.link-row.red .link-line {
  border-top-color: #d63a2f;
  animation: none;
}
.link-name {
  position: relative;
  background: #fff;
  border: 1px solid #dfe4e9;
  border-radius: 10px;
  font-size: 10.5px;
  color: #55606b;
  padding: 1px 8px;
  margin: 0 auto;
  white-space: nowrap;
}
.link-none {
  text-align: center;
  color: #98a1aa;
  font-size: 11px;
}
.takeover-hint {
  margin-top: 10px;
  background: #fff8e6;
  border: 1px solid #f0e2a0;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  color: #8a6d1a;
}
.empty {
  text-align: center;
  color: #98a1aa;
  padding: 60px 20px;
  font-size: 13px;
}
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
  width: 420px;
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
.m-body {
  padding: 14px 18px;
  max-height: 50vh;
  overflow: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 12.5px;
}
.row > span {
  width: 70px;
  color: #55606b;
}
.row input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #b8bfc7;
  border-radius: 3px;
}
.sec {
  font-size: 12px;
  color: #2f6cb5;
  font-weight: 600;
  margin: 6px 0;
}
.pick {
  display: block;
  font-size: 12.5px;
  padding: 3px 4px;
  cursor: pointer;
}
.m-actions {
  padding: 10px 14px;
  border-top: 1px solid #e3e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
/* 窄屏：纵向堆叠（P2-5 移动端观摩） */
@media (max-width: 760px) {
  .sites {
    grid-template-columns: 1fr;
  }
  .links {
    flex-direction: row;
    justify-content: center;
  }
}
</style>
