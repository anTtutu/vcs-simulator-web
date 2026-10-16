<!--
  文件：src/components/TypeManagerModal.vue
  用途：自定义 Agent 类型管理（P2-2）—— 内置类型只读展示；自定义类型可增改删
        自定义类型的属性 schema 与内置同构，可直接用于向导/导入匹配（按 code 前缀）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../api/client'
import { useExplorerStore } from '../stores/explorer'
import type { ResourceType } from '../api/types'
import { toastError, toastSuccess } from '../utils/toast'

const emit = defineEmits<{ close: [] }>()
const store = useExplorerStore()

const list = ref<ResourceType[]>([])
/** 面板：list=类型管理 / guide=二开教程 */
const tab = ref<'list' | 'guide'>('list')
const editing = ref<{ id: number | null; code: string; label: string; category: string; icon: string; attrs: { key: string; label?: string; type?: string; required?: boolean; default?: string }[] } | null>(null)
const draft = reactive<{ code: string; label: string; category: string; icon: string; attrs: { key: string; label?: string; type?: string; required?: boolean; default?: string }[] }>({
  code: '',
  label: '',
  category: 'Custom',
  icon: '🧩',
  attrs: [{ key: '', label: '', type: 'string', required: false }],
})

onMounted(refresh)

async function refresh() {
  try {
    list.value = await api.listResourceTypes()
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 开始新建/编辑 */
function startCreate() {
  editing.value = { id: null, code: draft.code, label: draft.label, category: draft.category, icon: draft.icon, attrs: draft.attrs.map((a) => ({ ...a })) }
  draft.code = ''
  draft.label = ''
}
function startEdit(t: ResourceType) {
  editing.value = {
    id: t.id,
    code: t.code,
    label: t.label,
    category: t.category,
    icon: t.icon,
    attrs: (JSON.parse(t.attr_schema) as { key: string; label?: string; type?: string; required?: boolean }[]).map((a) => ({ ...a })),
  }
}

/** 保存（新建/修改） */
async function save() {
  if (!editing.value) return
  const attrs = editing.value.attrs.filter((a) => a.key.trim())
  if (!attrs.length) {
    toastError('至少一个属性')
    return
  }
  try {
    if (editing.value.id === null) {
      await api.createType({ code: editing.value.code, label: editing.value.label, category: editing.value.category, icon: editing.value.icon, attrs })
    } else {
      await api.updateType(editing.value.id, { label: editing.value.label, category: editing.value.category, icon: editing.value.icon, attrs })
    }
    toastSuccess('类型已保存')
    editing.value = null
    await refresh()
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 删除自定义类型 */
async function remove(t: ResourceType) {
  if (!confirm(`删除自定义类型 ${t.code}？（被资源引用时会被拒绝）`)) return
  try {
    await api.deleteType(t.id)
    toastSuccess('类型已删除')
    await refresh()
  } catch (e) {
    toastError((e as Error).message)
  }
}
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-title">
        <span :class="{ tab: true, active: tab === 'list' }" @click="tab = 'list'">🧩 类型管理</span>
        <span :class="{ tab: true, active: tab === 'guide' }" @click="tab = 'guide'">📖 Agent 二开教程</span>
        <span class="cnt">内置 {{ list.filter((t) => t.builtin).length }} · 自定义 {{ list.filter((t) => !t.builtin).length }}</span>
        <button class="btn mini" style="float: right" @click="emit('close')">✕</button>
      </div>

      <!-- 二开教程面板 -->
      <div v-if="tab === 'guide'" class="body guide">
        <div class="g-sec">① 定 code 与命名前缀</div>
        <p>资源命名惯例 <b>`&lt;code&gt;_业务前缀`</b>（如 MySQL_prod）。main.cf 导入按 code 前缀识别类型；需要别名（如 DiskGroup←DG）在 <code>server/src/cf/importer.ts → TYPE_PREFIXES</code> 登记。</p>
        <div class="g-sec">② 设计属性 schema</div>
        <p>属性 = 动态表单字段（key/label/type/required/default）。必填项 = 资源无法启动就不成立的参数；监控参数统一叫 <b>MonScript</b>——引擎 probe 会真实执行，返回含 FAULT 即判故障（沙箱入参 attrs/state/random，禁循环/IO，异常视为健康）。</p>
        <div class="g-sec">③ 选图标</div>
        <p>树内 emoji 随类型字段；拓扑大图在 <code>web/src/assets/3d-icons/</code> 放 Fluent 3D SVG 并在 <code>utils/icons.ts → ICON_URLS</code> 登记；未登记自动用橙色立方体兜底。</p>
        <div class="g-sec">④ 验证闭环</div>
        <p>向导可见新类型动态表单 → 保存属性 → ⤓ main.cf 检查属性块与 types.cf → 再导入回灌 warnings 为空即闭环。</p>
        <div class="g-sec">官方范例 1：OracleASM（12C 后 Grid/ASM 场景，别名 ASM_）</div>
        <pre class="g-code">OracleASM_dg1 (
    ASMInstance = +ASM1
    DiskGroup = DATA
    OracleHome = /u01/app/19.0.0/grid
    Owner = grid
    )
Mount_data requires OracleASM_dg1</pre>
        <div class="g-sec">官方范例 2：MySQL</div>
        <pre class="g-code">MySQL_prod (
    MySQLHome = /usr/local/mysql
    MyCnf = /etc/my.cnf
    Port = 3306
    User = mysql
    )
MonScript 示例：return attrs.Port === '3306' ? 'ONLINE' : 'FAULTED'</pre>
        <p class="g-more">完整版：<code>docs/02-Agent二开指南.md</code></p>
      </div>

      <!-- 类型列表面板 -->
      <div v-else class="body">
        <!-- 编辑/新建表单 -->
        <div v-if="editing" class="editor">
          <div class="e-row">
            <span>code</span>
            <input v-model="editing.code" :disabled="editing.id !== null" placeholder="MyAgent" />
            <span>名称</span>
            <input v-model="editing.label" placeholder="显示名" />
            <span>图标</span>
            <input v-model="editing.icon" style="width: 60px" />
          </div>
          <div class="e-attrs">
            <div class="e-attr" v-for="(a, i) in editing.attrs" :key="i">
              <input v-model="a.key" placeholder="属性名" style="width: 130px" />
              <input v-model="a.label" placeholder="中文说明" style="width: 130px" />
              <select v-model="a.type" style="width: 80px">
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
              <label class="req-box"><input type="checkbox" v-model="a.required" /> 必填</label>
              <button class="btn mini danger" @click="editing.attrs.splice(i, 1)">✕</button>
            </div>
            <button class="btn mini" @click="editing.attrs.push({ key: '', label: '', type: 'string', required: false })">＋ 属性</button>
          </div>
          <div class="e-ops">
            <button class="btn" @click="editing = null">取消</button>
            <button class="btn primary" @click="save">保存</button>
          </div>
        </div>

        <!-- 列表 -->
        <table class="tlist">
          <thead>
            <tr>
              <th style="width: 46px"></th>
              <th style="width: 130px">code</th>
              <th>名称 / 属性</th>
              <th style="width: 90px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in list" :key="t.id">
              <td>{{ t.icon }}</td>
              <td>
                {{ t.code }}
                <span class="badge" :class="{ custom: !t.builtin }">{{ t.builtin ? '内置' : '自定义' }}</span>
              </td>
              <td>
                <div>{{ t.label }} <span class="cat">· {{ t.category }}</span></div>
                <div class="attrs-line">{{ (JSON.parse(t.attr_schema) as { key: string }[]).map((a) => a.key).join('、') || '无属性' }}</div>
              </td>
              <td>
                <template v-if="!t.builtin">
                  <button class="btn mini" @click="startEdit(t)">编辑</button>
                  <button class="btn mini danger" :disabled="!store.isAdmin" @click="remove(t)">删</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="!store.isAdmin || !!editing" title="需要 Administrator" @click="startCreate">＋ 新建自定义类型</button>
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
.modal {
  background: #fff;
  border-radius: 6px;
  width: 760px;
  max-width: 96vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
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
.tab {
  cursor: pointer;
  padding: 3px 10px;
  border-radius: 3px;
  color: #7b848d;
  margin-right: 6px;
}
.tab.active {
  background: #2f6cb5;
  color: #fff;
}
.cnt {
  font-weight: 400;
  color: #98a1aa;
  font-size: 11px;
  margin-left: 8px;
}
.guide {
  font-size: 12.5px;
  line-height: 1.7;
  color: #3a4550;
}
.g-sec {
  color: #2f6cb5;
  font-weight: 700;
  margin: 12px 0 4px;
}
.guide p {
  margin: 0 0 6px;
}
.guide code {
  background: #eef1f3;
  border-radius: 2px;
  padding: 0 4px;
  font-size: 11.5px;
}
.g-code {
  background: #10151a;
  color: #b9e28c;
  border-radius: 4px;
  padding: 10px 12px;
  font-family: Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  overflow: auto;
  margin: 4px 0 8px;
}
.g-more {
  color: #98a1aa;
  font-size: 11.5px;
}
.body {
  padding: 12px 16px;
  overflow: auto;
  flex: 1;
}
.editor {
  border: 1px solid #d8e2f0;
  background: #f6f9fe;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.e-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #55606b;
}
.e-row input {
  padding: 4px 8px;
  border: 1px solid #b8bfc7;
  border-radius: 3px;
  font-size: 12.5px;
}
.e-attr {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}
.e-attr input,
.e-attr select {
  padding: 3px 6px;
  border: 1px solid #b8bfc7;
  border-radius: 3px;
  font-size: 12px;
}
.req-box {
  font-size: 11.5px;
  display: flex;
  gap: 3px;
  align-items: center;
}
.e-ops {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.tlist {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tlist th {
  text-align: left;
  background: #f3f5f7;
  border: 1px solid #e3e7eb;
  padding: 5px 8px;
}
.tlist td {
  border: 1px solid #eef1f3;
  padding: 5px 8px;
  vertical-align: top;
}
.badge {
  font-size: 10px;
  border-radius: 2px;
  padding: 0 4px;
  background: #eef1f3;
  color: #7b848d;
}
.badge.custom {
  background: #e8f5e9;
  color: #2e7d32;
}
.cat {
  color: #98a1aa;
}
.attrs-line {
  color: #98a1aa;
  font-size: 11px;
}
.actions {
  padding: 10px 16px;
  border-top: 1px solid #e3e7eb;
}
</style>
