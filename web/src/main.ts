/**
 * 文件：src/main.ts
 * 用途：前端入口 —— 装配 Pinia / Router / 全局样式 / 全局错误上报（P2 可观测性）
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './styles/global.css'

const app = createApp(App)
app.use(createPinia()).use(router)

// ---------- 全局错误上报：window.onerror + 未处理 Promise 拒绝 + Vue 渲染错误 ----------
function report(level: 'error' | 'warn', message: string, stack?: string) {
  // 防上报风暴：单会话最多 20 条
  const count = Number(sessionStorage.getItem('vcs_err_n') || '0')
  if (count >= 20) return
  sessionStorage.setItem('vcs_err_n', String(count + 1))
  fetch('/api/client-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message: message.slice(0, 500), url: location.href, stack }),
  }).catch(() => {})
}

window.addEventListener('error', (e) => report('error', e.message, e.error?.stack))
window.addEventListener('unhandledrejection', (e) => report('error', `unhandledRejection: ${e.reason}`, String((e as PromiseRejectionEvent).reason)))
app.config.errorHandler = (err, _inst, info) => {
  report('error', `Vue: ${String(err)} (${info})`, (err as Error)?.stack)
}

app.mount('#app')
