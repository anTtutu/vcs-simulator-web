<!--
  文件：src/components/PropertiesPanel.vue
  用途：属性视图 + 编辑（Windows 版 Properties View 完整还原）
        · Type Specific Attributes：按类型 schema 动态表单，铅笔进入编辑态，保存批量提交
        · Common Attributes：Enabled / Critical 即时切换
        · Overridden Attributes：per-system 覆盖行编辑（新增/删除）
  作者：Anttu
  日期：2026-10-15
-->
<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useExplorerStore } from '../stores/explorer'
import { api } from '../api/client'
import type { ProbeExample } from '../api/types'
import { toastError, toastSuccess } from '../utils/toast'

const store = useExplorerStore()
const res = computed(() => store.selectedResource)

/** 编辑态：true 时表单可写，底部出现 保存/取消 */
const editing = ref(false)
const draft = reactive<Record<string, string>>({})
const draftOverrides = reactive<{ systemId: number; key: string; value: string }[]>([])

/** 探测脚本示例 + 试跑结果（MonScript 编辑辅助） */
const examples = ref<ProbeExample[]>([])
const scriptResult = ref<string>('')
api.probeExamples().then((x) => (examples.value = x)).catch(() => {})

/** 进入编辑：拷贝当前值 */
function startEdit() {
  if (!res.value) return
  Object.keys(draft).forEach((k) => delete draft[k])
  Object.assign(draft, res.value.attrs)
  draftOverrides.splice(0, draftOverrides.length, ...res.value.overrides.map((o) => ({ ...o })))
  editing.value = true
  store.autoEditOverrides = false
}
function cancelEdit() {
  editing.value = false
  store.autoEditOverrides = false
}

/** 保存：整体提交全局属性 + 覆盖行 */
async function save() {
  if (!res.value) return
  try {
    await store.saveAttrs(res.value.id, { ...draft }, draftOverrides.filter((o) => o.key))
    editing.value = false
    toastSuccess('属性已保存')
  } catch (e) {
    toastError((e as Error).message)
  }
}

/** 试跑 MonScript（不落库不触发引擎） */
async function testScript() {
  if (!res.value) return
  scriptResult.value = ''
  try {
    const r = await api.testScript(res.value.id, draft['MonScript'] ?? '')
    scriptResult.value = r.ok ? `判定：${r.verdict}${r.raw ? `（返回 ${r.raw}）` : ''}` : `脚本错误：${r.error}`
  } catch (e) {
    scriptResult.value = `试跑失败：${(e as Error).message}`
  }
}

/** 应用示例脚本到 MonScript 输入框 */
function applyExample(code: string) {
  draft['MonScript'] = code
}

/** 切换资源/离开编辑态时复位 */
watch(() => res.value?.id, () => (editing.value = false))

/** 右键 Override Attributes → 自动进入编辑态 */
watch(
  () => store.autoEditOverrides,
  (v) => {
    if (v && res.value && !editing.value) startEdit()
  },
)

/** 新增覆盖行 */
function addOverride() {
  if (!store.tree) return
  const sysId = store.tree.systems[0]?.id
  draftOverrides.push({ systemId: sysId ?? 0, key: '', value: '' })
}

/** schema 键集合（覆盖行 key 提示） */
const schemaKeys = computed(() => res.value?.schema.map((s) => s.key) ?? [])
/** 系统列表 */
const systems = computed(() => store.tree?.systems ?? [])
</script>

<template>
  <div class="props">
    <template v-if="res">
      <div class="bar">
        <span class="title">Properties View: {{ res.name }}</span>
        <span class="type-badge">{{ res.typeCode }}</span>
        <span class="flex1"></span>
        <button v-if="!editing" class="btn mini" @click="startEdit">✏️ Show all attributes</button>
      </div>

      <div class="scroll">
        <!-- 类型特定属性 -->
        <div class="section">
          <div class="sec-title">➤ Type Specific Attributes</div>
          <table class="attrs">
            <thead>
              <tr>
                <th style="width: 26%">Attribute</th>
                <th style="width: 58%">Value</th>
                <th style="width: 16%">Edit / Help</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in res.schema" :key="s.key">
                <td class="k">• {{ s.key }}<span v-if="s.required" class="req">*</span><div class="lbl">{{ s.label }}</div></td>
                <td>
                  <input
                    v-if="editing"
                    v-model="draft[s.key]"
                    class="cell-input"
                    :type="s.type === 'number' ? 'number' : 'text'"
                    :placeholder="s.default ? `默认 ${s.default}` : ''"
                  />
                  <span v-else>{{ res.attrs[s.key] === '' || res.attrs[s.key] === undefined ? '（空）' : res.attrs[s.key] }}</span>
                </td>
                <td class="muted">{{ editing ? '✏️' : '✏️ ❓' }}</td>
              </tr>
              <!-- schema 外的自定义属性（如种子数据的 RDFSite） -->
              <tr v-for="(v, k) in res.attrs" :key="'x-' + k" v-show="!res.schema.some((s) => s.key === k)">
                <td class="k">• {{ k }}<div class="lbl">自定义属性</div></td>
                <td>
                  <input v-if="editing" v-model="draft[k]" class="cell-input" />
                  <span v-else>{{ v === '' ? '（空）' : v }}</span>
                </td>
                <td class="muted">✏️</td>
              </tr>
              <!-- MonScript 编辑辅助：示例 + 试跑（引擎探测真实执行该脚本） -->
              <tr v-if="editing && ('MonScript' in draft)">
                <td class="k">• MonScript 试跑</td>
                <td colspan="2">
                  <div class="script-bar">
                    <select class="cell-input short" @change="applyExample(($event.target as HTMLSelectElement).value)">
                      <option value="">插入示例…</option>
                      <option v-for="ex in examples" :key="ex.code" :value="ex.code">{{ ex.title }}</option>
                    </select>
                    <button class="btn mini" @click="testScript">🧪 试跑</button>
                    <span class="script-result" v-if="scriptResult">{{ scriptResult }}</span>
                  </div>
                  <div class="script-hint">沙箱规则：入参 attrs/state/random；返回含 FAULT 即判故障；禁止循环/IO。引擎 probe 周期与右键 Probe 均会真实执行。</div>
                </td>
              </tr>
              <tr v-if="!res.schema.length && !Object.keys(res.attrs).length">
                <td colspan="3" class="muted">该资源暂无属性</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 通用属性 -->
        <div class="section">
          <div class="sec-title">➤ Common Attributes</div>
          <table class="attrs">
            <tbody>
              <tr>
                <td class="k" style="width: 26%">• Enabled</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" :checked="res.enabled" @change="store.setFlags(res.id, { enabled: ($event.target as HTMLInputElement).checked }).catch(toastError)" />
                    {{ res.enabled ? 'TRUE' : 'FALSE' }}（引擎是否编排/监控）
                  </label>
                </td>
              </tr>
              <tr>
                <td class="k">• Critical</td>
                <td>
                  <label class="switch">
                    <input type="checkbox" :checked="res.critical" @change="store.setFlags(res.id, { critical: ($event.target as HTMLInputElement).checked }).catch(toastError)" />
                    {{ res.critical ? 'TRUE' : 'FALSE' }}（故障时触发整组 failover）
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 覆盖属性（per-system） -->
        <div class="section">
          <div class="sec-title">➤ Overridden Attributes（按系统覆盖）</div>
          <table class="attrs" v-if="editing">
            <thead>
              <tr>
                <th style="width: 22%">System</th>
                <th style="width: 34%">Attribute</th>
                <th style="width: 34%">Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(o, i) in draftOverrides" :key="i">
                <td>
                  <select v-model.number="o.systemId" class="cell-input">
                    <option v-for="s in systems" :key="s.id" :value="s.id">{{ s.name }}</option>
                  </select>
                </td>
                <td>
                  <input v-model="o.key" class="cell-input" list="schema-keys" placeholder="属性名" />
                </td>
                <td><input v-model="o.value" class="cell-input" placeholder="覆盖值" /></td>
                <td><button class="btn mini danger" @click="draftOverrides.splice(i, 1)">✕</button></td>
              </tr>
              <tr v-if="!draftOverrides.length">
                <td colspan="4" class="muted">暂无覆盖（如 sys1 与 sys2 的 NIC Device 不同时使用）</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="muted pad">
            {{ res.overrides.length ? res.overrides.map((o) => `${systems.find((s) => s.id === o.systemId)?.name ?? o.systemId}:${o.key}=${o.value}`).join('；') : '无覆盖记录' }}
          </div>
          <datalist id="schema-keys">
            <option v-for="k in schemaKeys" :key="k" :value="k" />
          </datalist>
        </div>
      </div>

      <!-- 编辑态操作条 -->
      <div class="edit-bar" v-if="editing">
        <button class="btn" @click="addOverride" v-if="draftOverrides.length || systems.length">＋ 覆盖行</button>
        <span class="flex1"></span>
        <button class="btn" @click="cancelEdit">Cancel</button>
        <button class="btn primary" @click="save">💾 保存</button>
      </div>
    </template>

    <div v-else class="placeholder">在左侧资源树或拓扑图中点击一个资源查看属性</div>
  </div>
</template>

<style scoped>
.props {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid #e3e7eb;
  background: #fbfcfd;
}
.title {
  font-size: 12.5px;
  color: #2f6cb5;
  font-weight: 600;
}
.type-badge {
  font-size: 10.5px;
  background: #eaf2fd;
  color: #2f6cb5;
  border-radius: 3px;
  padding: 1px 6px;
}
.flex1 {
  flex: 1;
}
.btn.mini {
  padding: 2px 8px;
  font-size: 11.5px;
}
.scroll {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
}
.section {
  margin-bottom: 18px;
}
.sec-title {
  color: #2f6cb5;
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 12.5px;
}
.attrs {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.attrs th {
  text-align: left;
  background: #f3f5f7;
  padding: 6px 10px;
  border: 1px solid #e3e7eb;
  color: #55606b;
}
.attrs td {
  padding: 6px 10px;
  border: 1px solid #eef1f3;
  vertical-align: middle;
}
.attrs .k {
  color: #24313f;
  font-weight: 600;
}
.req {
  color: #d63a2f;
  margin-left: 2px;
}
.lbl {
  font-weight: 400;
  color: #98a1aa;
  font-size: 11px;
}
.cell-input {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #b8bfc7;
  border-radius: 3px;
  font-size: 12px;
}
.cell-input:focus {
  outline: none;
  border-color: #2f6cb5;
}
.muted {
  color: #98a1aa;
}
.script-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.script-bar .short {
  width: 300px;
}
.script-result {
  font-size: 11.5px;
  color: #2f6cb5;
}
.script-hint {
  margin-top: 4px;
  font-size: 11px;
  color: #98a1aa;
}
.pad {
  padding: 6px 0;
}
.switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}
.edit-bar {
  display: flex;
  gap: 8px;
  padding: 9px 16px;
  border-top: 1px solid #e3e7eb;
  background: #f7f9fa;
}
.placeholder {
  margin: auto;
  color: #98a1aa;
}
</style>
