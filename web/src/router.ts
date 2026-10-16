/**
 * 文件：src/router.ts
 * 用途：路由 —— / 集群管理面板；/explorer/:clusterId 拓扑浏览器
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'panel', component: () => import('./views/ClusterPanel.vue') },
    {
      path: '/explorer/:clusterId',
      name: 'explorer',
      component: () => import('./views/Explorer.vue'),
      props: true,
    },
    {
      path: '/console/:clusterId',
      name: 'console',
      component: () => import('./views/ConsoleView.vue'),
      props: true,
    },
    { path: '/monitor', name: 'monitor', component: () => import('./views/MonitorView.vue') },
    { path: '/global', name: 'global', component: () => import('./views/GlobalView.vue') },
    { path: '/real', name: 'real', component: () => import('./views/RealConsoleView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
