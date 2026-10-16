# VCS Simulator Web

> Web 版 Veritas Cluster Server 模拟器 —— 无需真实双机环境，在浏览器里学习/演示 VCS 高可用集群的完整语义。
> 复刻 Symantec/Veritas 官方 Windows 版 VCS Simulator 的核心能力，并补充现代 Web 交互与**真实模式**（SSH 接管真实集群）。

![License](https://img.shields.io/badge/license-MIT-green) ![Node](https://img.shields.io/badge/node-%E2%89%A520-blue) ![Tests](https://img.shields.io/badge/tests-70%2B-brightgreen)

## ✨ 功能

- **集群管理**：集群/节点/服务组/资源四级对象 CRUD，**25 个内置 Demo 集群**（经典 Oracle 双机、NFS、VVR/SRDF 容灾对、MySQL/Nginx/Kafka/Redis/ES/MongoDB 副本集、19c 多租户等场景），演示级登录与三角色权限（Administrator/Operator/Observer）
- **拓扑设计器**：AntV X6 画布，立体 3D 类型图标（**37 种** Microsoft Fluent Emoji，MIT）、自由拖拽（坐标持久化）、依赖连线（成环检测）、Auto Arrange 分层布局、系统视图切换（非运行节点灰显）、PNG 导出
- **仿真引擎**：依赖序波浪编排上线/下线、Offline Prop 优雅传播、**故障注入**（持续故障 + 后代连带）、**Critical failover**（遍历 SystemList 后冻结等人工）、probe 周期监控、心跳断链**脑裂冻结**（AUTODISABLED 语义）
- **MonScript 探活四形态**（引擎真实执行，按值前缀自动分流）：
  - JS 沙箱表达式（`attrs/state/random`）
  - **`shell:`** 本机脚本探活（Linux→/bin/sh、Windows→cmd.exe，退出码 0=健康，还原 Application MonitorProgram）
  - **`powershell:`** Windows 服务/事件探活
  - **`http(s)://`** REST 探活（POST `{attrs,state}`，2xx=健康，可返回 `{verdict}` 精确判定）
  - **JSON 多平台块**（`{"linux":"…","windows":"…"}`，按集群平台自动选择脚本）
  - 解释器/超时/ENV 前缀**全配置化**（`probe.config.json`，改完免重启）
- **属性与配置**：类型 schema 驱动动态表单、per-system 属性覆盖、**main.cf / types.cf 导入导出**（往返无损）、配置快照与 LCS 行级 diff 回滚
- **演练与教学**：演练剧本（字幕叙事流：基础上线/failover/存储级联/脑裂/站点容灾）、`ha*` 命令控制台（SSH 式连续输入、↑↓ 历史、Tab 补全、`haconf -dump`/`gabconfig -a` 脑裂分区输出）、事件日志（engine_A.log 观感 + 按天文件镜像）
- **真实模式** 🛰：SSH 连接**真实 VCS 节点**，聚合并展示真实集群状态（hasys/hagrp/hares/gabconfig/lltstat）、白名单内下发操作命令（变更类二次确认）——模拟教学与真实业务管理并存
- **可观测**：分级调试日志按天落盘（server/error/event 三文件）、请求日志、前端错误上报、监控总览卡片墙、Global View 跨集群容灾拓扑（复制链路 + 主站灾难演练）
- **Agent 二开**：🧩 类型管理（自定义类型 CRUD + 引用保护）+ 内置二开教程，内置 **37 种类型**（经典/新版 Oracle 全家桶、Nginx/Tomcat/WebLogic/HAProxy、MySQL/PostgreSQL/MongoDB/SQLServer、Redis/Memcached、Kafka(KRaft/ZK)/RabbitMQ/ActiveMQ、ES/Consul/etcd/Zookeeper、MinIO/Samba/NFS/DNS/DHCP、Prometheus/Jenkins/IIS/Varnish…）

## 🚀 快速开始

```bash
pnpm install          # 首次：放行 better-sqlite3/esbuild/ssh2 原生构建（见 pnpm-workspace.yaml allowBuilds）
pnpm dev:server       # 后端 http://localhost:3100（SQLite 落盘 server/data/）
pnpm dev:web          # 前端 http://localhost:5173（/api 代理 3100）
```

打开 `http://localhost:5173` → 选中 `SOL_ORACLE` → **Start Cluster** → **Launch Console**（admin/任意密码）→ 进入拓扑。

### 模拟模式 vs 真实模式

| | 模拟模式（默认） | 真实模式 🛰 |
|---|---|---|
| 目标 | 教学演示，本地 SQLite + 仿真引擎 | **真实 VCS 节点**（SSH 22，可自定义端口） |
| 操作 | 引擎编排 + 故障注入（可反复演练） | 白名单命令直接下发（`ha*`/`gabconfig`/`lltstat`，变更类二次确认） |
| 入口 | 集群面板 → Launch Console | 导航「🛰 真实模式」→ 填节点 IP/账号 |

⚠️ 真实模式命令直接作用于真实集群，请在测试环境使用；凭据仅存内存不落盘。

### Agent 二开（自定义资源类型）

面板「🧩 类型管理」支持自定义 Agent 类型（如官方未覆盖的 MySQL、OracleASM、各云原生组件），含属性 schema、**四形态探测**、main.cf/types.cf 导入导出全链路；弹窗内附「📖 Agent 二开教程」与新版 Oracle 覆盖矩阵。详见 [docs/02-Agent二开指南.md](docs/02-Agent二开指南.md)。

## 🧪 测试

```bash
pnpm test             # server(vitest, 引擎/cf 往返/CLI/剧本/日志/真实模式白名单等) + web(布局算法)
pnpm typecheck        # 服务端 tsc
```

## 🏗 架构

```
Vue3 + Vite + Pinia + AntV X6  ──REST/SSE──▶  Express
                                                ├─ SimulationEngine（状态机/编排/故障/failover，纯领域核心）
                                                ├─ cf parser/generator（main.cf ⇄ 领域模型）
                                                ├─ ScenarioRunner / CLI(ha*) / MonScript 四形态探活（可配解释器）
                                                ├─ Real SSH Pool（真实模式，命令白名单）
                                                └─ better-sqlite3（引擎为唯一状态权威，SSE 广播变更）
```

- 引擎是唯一状态权威：所有变更 = 事务落库 + SSE 事件广播，前端动画按事件序列回放
- 领域核心无 IO 依赖，状态机/传播/failover 规则 100% 单测覆盖
- 探测解释器/超时可配：`probe.config.json`（或环境变量 `VCS_PROBE_CONFIG`），改完免重启
- 详细设计：[docs/01-需求分析与设计报告.md](docs/01-需求分析与设计报告.md)

## ⚠️ 免责声明

本项目为**教学与演示用途**的模拟器，不实现任何真实 VCS/Veritas 内核行为，不与 Veritas 产品交互；请勿用于生产环境。**真实模式**会向目标服务器下发真实命令，请仅在测试环境使用并自行评估风险。Veritas、VCS 及相关商标归其所有者所有。

## 📄 License

[MIT](LICENSE) © Anttu
图标：[Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji)（MIT）
