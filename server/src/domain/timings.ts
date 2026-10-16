/**
 * 文件：src/domain/timings.ts
 * 用途：模拟器编排节奏常量 —— 全部事件按此节奏经 SSE 推送，前端动画与之对齐
 *       （真实 VCS 的 60s 监控间隔在演示环境加速为秒级）
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 每个依赖层级的启动间隔（下层 ONLINE 后上一层再 STARTING，形成波浪点亮） */
export const LAYER_STEP_MS = 650
/** 单资源 STARTING → ONLINE 时长 */
export const RESOURCE_START_MS = 600
/** 单资源 STOPPING → OFFLINE 时长 */
export const RESOURCE_STOP_MS = 350
/** Critical 故障后触发 failover 前的决策延迟 */
export const FAILOVER_DELAY_MS = 900
/** failover 中关旧节点/起新节点之间的间隔 */
export const FAILOVER_GAP_MS = 500
/** 探测周期（演示档：真实为 60~120s） */
export const PROBE_INTERVAL_MS = 5000
