# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式（完整决策记录见 `docs/01-需求分析与设计报告.md` §8）。

## [0.1.0] - 2026-10-16（开源首版）

### 模拟核心
- 集群/节点/服务组/资源四级对象，25 个内置 Demo 集群（经典 Oracle 双机、NFS、VVR/SRDF 容灾对、19c 多租户、MySQL/Nginx/Kafka/Redis/ES/MongoDB 集群化服务）
- 仿真引擎：依赖序波浪编排、Offline Prop、故障注入（持续故障+后代连带）、Critical failover（遍历 SystemList 后冻结等人工）、probe 周期监控、心跳断链脑裂冻结（AUTODISABLED）
- MonScript 四形态探活：JS 沙箱 / `shell:` / `powershell:` / `http(s)://` / JSON 多平台块；解释器与超时全配置化（probe.config.json）
- AutoStartList 自动上线、Verify Configuration（环检测/必填校验）

### 类型与设计器
- **37 种**内置资源类型（经典+新版 Oracle 全家桶、主流数据库/中间件/Web/缓存/消息/文件服务），自定义类型二开（CRUD+引用保护+导入匹配）
- AntV X6 拓扑设计器：Fluent 3D 图标、自由拖拽（坐标持久化）、系统视图切换、Auto Arrange、PNG 导出、main.cf/types.cf 导入导出（往返无损）

### 教学与可观测
- 演练剧本（基础上线/failover/存储级联/脑裂/站点容灾，叙事字幕流）
- `ha*` 命令控制台（SSH 式连续输入、↑↓ 历史、Tab 补全）
- 配置快照（LCS diff 对比/回滚）、分级日志按天落盘（server/error/event 三文件）、前端错误上报
- Monitor 监控总览、Global View 跨集群容灾（复制链路+主站灾难演练）
- 真实模式 🛰：SSH 连接真实 VCS 节点，白名单命令监控与操作（凭据仅内存）

### 角色
- Administrator / Operator / Observer 三级权限（演示级，随请求头传递）

[未发布]: 云原生批次（K8s 控制面/Ingress/ArgoCD 等）讨论中，见设计报告 §7。
