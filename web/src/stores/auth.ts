/**
 * 文件：src/stores/auth.ts
 * 用途：演示级登录态（D2 决策）+ 角色权限（P2-3）
 *       Launch Console 时弹出 localhost:port 登录框，校验通过后记录身份与角色；
 *       角色经 X-VCS-Role 请求头随请求传递，Observer 只读 / Operator 可编排 / Administrator 全权
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { defineStore } from 'pinia'

/** 角色清单 */
export const ROLES = ['Administrator', 'Operator', 'Observer'] as const
export type Role = (typeof ROLES)[number]

export const useAuthStore = defineStore({
  id: 'auth',
  state: () => ({
    /** clusterId → 登录用户名 */
    authMap: JSON.parse(sessionStorage.getItem('vcs_auth') ?? '{}') as Record<number, string>,
    /** 当前角色（演示级全局角色），随请求头 X-VCS-Role 传递 */
    role: (sessionStorage.getItem('vcs_role') as Role) || 'Administrator',
  }),
  actions: {
    /** 是否已登录某集群 */
    isLoggedIn(clusterId: number): boolean {
      return !!this.authMap[clusterId]
    },
    /** 取登录身份（缺省空串） */
    userOf(clusterId: number): string {
      return this.authMap[clusterId] ?? ''
    },
    /** 管理员（建删集群/类型/导入导出/回滚） */
    isAdmin(): boolean {
      return this.role === 'Administrator'
    },
    /** 可编排（引擎动作/属性保存/剧本/心跳） */
    canOperate(): boolean {
      return this.role === 'Administrator' || this.role === 'Operator'
    },
    /**
     * 演示级登录校验：用户名 admin / 密码任意非空 / 角色三选一
     * @returns 成功 true；失败返回错误文案
     */
    login(clusterId: number, username: string, password: string, role: Role = 'Administrator'): true | string {
      if (username !== 'admin') return '用户名必须为 admin（模拟器演示账号）'
      if (!password) return '密码不能为空（演示环境任意密码均可）'
      this.authMap[clusterId] = username
      sessionStorage.setItem('vcs_auth', JSON.stringify(this.authMap))
      this.role = role
      sessionStorage.setItem('vcs_role', role)
      return true
    },
  },
})
