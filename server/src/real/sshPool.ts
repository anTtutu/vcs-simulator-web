/**
 * 文件：src/real/sshPool.ts
 * 用途：真实服务器连接池（真实模式）——SSH 连接真实 VCS 节点，
 *       监控真实集群状态（hagrp -state 等）与下发操作命令
 *       ⚠️ 真实命令直接作用于真实集群：默认白名单前缀（ha 系列 / gabconfig / lltstat / hasys），
 *          变更类命令（hastop/hagrp -offline 等）由前端二次确认 + VCS_REAL_ALLOW_ANY 可放开
 * 作者：Anttu
 * 日期：2026-10-16
 */
import { Client, type ClientChannel } from 'ssh2'

/** 连接档案（密码/私钥仅存内存，不落盘；重启需重连） */
export interface RealConnection {
  id: string
  host: string
  port: number
  username: string
  client: Client
  createdAt: number
  lastUsedAt: number
}

/** 命令执行结果 */
export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

/** 默认命令白名单前缀（真实模式安全收口） */
const ALLOW_PREFIX = ['hastart', 'hastop', 'hagrp', 'hares', 'hasys', 'haconf', 'gabconfig', 'lltstat', 'amfstat', 'vxprint']

/** 白名单是否放开（VCS_REAL_ALLOW_ANY=1 时允许任意命令，风险自担） */
function allowAny(): boolean {
  return process.env.VCS_REAL_ALLOW_ANY === '1'
}

/** 命令是否在白名单内 */
export function commandAllowed(command: string): boolean {
  if (allowAny()) return true
  const cmd = command.trim()
  return ALLOW_PREFIX.some((p) => cmd === p || cmd.startsWith(p + ' '))
}

export const REAL_ALLOW_PREFIX = ALLOW_PREFIX

/** 连接池（模块级单例） */
const pool = new Map<string, RealConnection>()
let seq = 0

/**
 * 建立真实 SSH 连接并测试可用性
 * @returns 连接档案（含 id）
 */
export function connectReal(opts: {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  timeoutMs?: number
}): Promise<RealConnection> {
  const id = `rc_${Date.now()}_${++seq}`
  const client = new Client()
  const conn: RealConnection = {
    id,
    host: opts.host,
    port: opts.port ?? 22,
    username: opts.username,
    client,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end()
      reject(new Error(`SSH 连接超时（${opts.timeoutMs ?? 8000}ms）：${opts.host}`))
    }, opts.timeoutMs ?? 8000)
    client
      .on('ready', () => {
        clearTimeout(timer)
        pool.set(id, conn)
        resolve(conn)
      })
      .on('error', (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`SSH 连接失败：${err.message}`))
      })
      .connect({
        host: opts.host,
        port: conn.port,
        username: opts.username,
        password: opts.password,
        privateKey: opts.privateKey,
        readyTimeout: opts.timeoutMs ?? 8000,
        keepaliveInterval: 10_000,
      })
  })
}

/** 取已建立连接 */
export function getRealConnection(id: string): RealConnection | undefined {
  return pool.get(id)
}

/** 连接列表摘要 */
export function listRealConnections(): { id: string; host: string; port: number; username: string; createdAt: number }[] {
  return [...pool.values()].map(({ id, host, port, username, createdAt }) => ({ id, host, port, username, createdAt }))
}

/** 断开连接 */
export function disconnectReal(id: string): boolean {
  const conn = pool.get(id)
  if (!conn) return false
  conn.client.end()
  pool.delete(id)
  return true
}

/** 在指定连接上执行命令（shell 通道，5~30s 超时） */
export function execReal(id: string, command: string, timeoutMs = 15_000): Promise<ExecResult> {
  const conn = pool.get(id)
  if (!conn) return Promise.reject(new Error('连接不存在或已断开'))
  conn.lastUsedAt = Date.now()
  return new Promise((resolve, reject) => {
    conn.client.exec(command, (err: Error | undefined, stream: ClientChannel) => {
      if (err) return reject(err)
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error(`命令执行超时（${timeoutMs}ms）`))
      }, timeoutMs)
      stream.on('data', (d: Buffer) => (stdout += d.toString()))
      stream.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
      stream.on('close', (code: number | null) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code })
      })
    })
  })
}
