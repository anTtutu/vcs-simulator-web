/**
 * 文件：src/db/seed/types.seed.ts
 * 用途：资源类型（组件模板）种子 —— 13 种 VCS 内置 Agent 类型，含属性 schema
 *       其中 Netlsnr 的属性与 Windows 版截图（resourcesProperties.jpg）逐项一致
 * 作者：Anttu
 * 日期：2026-10-15
 */
import type { AttrSchemaItem, ResourceType } from '../../domain/types.js'

/** 类型定义便捷构造器 */
interface TypeSeed {
  code: string
  label: string
  category: string
  icon: string
  monitor_interval?: number
  attr_schema: AttrSchemaItem[]
}

/** 属性条目快捷构造（string 类型） */
const s = (key: string, label: string, required = false, def?: string): AttrSchemaItem => ({
  key,
  label,
  type: 'string',
  required,
  default: def,
})
/** 属性条目快捷构造（number 类型） */
const n = (key: string, label: string, def?: string): AttrSchemaItem => ({
  key,
  label,
  type: 'number',
  default: def,
})

/** 13 种内置类型：Storage(DiskGroup/Volume/Mount/RVG) Network(NIC/IP) Database(Oracle/Netlsnr) Process(Process/Application) FileShare(NFS/Share) Generic(Proxy) */
export const RESOURCE_TYPE_SEEDS: TypeSeed[] = [
  {
    code: 'DiskGroup',
    label: '磁盘组 (VxVM)',
    category: 'Storage',
    icon: '💾',
    attr_schema: [s('DiskGroupName', '磁盘组名', true), n('StartVolumes', '是否启动卷', '1')],
  },
  {
    code: 'Volume',
    label: '卷 (VxVM)',
    category: 'Storage',
    icon: '📀',
    attr_schema: [s('Volume', '卷名', true), s('DiskGroup', '所属磁盘组', true)],
  },
  {
    code: 'Mount',
    label: '文件系统挂载',
    category: 'Storage',
    icon: '📁',
    monitor_interval: 120,
    attr_schema: [
      s('MountPoint', '挂载点', true),
      s('BlockDevice', '块设备', true),
      s('FSType', '文件系统类型', false, 'vxfs'),
      s('MountOpt', '挂载选项', false, 'rw'),
    ],
  },
  {
    code: 'RVG',
    label: '卷复制组 (VVR)',
    category: 'Storage',
    icon: '🔄',
    attr_schema: [
      s('RVGName', 'RVG 名称', true),
      s('DiskGroup', '所属磁盘组', true),
      s('Mode', '复制角色', false, 'Primary'),
    ],
  },
  {
    code: 'NIC',
    label: '网卡',
    category: 'Network',
    icon: '🔌',
    attr_schema: [s('Device', '网卡设备名', true)],
  },
  {
    code: 'IP',
    label: 'IP 地址',
    category: 'Network',
    icon: '🌐',
    attr_schema: [
      s('Address', 'IP 地址', true),
      s('NetMask', '子网掩码', true),
      s('Device', '承载网卡', true),
      s('Options', '额外选项'),
    ],
  },
  {
    code: 'Oracle',
    label: 'Oracle 实例',
    category: 'Database',
    icon: '🗄️',
    attr_schema: [
      s('Sid', '实例 SID', true),
      s('Owner', '属主', true),
      s('Home', 'ORACLE_HOME', true),
      s('Pfile', '参数文件'),
      s('User', '连接用户'),
      s('Pword', '连接密码'),
      s('EnvFile', '环境文件'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    // 属性清单与 Windows 版 Properties View 截图完全一致
    code: 'Netlsnr',
    label: 'Oracle 监听器',
    category: 'Database',
    icon: '🎧',
    attr_schema: [
      s('Owner', 'Owner 属主'),
      s('Home', 'Home 主目录'),
      s('TnsAdmin', 'TnsAdmin tnsnames 目录'),
      s('Listener', 'Listener 监听器名'),
      s('EnvFile', 'EnvFile 环境文件'),
      s('MonScript', 'MonScript 监控脚本'),
      s('LsnrPwd', 'LsnrPwd 监听器密码'),
      s('Encoding', 'Encoding 字符集'),
    ],
  },
  {
    code: 'Process',
    label: '进程',
    category: 'Process',
    icon: '⚙️',
    attr_schema: [s('PathName', '可执行路径', true), s('Arguments', '启动参数'), s('User', '运行用户')],
  },
  {
    code: 'Application',
    label: '应用程序',
    category: 'Process',
    icon: '📦',
    attr_schema: [
      s('StartProgram', '启动脚本', true),
      s('StopProgram', '停止脚本'),
      s('MonitorProgram', '监控脚本'),
      s('User', '运行用户'),
    ],
  },
  {
    code: 'NFS',
    label: 'NFS 服务',
    category: 'FileShare',
    icon: '📤',
    attr_schema: [n('Nservers', 'nfsd 进程数', '10'), s('Protocol', '协议', false, 'UDP')],
  },
  {
    code: 'Share',
    label: '共享导出',
    category: 'FileShare',
    icon: '📂',
    attr_schema: [s('PathName', '共享路径', true), s('Options', '导出选项', false, 'rw')],
  },
  {
    code: 'Proxy',
    label: '代理引用',
    category: 'Generic',
    icon: '🔗',
    attr_schema: [s('TargetResName', '目标资源名', true)],
  },
  // ---- 二开示例类型（Agent 二次开发范本，见 docs/02-Agent二开指南.md）----
  {
    // Oracle ASM（12c~23ai 延续，形态演进：Flex ASM / ASMFD 过滤驱动取代 ASMLib / UDEV）
    code: 'OracleASM',
    label: 'Oracle ASM 磁盘组 (12c~23ai, Flex ASM)',
    category: 'Database',
    icon: '🧱',
    attr_schema: [
      s('ASMInstance', 'ASM 实例名 (+ASM1)', true),
      s('DiskGroup', 'ASM 磁盘组名', true),
      s('OracleHome', 'GI Home (Grid Infrastructure)', true),
      s('StorageLib', '磁盘发现方式', false, 'ASMFD'), // ASMFD|ASMLib|UDEV
      s('FlexAsm', 'Flex ASM 模式', false, 'TRUE'),
      s('Owner', '属主 (通常 grid)'),
      s('Pfile', 'ASM 实例参数文件'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    // Oracle 12c+ 多租户（19c LTS / 23ai）：CDB 实例由 Oracle 类型承载，
    // 可插拔数据库 PDB 作为独立资源管理（open/close 语义），依赖 CDB 实例
    code: 'OraclePDB',
    label: 'Oracle PDB 可插拔库 (19c/23ai)',
    category: 'Database',
    icon: '🧰',
    attr_schema: [
      s('PdbName', 'PDB 名称 (如 ORCLPDB1)', true),
      s('CdbInstance', '所属 CDB 实例资源名', true),
      s('OracleHome', 'ORACLE_HOME', true),
      s('OpenMode', '目标模式', false, 'READ WRITE'),
      s('Owner', '属主'),
      s('SqlPlus', 'sqlplus 连接串 (sys as sysdba)'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    // 用户场景：MySQL 无官方 Agent，二开 MySQL 类型支撑双机 MySQL HA
    code: 'MySQL',
    label: 'MySQL 实例',
    category: 'Database',
    icon: '🐬',
    attr_schema: [
      s('MySQLHome', 'MySQL 安装目录', true),
      s('MyCnf', 'my.cnf 配置文件路径', true),
      s('Port', '监听端口'),
      s('Socket', 'Socket 文件路径'),
      s('User', '启动用户 (如 mysql)'),
      s('DataDir', '数据目录'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  // ---- 常用服务模块（v2.4 补充，覆盖 Web/中间件/数据库/缓存/消息/文件服务 HA 场景）----
  {
    code: 'Nginx',
    label: 'Nginx Web 服务',
    category: 'Web',
    icon: '🟢',
    attr_schema: [
      s('ConfPath', 'nginx.conf 路径', true),
      n('ListenPort', '监听端口', '80'),
      s('ProcessName', '进程名', false, 'nginx'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Tomcat',
    label: 'Tomcat 中间件',
    category: 'Middleware',
    icon: '☕',
    attr_schema: [
      s('CatalinaHome', 'CATALINA_HOME', true),
      n('ListenPort', '监听端口', '8080'),
      s('JvmOpts', 'JVM 参数'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'PostgreSQL',
    label: 'PostgreSQL 数据库',
    category: 'Database',
    icon: '🐘',
    attr_schema: [
      s('PgHome', '安装目录', true),
      s('PgData', '数据目录 (PGDATA)', true),
      n('Port', '监听端口', '5432'),
      s('DbUser', '超级用户'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Redis',
    label: 'Redis 缓存',
    category: 'Cache',
    icon: '❄️',
    attr_schema: [
      s('RedisHome', '安装目录', true),
      s('ConfPath', 'redis.conf 路径', true),
      n('Port', '监听端口', '6379'),
      s('Password', 'requirepass 密码'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'RabbitMQ',
    label: 'RabbitMQ 消息队列',
    category: 'Messaging',
    icon: '🐰',
    attr_schema: [
      s('Home', '安装目录', true),
      s('NodeName', '节点名 (rabbit@host)', true),
      n('ListenPort', 'AMQP 端口', '5672'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Samba',
    label: 'Samba 文件共享',
    category: 'FileShare',
    icon: '🪟',
    attr_schema: [
      s('ShareName', '共享名', true),
      s('Path', '共享目录', true),
      s('ConfigFile', 'smb.conf 路径', false, '/etc/samba/smb.conf'),
      s('ValidUsers', '允许用户'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  // ---- 常用服务模块第二批（v2.7：监控/注册/CI/目录/DHCP 等）----
  {
    code: 'IIS',
    label: 'IIS Web 服务',
    category: 'Web',
    icon: '✨',
    attr_schema: [
      s('AppPoolName', '应用池名', true),
      s('SiteName', '站点名'),
      s('PhysicalPath', '站点物理路径'),
      n('Port', '监听端口', '80'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'DHCP',
    label: 'DHCP 地址分配',
    category: 'Network',
    icon: '🎫',
    attr_schema: [
      s('ConfigFile', 'dhcpd.conf 路径', true, '/etc/dhcp/dhcpd.conf'),
      s('Interface', '服务网卡'),
      s('RangeStart', '地址池起始'),
      s('RangeEnd', '地址池结束'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'OpenLDAP',
    label: 'OpenLDAP 目录服务',
    category: 'Directory',
    icon: '📖',
    attr_schema: [
      s('LdapHome', '安装目录', true),
      s('ConfPath', 'slapd.conf 路径', true),
      s('Suffix', '目录后缀 (dc=example,dc=com)', true),
      s('AdminDN', '管理员 DN'),
      n('Port', '监听端口', '389'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Jenkins',
    label: 'Jenkins CI',
    category: 'DevOps',
    icon: '🔧',
    attr_schema: [
      s('JenkinsHome', 'JENKINS_HOME', true),
      s('WarFile', 'jenkins.war 路径'),
      n('Port', '监听端口', '8080'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Etcd',
    label: 'etcd 分布式 KV',
    category: 'Middleware',
    icon: '🔑',
    attr_schema: [
      s('DataDir', '数据目录', true),
      n('ClientPort', '客户端端口', '2379'),
      n('PeerPort', '节点间端口', '2380'),
      s('ClusterToken', '集群令牌'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Zookeeper',
    label: 'Zookeeper 协调服务',
    category: 'Middleware',
    icon: '🦁',
    attr_schema: [
      s('ZkHome', '安装目录', true),
      s('DataDir', '数据目录 (dataDir)', true),
      n('ClientPort', '客户端端口', '2181'),
      n('PeerPort', '选举端口', '2888'),
      n('LeaderPort', 'Lead 端口', '3888'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    // 新版 Kafka（2.8+/3.x KRaft 模式免 ZK；老集群仍可 Zookeeper 模式）
    code: 'Kafka',
    label: 'Kafka Broker (KRaft/ZK)',
    category: 'Messaging',
    icon: '🚚',
    attr_schema: [
      s('KafkaHome', '安装目录', true),
      s('Mode', '运行模式', false, 'KRaft'),
      s('BrokerId', 'Broker ID'),
      n('Port', '监听端口', '9092'),
      n('ControllerPort', 'KRaft Controller 端口', '9093'),
      s('MonScript', '自定义监控脚本（TCP 探活可用 shell:nc -z 127.0.0.1 9092）'),
    ],
  },
  {
    code: 'MinIO',
    label: 'MinIO 对象存储 (单机模式)',
    category: 'Storage',
    icon: '🪣',
    attr_schema: [
      s('MinIOHome', '安装目录', true),
      s('DataDir', '数据目录', true),
      n('APIPort', 'API 端口', '9000'),
      n('ConsolePort', '控制台端口', '9001'),
      s('RootUser', 'Root 用户'),
      s('MonScript', '自定义监控脚本（可填 http://127.0.0.1:9000/minio/health/live）'),
    ],
  },
  {
    code: 'MongoDB',
    label: 'MongoDB 副本集成员',
    category: 'Database',
    icon: '🍃',
    attr_schema: [
      s('ConfPath', 'mongod.conf 路径', true),
      s('DataDir', '数据目录 (dbPath)', true),
      n('Port', '监听端口', '27017'),
      s('ReplSetName', '副本集名', false, 'rs0'),
      s('MonScript', '自定义监控脚本（如 shell:pgrep -x mongod）'),
    ],
  },
  {
    code: 'Prometheus',
    label: 'Prometheus 监控',
    category: 'DevOps',
    icon: '🔥',
    attr_schema: [
      s('ConfPath', 'prometheus.yml 路径', true, '/etc/prometheus/prometheus.yml'),
      s('DataDir', '数据目录'),
      n('Port', '监听端口', '9090'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Varnish',
    label: 'Varnish HTTP 缓存',
    category: 'Web',
    icon: '🖌️',
    attr_schema: [
      s('ConfPath', 'default.vcl 路径', true, '/etc/varnish/default.vcl'),
      n('ListenPort', '监听端口', '6081'),
      n('BackendPort', '后端端口'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Memcached',
    label: 'Memcached 缓存',
    category: 'Cache',
    icon: '⚡',
    attr_schema: [
      n('Port', '监听端口', '11211'),
      n('MaxMemory', '最大内存 (MB)', '64'),
      s('Options', '启动参数'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'Elasticsearch',
    label: 'Elasticsearch 集群节点',
    category: 'Search',
    icon: '🔭',
    attr_schema: [
      s('ConfPath', 'elasticsearch.yml 路径', true),
      s('DataDir', '数据目录', true),
      n('Port', 'HTTP 端口', '9200'),
      s('NodeRole', '节点角色', false, 'master,data'),
      s('ClusterName', '集群名'),
      s('MonScript', '自定义监控脚本（可填 http://127.0.0.1:9200/_cluster/health 探活）'),
    ],
  },
  {
    code: 'Consul',
    label: 'Consul 注册中心',
    category: 'Middleware',
    icon: '🧭',
    attr_schema: [
      s('ConfDir', '配置目录', true),
      s('DataDir', '数据目录'),
      n('Port', 'HTTP 端口', '8500'),
      s('ServerMode', 'Server 模式', false, 'TRUE'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
  {
    code: 'ActiveMQ',
    label: 'ActiveMQ 消息队列',
    category: 'Messaging',
    icon: '✉️',
    attr_schema: [
      s('ActiveHome', '安装目录', true),
      n('OpenWirePort', 'OpenWire 端口', '61616'),
      n('WebPort', 'Web 控制台端口', '8161'),
      s('MonScript', '自定义监控脚本'),
    ],
  },
]

/**
 * 将种子写入 resource_type 表（幂等：按 code upsert，覆盖内置定义）
 * @param db 数据库连接
 */
export function seedResourceTypes(db: import('better-sqlite3').Database): void {
  const upsert = db.prepare(`
    INSERT INTO resource_type (code, label, category, icon, monitor_interval, attr_schema, builtin)
    VALUES (@code, @label, @category, @icon, @monitor_interval, @attr_schema, 1)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label,
      category = excluded.category,
      icon = excluded.icon,
      monitor_interval = excluded.monitor_interval,
      attr_schema = excluded.attr_schema,
      builtin = 1
  `)
  const tx = db.transaction(() => {
    for (const t of RESOURCE_TYPE_SEEDS) {
      upsert.run({ ...t, monitor_interval: t.monitor_interval ?? 60, attr_schema: JSON.stringify(t.attr_schema) })
    }
  })
  tx()
}
