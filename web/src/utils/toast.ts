/**
 * 文件：src/utils/toast.ts
 * 用途：轻量 Toast 通知（无 UI 库依赖，事件驱动挂载于 App.vue）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { reactive } from 'vue'

export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

/** 全局响应式 toast 列表（App.vue 渲染） */
export const toasts = reactive<ToastItem[]>([])
let seq = 0

/**
 * 弹出一条通知
 * @param text 文案
 * @param kind 类型（默认 info）
 */
export function toast(text: string, kind: ToastItem['kind'] = 'info'): void {
  const id = ++seq
  toasts.push({ id, text, kind })
  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === id)
    if (idx >= 0) toasts.splice(idx, 1)
  }, 3600)
}

/** 快捷错误通知 */
export const toastError = (text: string) => toast(text, 'error')
/** 快捷成功通知 */
export const toastSuccess = (text: string) => toast(text, 'success')
