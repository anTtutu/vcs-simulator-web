<!--
  文件：src/components/TopologyCanvas.vue
  用途：AntV X6 拓扑画布（Windows 版 VCS Simulator 视觉还原版）
        · 节点 = 立体类型图标 + 下方标签（无边框盒子，还原 Windows 版观感），
          状态以「图标光晕 + 角标色点」表达：ONLINE 绿晕 / FAULTED 红晕 / STARTING 黄色脉冲
        · 自由拖拽：节点可拖动，松手即持久化坐标（SQLite resource_pos）；Auto Arrange 清坐标重排
        · 依赖边细绿线直连图标中心；编排期虚线流动动画
        · 工具条：组上线/下线/切换、＋资源、PNG 导出、Auto Arrange、缩放
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Graph } from '@antv/x6'
import { useExplorerStore } from '../stores/explorer'
import { computeLayeredLayout } from '../utils/layout'
import { STATE_COLORS, resourceIconSvg } from '../utils/icons'
import { toastError, toastSuccess } from '../utils/toast'
import ResourceContextMenu from './ResourceContextMenu.vue'
import LinkModal from './LinkModal.vue'
import AddResourceModal from './AddResourceModal.vue'
import { api } from '../api/client'

const store = useExplorerStore()
const canvasRef = ref<HTMLDivElement | null>(null)

let graph: Graph | null = null
/** 静音拖拽保存失败提示（一次即可） */
let posSaveWarned = false

/** 右键菜单 / 弹窗状态 */
const menu = ref<{ x: number; y: number; resourceId: number } | null>(null)
const linkModal = ref<{ mode: 'link' | 'unlink'; resourceId: number } | null>(null)
const showAddResource = ref(false)

const group = computed(() => store.activeGroup)
const title = computed(() => `Resource View: ${group.value?.name ?? ''} ${store.systemTitleSuffix}`)
const orchestrating = computed(() => ['STARTING', 'STOPPING'].includes(group.value?.state ?? ''))

/**
 * 系统视图灰显判定（还原 Windows 版 on sys 切换语义）：
 * 选定某系统时，运行在该系统的资源正常显示；不在该系统运行的资源整组淡出灰显
 */
const viewDimmed = computed(() => {
  if (store.systemTab === 'all') return false
  return (group.value?.currentSystem ?? null) !== store.systemTab
})

/** 状态 → 图标光晕 class（Windows 版以图标外观表达状态） */
function iconClass(state: string): string {
  switch (state) {
    case 'ONLINE':
      return 'glow-green'
    case 'FAULTED':
      return 'glow-red'
    case 'STARTING':
    case 'STOPPING':
      return 'glow-amber'
    default:
      return ''
  }
}

/** 计算布局：全部资源有保存坐标 → 用保存的；否则自动分层（保存过的优先） */
function resolvePositions(g: NonNullable<typeof group.value>) {
  const allSaved = g.resources.length > 0 && g.resources.every((r) => r.pos)
  if (allSaved) {
    const map = new Map<number, { x: number; y: number; level: number }>()
    for (const r of g.resources) map.set(r.id, { x: r.pos!.x, y: r.pos!.y, level: 0 })
    return { pos: map, auto: false }
  }
  const auto = computeLayeredLayout(
    g.resources.map((r) => ({ id: r.id })),
    g.resources.flatMap((r) => r.parents.map((p) => ({ childId: r.id, parentId: p }))),
  )
  // 有保存坐标的资源优先（部分保存场景）
  for (const r of g.resources) {
    if (r.pos) auto.set(r.id, { x: r.pos.x, y: r.pos.y, level: auto.get(r.id)?.level ?? 0 })
  }
  return { pos: auto, auto: true }
}

/** 渲染拓扑（组切换 / Auto Arrange 时全量重建） */
function render() {
  if (!graph || !group.value) return
  const g = group.value
  graph.clearCells()

  const { pos, auto } = resolvePositions(g)

  // ---- Windows 版风格节点：图标 + 下方标签（无边框盒子） ----
  for (const r of g.resources) {
    const p = pos.get(r.id)!
    graph.addNode({
      id: String(r.id),
      x: p.x,
      y: p.y,
      width: 118,
      height: 50,
      markup: [
        { tagName: 'rect', selector: 'body' },
        { tagName: 'image', selector: 'icon' },
        { tagName: 'circle', selector: 'dot' },
        { tagName: 'text', selector: 'label' },
      ],
      attrs: {
        body: {
          // 透明命中区域：平时不可见，选中时以虚线框提示
          fill: 'transparent',
          stroke: 'transparent',
          rx: 8,
          ry: 8,
          cursor: 'move',
        },
        icon: {
          // Windows 版风格立体类型图标（Fluent 3D，尺寸贴近原版的小巧比例）
          xlinkHref: resourceIconSvg(r.typeCode),
          width: 30,
          height: 30,
          refX: 44,
          refY: 2,
          cursor: 'pointer',
          class: iconClass(r.state),
        },
        dot: {
          // 状态角标（图标右上角色点）
          refX: 72,
          refY: 4,
          r: 3.8,
          fill: STATE_COLORS[r.state] ?? '#8a9099',
          stroke: '#fff',
          strokeWidth: 1,
          cursor: 'pointer',
        },
        label: {
          text: r.enabled ? r.name : `${r.name}（禁用）`,
          refX: 59,
          refY: 43,
          textAnchor: 'middle',
          textVerticalAnchor: 'middle',
          fontSize: 11.5,
          fill: r.enabled ? '#24313f' : '#9aa2ab',
          cursor: 'pointer',
        },
      },
    })
  }

  // ---- 依赖边：细绿线直连图标中心（Windows 版风格） ----
  for (const r of g.resources) {
    for (const pid of r.parents) {
      graph.addEdge({
        source: String(r.id),
        target: String(pid),
        connector: { name: 'normal' },
        attrs: { line: { stroke: '#7a9a7a', strokeWidth: 1.2, targetMarker: null } },
      })
    }
  }
  if (auto) graph.centerContent()
  applyEdgeFlow()
  applyViewDim()
}

/**
 * 系统视图切换（底部 sys1/sys2 页签）：非当前运行系统的视图整体灰显
 * —— 组运行在 sys1 时切 sys2，所有资源半透明（该系统上未运行）；切回 sys1/all 恢复
 */
function applyViewDim() {
  if (!graph || !group.value) return
  const dim = viewDimmed.value
  const op = dim ? 0.28 : 1
  for (const r of group.value.resources) {
    const node = graph.getCellById(String(r.id))
    if (!node) continue
    node.attr('icon/opacity', op)
    node.attr('dot/opacity', op)
    node.attr('label/opacity', dim ? 0.4 : 1)
  }
  for (const e of graph.getEdges()) {
    e.attr('line/opacity', dim ? 0.2 : 1)
  }
}

/** 边流动画开关（编排中：虚线流动；结束：恢复实线） */
function applyEdgeFlow() {
  if (!graph) return
  const on = orchestrating.value
  for (const e of graph.getEdges()) {
    if (on) {
      e.attr('line/strokeDasharray', '7 5')
      e.attr('line/class', 'vcs-flow')
    } else {
      // X6 无 removeAttr：class 置空串、dasharray 置 null 恢复默认实线
      e.attr('line/class', '')
      e.attr('line/strokeDasharray', null)
    }
  }
}

/** 状态就地更新（不重建画布）：角标色点 + 图标光晕 + 标签色 */
function applyStates() {
  if (!graph || !group.value) return
  for (const r of group.value.resources) {
    const node = graph.getCellById(String(r.id))
    if (!node) continue
    const prev = nodeStatePrev.get(String(r.id))
    const color = STATE_COLORS[r.state] ?? '#8a9099'
    node.attr('dot/fill', color)
    node.attr('icon/class', iconClass(r.state))
    node.attr('label/fill', r.enabled ? (r.state === 'FAULTED' ? '#c0392b' : '#24313f') : '#9aa2ab')
    // 状态跃迁脉冲（上线/故障）
    if (prev && prev !== r.state && (r.state === 'ONLINE' || r.state === 'FAULTED')) {
      node.attr('icon/class', `${iconClass(r.state)} vcs-blink`)
      setTimeout(() => node.attr('icon/class', iconClass(r.state)), 1100)
    }
    nodeStatePrev.set(String(r.id), r.state)
  }
}
const nodeStatePrev = new Map<string, string>()

onMounted(() => {
  if (!canvasRef.value) return
  graph = new Graph({
    container: canvasRef.value,
    background: { color: '#f2f7ee' },
    grid: { size: 18, visible: true, type: 'dot', args: { color: '#dde7d8' } },
    panning: true,
    mousewheel: { enabled: true, modifiers: ['ctrl', 'meta'], minScale: 0.3, maxScale: 2.5 },
    // 自由拖拽：节点可拖（松手持久化），边不可拖
    interacting: { nodeMovable: true, edgeMovable: false, vertexMovable: false, arrowheadMovable: false },
  })
  render()
  // 点击 → 选中（属性联动 + 虚线框）
  graph.on('cell:click', ({ cell }) => {
    if (!cell.isNode()) return
    // 取消旧选中框
    for (const n of graph!.getNodes()) n.attr('body/stroke', 'transparent')
    cell.attr('body/stroke', '#2f6cb5')
    cell.attr('body/strokeDasharray', '4 3')
    store.selectResource(Number(cell.id))
  })
  graph.on('blank:click', () => {
    for (const n of graph!.getNodes()) n.attr('body/stroke', 'transparent')
  })
  // 右键菜单
  graph.on('node:contextmenu', ({ e, cell }) => {
    e.preventDefault()
    const id = Number(cell.id)
    if (group.value?.resources.some((r) => r.id === id)) {
      menu.value = { x: e.clientX, y: e.clientY, resourceId: id }
    }
  })
  // 拖拽结束 → 坐标持久化（自由布局保存）
  graph.on('node:moved', ({ node, e }) => {
    e.preventDefault?.()
    const { x, y } = node.getPosition()
    api
      .savePosition(Number(node.id), Math.round(x), Math.round(y))
      .catch(() => {
        if (!posSaveWarned) {
          posSaveWarned = true
          toastError('坐标保存失败（需要 Operator 及以上角色）')
        }
      })
  })
})

onBeforeUnmount(() => {
  graph?.dispose()
  graph = null
})

watch(() => group.value?.id, render)
watch(() => group.value?.resources.map((r) => `${r.id}:${r.state}`).join('|'), applyStates)
watch(orchestrating, applyEdgeFlow)
// 系统页签切换 / failover 运行节点变化 → 视图灰显联动
watch(() => store.systemTab, applyViewDim)
watch(() => group.value?.currentSystem, applyViewDim)

// ==================== 工具条 ====================
/** Auto Arrange：清空保存坐标 → 自动分层布局 */
async function onAutoArrange() {
  if (!group.value) return
  try {
    await api.clearPositions(group.value.id)
    render()
    toastSuccess('已恢复自动布局')
  } catch (e) {
    toastError((e as Error).message)
  }
}
function zoom(factor: number) {
  graph?.zoom(factor)
}
function zoomFit() {
  graph?.zoomToFit({ padding: 40, maxScale: 1 })
}

/** 导出 PNG（P2-4） */
async function exportPng() {
  if (!graph) return
  try {
    const dataUrl = await graph.toPNG({ padding: 40, backgroundColor: '#f2f7ee', quality: 0.92 })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${group.value?.name ?? 'topology'}.png`
    a.click()
    toastSuccess('拓扑图已导出 PNG')
  } catch (e) {
    toastError(`PNG 导出失败：${(e as Error).message}`)
  }
}

// ==================== 右键菜单动作分发 ====================
async function onMenuAction(name: string) {
  if (!menu.value || !group.value) return
  const rid = menu.value.resourceId
  const res = group.value.resources.find((r) => r.id === rid)!
  try {
    switch (name) {
      case 'view':
        store.selectResource(rid)
        break
      case 'online':
        await store.resAction(rid, 'online')
        break
      case 'offline':
        await store.resAction(rid, 'offline')
        break
      case 'prop':
        await store.resAction(rid, 'prop')
        break
      case 'fault':
        await store.resAction(rid, 'fault')
        toastSuccess(`已注入故障：${res.name}（Critical=${res.critical ? '是，将触发 failover' : '否'}）`)
        break
      case 'clear':
        await store.resAction(rid, 'clear')
        break
      case 'probe':
        await store.resAction(rid, 'probe')
        break
      case 'actions': {
        // 类型内置动作（对齐 VCS agent action：online/offline/clean/monitor）
        const pickAction = window.prompt('执行类型动作（online / offline / clean / monitor）', 'monitor')
        const map: Record<string, 'online' | 'offline' | 'probe' | 'clear'> = {
          online: 'online',
          offline: 'offline',
          clean: 'clear',
          monitor: 'probe',
        }
        const act = map[(pickAction ?? '').trim().toLowerCase()]
        if (!act) {
          if (pickAction) toastError('支持的动作：online / offline / clean / monitor')
          return
        }
        await store.resAction(rid, act)
        toastSuccess(`动作 ${pickAction} 执行完成`)
        break
      }
      case 'refresh':
        await store.resAction(rid, 'probe') // Refresh Resource Info ≈ 立即探测刷新
        break
      case 'clearinfo':
        toastSuccess('资源探测缓存已清除（模拟语义：下次探测将重新采集）')
        break
      case 'enabled':
        await store.setFlags(rid, { enabled: !res.enabled })
        break
      case 'critical':
        await store.setFlags(rid, { critical: !res.critical })
        break
      case 'link':
        linkModal.value = { mode: 'link', resourceId: rid }
        break
      case 'unlink':
        linkModal.value = { mode: 'unlink', resourceId: rid }
        break
      case 'override':
        // 打开属性编辑并聚焦覆盖区
        store.selectResource(rid)
        store.autoEditOverrides = true
        break
      case 'removeOverrides':
        if (confirm(`移除 ${res.name} 的全部 per-system 覆盖（${res.overrides.length} 条）？`)) {
          await store.saveAttrs(rid, { ...res.attrs }, [])
          toastSuccess('覆盖已移除')
        }
        break
      case 'copy':
        store.clipboard = { typeCode: res.typeCode, attrs: { ...res.attrs }, critical: res.critical }
        toastSuccess(`已复制 ${res.name}（${res.typeCode}）`)
        break
      case 'paste': {
        const base = res.name.replace(/_\d+$/, '')
        const name = window.prompt('新资源名称（Paste）', `${base}_copy`)
        if (!name) return
        await store.pasteResource(group.value.id, name, store.clipboard!)
        break
      }
      case 'delete':
        if (confirm(`确定删除资源 ${res.name} 吗？其依赖边将一并移除。`)) {
          await store.deleteRes(rid)
        }
        break
    }
  } catch (e) {
    toastError((e as Error).message)
  }
}
</script>

<template>
  <div class="topo">
    <!-- 工具条：标题 + 组操作 + 视图操作 -->
    <div class="bar">
      <span class="title">⬡ {{ title }}</span>
      <span class="running" v-if="group?.currentSystem">▶ {{ group.name }} @ {{ group.currentSystem }}</span>
      <span class="flex1"></span>
      <button class="btn mini" :disabled="!group || group.state === 'ONLINE' || orchestrating" title="hagrp -online（默认节点）" @click="store.groupOnline().catch(toastError)">▶ 组上线</button>
      <button class="btn mini" :disabled="!group || group.state === 'OFFLINE' || orchestrating" title="hagrp -offline" @click="store.groupOffline().catch(toastError)">⏹ 组下线</button>
      <select class="mini-select" v-model="store.switchTarget" :disabled="!group">
        <option value="">切换到…</option>
        <option v-for="s in group?.systemList ?? []" :key="s.name" :value="s.name">{{ s.name }}</option>
      </select>
      <button class="btn mini" :disabled="!group || !store.switchTarget || orchestrating" title="hagrp -switch（failover 演练）" @click="store.groupSwitch(store.switchTarget).catch(toastError)">⇄ 切换</button>
      <span class="vsep"></span>
      <button class="btn mini" :disabled="!store.canOperate" title="从模板新建资源" @click="showAddResource = true">＋ 资源</button>
      <button class="btn mini" title="导出拓扑 PNG" @click="exportPng">📷 PNG</button>
      <button class="btn mini" title="清空保存坐标，恢复自动分层布局" @click="onAutoArrange">⌗ Auto Arrange</button>
      <button class="btn mini" @click="zoom(0.15)">＋</button>
      <button class="btn mini" @click="zoom(-0.15)">－</button>
      <button class="btn mini" @click="zoomFit">⛶ Fit</button>
    </div>

    <!-- 画布 -->
    <div ref="canvasRef" class="canvas">
      <!-- 空服务组设计引导 -->
      <div v-if="group && !group.resources.length" class="empty-guide">
        <div class="eg-title">空服务组：开始设计集群组件</div>
        <div class="eg-steps">
          ① 点右上「＋ 资源」从模板添加组件（可多个）<br />
          ② 右键资源 →「Link...」建立依赖关系<br />
          ③ 完成后「▶ 组上线」验证编排顺序
        </div>
        <button class="btn primary" :disabled="!store.canOperate" @click="showAddResource = true">＋ 添加第一个资源</button>
      </div>
    </div>

    <!-- 底部系统页签：● 标记当前运行节点；切换 = 该系统视图（非运行系统灰显） -->
    <div class="systabs">
      <button :class="{ active: store.systemTab === 'all' }" @click="store.systemTab = 'all'">
        📦 {{ group?.name ?? '' }}
      </button>
      <button
        v-for="s in store.tree?.systems ?? []"
        :key="s.id"
        :class="{ active: store.systemTab === s.name, running: s.name === group?.currentSystem }"
        :title="`查看 ${s.name} 系统视图${s.name === group?.currentSystem ? '（当前运行节点）' : ''}`"
        @click="store.systemTab = s.name"
      >
        🖥 {{ s.name }}<span v-if="s.name === group?.currentSystem" class="run-dot">●</span>
      </button>
    </div>

    <!-- 右键菜单 -->
    <ResourceContextMenu
      v-if="menu && group"
      :x="menu.x"
      :y="menu.y"
      :resource="group.resources.find((r) => r.id === menu!.resourceId)!"
      :has-clipboard="!!store.clipboard"
      @close="menu = null"
      @action="onMenuAction"
    />
    <!-- Link/Unlink 弹窗 -->
    <LinkModal v-if="linkModal" :mode="linkModal.mode" :resource-id="linkModal.resourceId" @close="linkModal = null" />
    <!-- 新建资源向导 -->
    <AddResourceModal v-if="showAddResource && group" :group-id="group.id" @close="showAddResource = false" />
  </div>
</template>

<style scoped>
.topo {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-bottom: 1px solid #e3e7eb;
  background: #fbfcfd;
  flex-wrap: wrap;
}
.title {
  font-size: 12.5px;
  color: #2f6cb5;
  font-weight: 600;
}
.running {
  font-size: 11.5px;
  color: #2e7d32;
  background: #e8f5e9;
  padding: 2px 8px;
  border-radius: 8px;
}
.flex1 {
  flex: 1;
}
.btn.mini {
  padding: 2px 8px;
  font-size: 11.5px;
}
.mini-select {
  border: 1px solid #b8bfc7;
  border-radius: 3px;
  font-size: 11.5px;
  padding: 2px 4px;
}
.vsep {
  width: 1px;
  height: 16px;
  background: #d8dde2;
  margin: 0 2px;
}
.canvas {
  flex: 1;
  min-height: 0;
  position: relative;
}
.empty-guide {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  pointer-events: none; /* 不挡画布拖拽 */
}
.empty-guide .btn {
  pointer-events: auto;
}
.eg-title {
  font-size: 15px;
  font-weight: 700;
  color: #3a5a3a;
}
.eg-steps {
  font-size: 12.5px;
  color: #6b7f6b;
  line-height: 1.9;
  text-align: center;
}
.systabs {
  display: flex;
  gap: 2px;
  border-top: 1px solid #e3e7eb;
  background: #f3f5f7;
  padding: 4px 10px;
}
.systabs button {
  border: 1px solid transparent;
  background: none;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  color: #55606b;
}
.systabs button.active {
  background: #fff;
  border-color: #d8dde2;
  color: #2f6cb5;
  font-weight: 600;
}
.systabs button.running {
  color: #2e7d32;
}
.run-dot {
  color: #2e9e44;
  font-size: 9px;
  margin-left: 3px;
  animation: runblink 1.6s ease-in-out infinite;
}
@keyframes runblink {
  50% {
    opacity: 0.35;
  }
}
</style>

<!-- 画布内部元素样式（X6 SVG 命名空间，需非 scoped） -->
<style>
/* Windows 版风格：图标光晕表达状态（icon 已是 <image>，filter 对其同样生效） */
.x6-node image.glow-green {
  filter: drop-shadow(0 0 3px rgba(46, 158, 68, 0.85));
}
.x6-node image.glow-red {
  filter: drop-shadow(0 0 3px rgba(214, 58, 47, 0.9));
}
.x6-node image.glow-amber {
  animation: glow-amber 1.1s ease-in-out infinite;
}
@keyframes glow-amber {
  50% {
    filter: drop-shadow(0 0 6px rgba(230, 162, 60, 1));
  }
}
/* 状态跃迁闪烁 */
.x6-node image.vcs-blink {
  animation: vcs-blink 0.3s ease 3;
}
@keyframes vcs-blink {
  50% {
    filter: drop-shadow(0 0 8px currentColor);
  }
}
/* 依赖边流动（编排中） */
path.vcs-flow {
  stroke-dasharray: 7 5;
  animation: vcs-dash 0.45s linear infinite;
}
@keyframes vcs-dash {
  to {
    stroke-dashoffset: -24;
  }
}
/* 节点状态色过渡 */
.x6-node circle {
  transition: fill 0.4s ease;
}
.x6-node text {
  transition: fill 0.4s ease;
}
/* 节点拖拽光标 */
.x6-node {
  cursor: move;
}
</style>
