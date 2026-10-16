# Agent 二开指南（自定义资源类型）

> 适用版本：v2.3+ ｜ 作者：Anttu｜ 2026-10-15
> 场景：真实 VCS 里官方 Agent 覆盖不到的组件（如 Oracle 12C 后的 ASM、MySQL、自研中间件），通过**自定义 Agent 类型**接入模拟器——与真实环境"二开 Agent"的思路一一对应。

## 一、二开入口

集群管理面板 → **🧩 类型管理**（需 Administrator）→「＋ 新建自定义类型」。
内置 15 种类型只读；自定义类型可编辑/删除（被资源引用时删除会被拒绝）。

## 二、设计一个 Agent 类型的四步法

### 第 1 步：定 code 与命名前缀

- `code` 是类型的身份证：**资源命名惯例 = `<code>_<业务前缀>`**（如 `MySQL_prod`、`OracleASM_dg1`）。
- main.cf 导入时按「code 前缀 + 别名」识别资源类型，因此 code 要短、有辨识度。
- 需要别名时（像 `Netlsnr ← LSNR`、`DiskGroup ← DG`）在 `server/src/cf/importer.ts` 的 `TYPE_PREFIXES` 中登记一行（内置类型）；自定义类型直接用 code 本身匹配。

### 第 2 步：设计属性 schema

属性 = 动态表单的字段，每个属性含：`key`（属性名，对应 main.cf 里的属性名）、`label`（中文说明）、`type`（string/number/boolean）、`required`（必填）、`default`（默认值）。

设计要点：
1. **必填项 = 资源无法启动就谈不上成立的那些参数**（如 MySQL 的安装目录与 my.cnf）；
2. 监控参数统一叫 `MonScript`（string）——**引擎会真实执行**，按值前缀自动分流四种形态（probe 周期与右键 Probe 同路径）：
   - **JS 沙箱**（默认）：入参 `attrs/state/random`，返回含 `FAULT` 判故障；黑名单禁循环/IO/宿主访问（`while/for(/setInterval/require/process/globalThis/import/eval/Function/fetch`）；脚本错误视为健康 + WARN
   - **`shell:<命令>`**：本机脚本探活（Linux/Unix→/bin/sh，Windows→cmd.exe；解释器按集群平台映射，UI「⚙探测设置」可配），退出码 0=健康——还原 Application agent 的 MonitorProgram 探活
   - **`powershell:<脚本>`**：Windows 服务/事件探活（win=powershell.exe / 其他=pwsh）
   - **`http(s)://<url>`**：REST 探活，POST `{attrs,state}`，2xx=健康（响应可带 `{verdict}`）、非 2xx/超时=故障——ES/Kafka/MinIO 等自带健康端点的服务首选
   - 解释器/超时/ENV 前缀全部可配：`probe.config.json`（或 `VCS_PROBE_CONFIG`），改完免重启；`GET/PUT /api/probe-config`
   - ⚠️ 脚本类型为**受限 JavaScript 表达式**（`new Function` 求值），**不是 shell**——模拟器无 OS 上下文且避免执行任意宿主脚本的安全风险；
   - 能力清单：入参 `attrs`/`state`/`random`；返回含 `FAULT` 判故障；支持三元/比较/String/Number/数组方法；黑名单 `while`/`for(`/`setInterval`/`setTimeout`/`require`/`process`/`globalThis`/`import`/`eval`/`Function`（禁循环/IO/宿主访问）；脚本错误视为健康 + WARN；
   - 常用写法：

     ```js
     return attrs.Listener ? 'ONLINE' : 'FAULTED'                       // 属性判空
     return attrs.Port === '3306' ? 'ONLINE' : 'FAULTED'                // 端口匹配
     return random < 0.1 ? 'FAULTED' : 'ONLINE'                         // 概率偶发故障
     return state === 'ONLINE' && random < 0.05 ? 'FAULTED' : 'ONLINE'  // 状态+概率叠加
     ```
3. 密码类属性照常声明（模拟器明文存储，仅教学用）。

### 第 3 步：选图标

图标字段为 emoji（左侧树 16px 小图）；拓扑大图与向导卡片使用 `web/src/assets/3d-icons/` 的 Fluent 3D 图标，在 `web/src/utils/icons.ts` 的 `ICON_URLS` 中登记 `code → svg` 映射；未登记的自定义类型自动使用橙色立方体兜底图。

### 第 4 步：验证闭环

1. Explorer →「＋ 服务组」建组 →「＋ 资源」向导里应能看到新类型卡片与动态表单；
2. 属性面板保存后 → Explorer 顶栏「⤓ main.cf」检查生成的属性块与类型定义（⤓ types.cf 同步导出）；
3. 把导出的 main.cf 再「⤒ Import main.cf」回去——资源类型应按前缀被正确识别（导入结果 warnings 为空即闭环）。

## 三、官方范例 1：OracleASM（Oracle 12C 后 Grid/ASM 场景）

> 背景：Oracle 12C 后磁盘组由 Grid Infrastructure/ASM 管理，原 Oracle Agent 不再直管，二开 `OracleASM` 类型专管 ASM 磁盘组（别名前缀 `ASM_` 亦被导入识别）。

| 属性 | 必填 | 说明 |
|------|------|------|
| ASMInstance | ✔ | ASM 实例名（通常 `+ASM1`/`+ASM2`） |
| DiskGroup | ✔ | ASM 磁盘组名（如 DATA/FGA） |
| OracleHome | ✔ | GI Home（Grid Infrastructure 安装目录） |
| Owner | | 属主（通常 grid） |
| Pfile | | ASM 实例参数文件 |
| MonScript | | 自定义监控脚本 |

main.cf 产出示例：

```
    OracleASM_dg1 (
        ASMInstance = +ASM1
        DiskGroup = DATA
        OracleHome = /u01/app/19.0.0/grid
        Owner = grid
        )
    Mount_data requires OracleASM_dg1
```

## 四、官方范例 2：MySQL

| 属性 | 必填 | 说明 |
|------|------|------|
| MySQLHome | ✔ | MySQL 安装目录 |
| MyCnf | ✔ | my.cnf 路径 |
| Port | | 监听端口（默认 3306） |
| Socket | | Socket 文件路径 |
| User | | 启动用户（mysql） |
| DataDir | | 数据目录 |
| MonScript | | 自定义监控脚本（如 `return attrs.Port === '3306' ? 'ONLINE' : 'FAULTED'`；也可填 `http://127.0.0.1:3306/health` 走 REST 探活） |

MonScript 试跑：属性编辑态 → MonScript 行「🧪 试跑」，不落库不触发引擎；保存后引擎周期监控真实执行。

## 五、新版 Oracle 覆盖矩阵（ASM 演进 × 多租户，10g → 23ai）

**结论先行**：ASM 从 10g 诞生延续到 23ai 仍是 Grid Infrastructure 的存储基石，**没有退役**；变化的是形态（ASMLib → ASMFD、单点 ASM → Flex ASM）和上层架构（11gR2 GI 整合、12c CDB/PDB 多租户、23ai 免费默认）。模拟器按版本分层覆盖如下：

| 版本 | 年份/支持 | ASM 形态 | 多租户 | VCS HA 要点 | 模拟器覆盖 |
|------|------|------|------|------|------|
| 9i/10g | 2001/2003 | **ASM 诞生**（10gR1），Linux 配 ASMLib | 无（单实例） | Oracle Agent 直管实例+监听 | Oracle 类型；SOL_ORACLE（8.1.5 Home 即 Windows 模拟器年代） |
| 11gR2 | 2009 | **GI 整合**（ASM+Clusterware 合并安装）；**SCAN**；ACFS 问世 | 无 | VCS 与 GI 共存，需框架协调 | OracleASM 属性 `OracleHome` 填 GI Home；存储=`ASMLib` |
| **12cR1/R2** | 2013/2017 | **Flex ASM**（实例解耦）；**ASMFD** 过滤驱动取代 ASMLib；Flex Cluster(Hub/Leaf) | **CDB/PDB 诞生**（12.1 单租户免费） | CDB 实例级 HA；ASM 用 ASMFD | OracleASM：`StorageLib=ASMFD` + `FlexAsm=TRUE`（见下方配置对照）；OraclePDB 起步 |
| 18c | 2018（云优先，短支持） | 同 12cR2 | PDB hot-clone / relocate | 同 12c | 同 12c（属性一致） |
| **19c** | 2019，**LTS（支持至 2027/2030）** | Flex ASM/ASMFD 成熟 | PDB 上限 4096，企业落地主流 | InfoScale 7.x+ 完整支持 | **ORACLE_19C_HA 案例**（CDB→PDB→LSNR 全链） |
| 21c | 2021（仅云，短支持） | 无破坏性变化 | **多租户全面免费** | 同 19c | 同 19c |
| **23ai** | 2024，**LTS** | 延续 Flex ASM/ASMFD | 免费多租户默认 + AI Vector Search | 同 19c | 同 19c |

### 12c 前后 ASM 配置对照（OracleASM 类型属性写法）

```text
// 11g 及以前（ASMLib 磁盘发现）
ASM_dg1 (
    ASMInstance = +ASM1
    DiskGroup   = DATA
    OracleHome  = /u01/app/11.2.0/grid
    StorageLib  = ASMLib
    )

// 12cR1 起（ASMFD 过滤驱动 + Flex ASM，19c/23ai 推荐写法）
ASM_dg1 (
    ASMInstance = +ASM1
    DiskGroup   = DATA
    OracleHome  = /u01/app/19.0.0/grid
    StorageLib  = ASMFD
    FlexAsm     = TRUE
    Owner       = grid
    )
```

### 19c/23ai 多租户拓扑（ORACLE_19C_HA 案例）

```
LSNR_19c ← PDB_plug1 ← ORA_CDB19c(CDB) ← Mount_orcl19c ← Vol_orcl19c ← DG_orcl19c
                    ↖ IP_orcl19c ← NIC_orcl19c
（ASM_orcl19c 独立资源演示 Flex ASM/ASMFD 属性，不挂依赖链）
```

要点：
- **CDB 实例**用 Oracle 类型承载（Sid=ORCLCDB），failover 单元仍是 CDB 整体；
- **PDB 可插拔库**作为独立资源（OraclePDB 类型，open/close 语义，`OpenMode = READ WRITE`），依赖 CDB——教学上可演示"PDB 单独故障/重开"；
- **RAC 超出演化范围**：RAC 是 Oracle 自有集群方案（多实例共享库），与 VCS 管理的单实例 HA 模型不同（InfoScale Enterprise 另有 RAC 支持），模拟器不模拟多实例共享库；
- 选型建议：新项目直接按 **19c/23ai 行**配置（ASMFD + Flex ASM + PDB），老库迁移时按源版本行对号入座。

## 六、API 速查（脚本化二开）

| 动作 | 接口 |
|------|------|
| 新建类型 | `POST /api/resource-types` `{code,label,category,icon,attrs:[...]}`（Admin） |
| 修改 | `PUT /api/resource-types/:tid`（Admin，builtin 只读） |
| 删除 | `DELETE /api/resource-types/:tid`（被引用 409） |
| 试跑探测脚本 | `POST /api/resources/:rid/testscript` `{script}` |
| 探测脚本示例 | `GET /api/probe-examples` |

## 七、边界说明

- 自定义类型的**引擎行为与内置一致**（同一状态机/编排/failover 规则）；差异只在属性与命名——这正是"二开 Agent"的本质：类型换壳，HA 语义复用。
- 模拟沙箱不能执行真实 OS 脚本之外的任意宿主命令；`shell:`/`powershell:` 形态在本机真实执行（教学场景专用，部署者自担风险）
- **服务自带集群方案的边界**：MinIO（纠删码分布式）、Kafka（KRaft）、MongoDB（副本集）、Ceph 等自带 HA 的服务，VCS 通常只管**单机部署**（进程+数据盘+探活）或作对照教学；其集群内部自愈由产品自管，模拟器不模拟其内部机制。对应类型：MinIO（单机模式）等
