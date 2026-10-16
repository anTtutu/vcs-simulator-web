/**
 * 文件：src/db/seed/clusters.seed.ts
 * 用途：内置 Demo 集群种子 —— 照抄 Windows 版 18 个预置集群（设计报告 §2.8/D4）
 *       SOL_ORACLE 为截图主角的全量还原；其余按 VCS 典型拓扑构造（成对集群为容灾站）
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 种子资源定义 */
export interface SeedResource {
  name: string
  type: string // resource_type.code
  critical?: boolean
  attrs?: Record<string, string>
}
/** 种子服务组：links 为 [child, parent]（child requires parent） */
export interface SeedGroup {
  name: string
  systemList?: { name: string; priority: number }[]
  autostartList?: string[]
  resources: SeedResource[]
  links: [string, string][]
}
/** 种子集群 */
export interface SeedCluster {
  name: string
  platform: string
  systems?: string[]
  groups: SeedGroup[]
}
/** 快捷构造资源 */
const r = (name: string, type: string, attrs?: Record<string, string>, critical = false): SeedResource => ({
  name,
  type,
  critical,
  attrs,
})
/** 快捷构造组：默认 SystemList sys1=0,sys2=1 + AutoStart sys1 */
const g = (
  name: string,
  resources: SeedResource[],
  links: [string, string][],
  systems = ['sys1', 'sys2'],
): SeedGroup => ({
  name,
  systemList: systems.map((s, i) => ({ name: s, priority: i })),
  autostartList: [systems[0]],
  resources,
  links,
})

/**
 * Oracle 经典 8+1 层拓扑（截图 SOL_ORACLE 原样还原）：
 * LSNR ← ORA ← {IP←NIC, Mount×2 ← Vol×2 ← DG}
 */
function oracleGroup(suffix = '', rdf?: 'R1' | 'R2'): SeedGroup {
  const dgAttrs: Record<string, string> = { DiskGroupName: 'oraprod', StartVolumes: '1' }
  if (rdf) dgAttrs['RDFSite'] = rdf // SRDF 容灾对：R1=生产端 / R2=灾备端
  return g('ORA_PROD_Group', [
    r(`DG_oraprod${suffix}`, 'DiskGroup', dgAttrs),
    r(`Vol_oraprod_vol1${suffix}`, 'Volume', { Volume: 'vol1', DiskGroup: 'oraprod' }),
    r(`Vol_oraprod_vol2${suffix}`, 'Volume', { Volume: 'vol2', DiskGroup: 'oraprod' }),
    r(`Mount_oraprod_u01${suffix}`, 'Mount', {
      MountPoint: '/prod/u01',
      BlockDevice: '/dev/vx/dsk/oraprod/u01',
      FSType: 'vxfs',
    }),
    r(`Mount_oraprod_u02${suffix}`, 'Mount', {
      MountPoint: '/prod/u02',
      BlockDevice: '/dev/vx/dsk/oraprod/u02',
      FSType: 'vxfs',
    }),
    r(`NIC_oraprod${suffix}`, 'NIC', { Device: 'hme0' }),
    r(`IP_oraprod${suffix}`, 'IP', { Address: '10.10.10.11', NetMask: '255.255.255.0', Device: 'hme0' }, true),
    r(`ORA_oraprod${suffix}`, 'Oracle', {
      Sid: 'oraprod',
      Owner: 'oraprod',
      Home: '/prod/u01/oracle/product/8.1.5',
      Pfile: '/prod/u01/oracle/product/8.1.5/dbs/initoraprod.ora',
      User: 'oracle',
    }, true),
    // Netlsnr 属性与 Windows 版属性视图截图逐项一致
    r(`LSNR_oraprod_lsnr${suffix}`, 'Netlsnr', {
      Owner: 'oraprod',
      Home: '/prod/u01/oracle/product/8.1.5',
      TnsAdmin: '/prod/u01/oracle/network/admin',
      Listener: 'LISTENER_PROD',
      MonScript: './bin/Netlsnr/LsnrTest.pl',
    }),
  ], [
    [`Vol_oraprod_vol1${suffix}`, `DG_oraprod${suffix}`],
    [`Vol_oraprod_vol2${suffix}`, `DG_oraprod${suffix}`],
    [`Mount_oraprod_u01${suffix}`, `Vol_oraprod_vol1${suffix}`],
    [`Mount_oraprod_u02${suffix}`, `Vol_oraprod_vol2${suffix}`],
    [`IP_oraprod${suffix}`, `NIC_oraprod${suffix}`],
    [`ORA_oraprod${suffix}`, `IP_oraprod${suffix}`],
    [`ORA_oraprod${suffix}`, `Mount_oraprod_u01${suffix}`],
    [`ORA_oraprod${suffix}`, `Mount_oraprod_u02${suffix}`],
    [`LSNR_oraprod_lsnr${suffix}`, `ORA_oraprod${suffix}`],
  ])
}

/** NFS 服务组模板（AIX/HP/Linux 通用）：Share requires {NFS, Mount} */
function nfsGroup(tag: string, device: string, mountPoint: string): SeedGroup {
  return g(`NFS_SRV_${tag.toUpperCase()}`, [
    r(`DG_nfs_${tag}`, 'DiskGroup', { DiskGroupName: `nfs${tag}`, StartVolumes: '1' }),
    r(`Vol_nfs_${tag}`, 'Volume', { Volume: `vol${tag}`, DiskGroup: `nfs${tag}` }),
    r(`Mount_nfs_${tag}`, 'Mount', { MountPoint: mountPoint, BlockDevice: `/dev/vx/dsk/nfs${tag}/vol${tag}` }),
    r(`NFS_nfs_${tag}`, 'NFS', { Nservers: '10' }),
    r(`Share_nfs_${tag}`, 'Share', { PathName: mountPoint, Options: 'rw' }),
    r(`IP_nfs_${tag}`, 'IP', { Address: `10.20.${tag.charCodeAt(0) % 100}.30`, NetMask: '255.255.255.0', Device: device }),
    r(`NIC_nfs_${tag}`, 'NIC', { Device: device }),
  ], [
    [`Vol_nfs_${tag}`, `DG_nfs_${tag}`],
    [`Mount_nfs_${tag}`, `Vol_nfs_${tag}`],
    [`Share_nfs_${tag}`, `Mount_nfs_${tag}`],
    [`Share_nfs_${tag}`, `NFS_nfs_${tag}`],
    [`IP_nfs_${tag}`, `NIC_nfs_${tag}`],
  ])
}

/** 通用「应用 HA」组：App ← {Mount, IP←NIC} ← Vol ← DG（Acme/NPLUS1/DB2 通用骨架） */
function appGroup(
  groupName: string,
  tag: string,
  device: string,
  mountPoint: string,
  startProgram: string,
  processType: 'Process' | 'Application' = 'Application',
): SeedGroup {
  const appRes =
    processType === 'Process'
      ? r(`Proc_${tag}`, 'Process', { PathName: startProgram }, true)
      : r(`App_${tag}`, 'Application', { StartProgram: startProgram, StopProgram: `${startProgram} stop` }, true)
  return g(groupName, [
    r(`DG_${tag}`, 'DiskGroup', { DiskGroupName: `dg${tag}`, StartVolumes: '1' }),
    r(`Vol_${tag}`, 'Volume', { Volume: `vol${tag}`, DiskGroup: `dg${tag}` }),
    r(`Mount_${tag}`, 'Mount', { MountPoint: mountPoint, BlockDevice: `/dev/vx/dsk/dg${tag}/vol${tag}` }),
    r(`IP_${tag}`, 'IP', { Address: `10.30.${tag.length}.40`, NetMask: '255.255.255.0', Device: device }),
    r(`NIC_${tag}`, 'NIC', { Device: device }),
    appRes,
  ], [
    [`Vol_${tag}`, `DG_${tag}`],
    [`Mount_${tag}`, `Vol_${tag}`],
    [`IP_${tag}`, `NIC_${tag}`],
    [appRes.name, `Mount_${tag}`],
    [appRes.name, `IP_${tag}`],
  ])
}

/** VVR 卷复制组（Windows 容灾对通用）：RVG ← Vol ← DG，App ← {Mount, IP←NIC} */
function vvrGroup(groupName: string, tag: string, mode: 'Primary' | 'Secondary', app: string): SeedGroup {
  return g(groupName, [
    r(`DG_${tag}`, 'DiskGroup', { DiskGroupName: `dg${tag}`, StartVolumes: '1' }),
    r(`Vol_${tag}`, 'Volume', { Volume: `vol${tag}`, DiskGroup: `dg${tag}` }),
    r(`RVG_${tag}`, 'RVG', { RVGName: `rvg${tag}`, DiskGroup: `dg${tag}`, Mode: mode }),
    r(`Mount_${tag}`, 'Mount', { MountPoint: `S:\\${tag}`, BlockDevice: `\\Device\\HarddiskDmVolumes\\dg${tag}vol${tag}` }),
    r(`IP_${tag}`, 'IP', { Address: `10.40.${tag.length}.50`, NetMask: '255.255.255.0', Device: 'LAN0' }),
    r(`NIC_${tag}`, 'NIC', { Device: 'LAN0' }),
    r(`App_${tag}`, 'Application', { StartProgram: app, StopProgram: `net stop ${app}` }, true),
  ], [
    [`Vol_${tag}`, `DG_${tag}`],
    [`RVG_${tag}`, `Vol_${tag}`],
    [`Mount_${tag}`, `Vol_${tag}`],
    [`IP_${tag}`, `NIC_${tag}`],
    [`App_${tag}`, `Mount_${tag}`],
    [`App_${tag}`, `IP_${tag}`],
  ])
}

/** MySQL 双机 HA 案例组（实战二开 MySQL 类型 + VIP） */
function mysqlHaGroup(): SeedGroup {
  return g('MYSQL_SG', [
    r('DG_mysql', 'DiskGroup', { DiskGroupName: 'mysql', StartVolumes: '1' }),
    r('Vol_mysql', 'Volume', { Volume: 'vol_mysql', DiskGroup: 'mysql' }),
    r('Mount_mysql', 'Mount', { MountPoint: '/var/lib/mysql', BlockDevice: '/dev/vx/dsk/mysql/vol_mysql' }),
    r('MySQL_mysql', 'MySQL', {
      MySQLHome: '/usr/local/mysql',
      MyCnf: '/etc/my.cnf',
      Port: '3306',
      Socket: '/tmp/mysql.sock',
      User: 'mysql',
      DataDir: '/var/lib/mysql',
    }, true),
    r('IP_mysql', 'IP', { Address: '10.50.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_mysql', 'NIC', { Device: 'eth0' }),
  ], [
    ['Vol_mysql', 'DG_mysql'],
    ['Mount_mysql', 'Vol_mysql'],
    ['IP_mysql', 'NIC_mysql'],
    ['MySQL_mysql', 'Mount_mysql'],
    ['MySQL_mysql', 'IP_mysql'],
  ])
}

/** Nginx+Tomcat 双应用 Web 链案例组：Tomcat(反代后端) 与 Nginx(前端) 分层依赖 */
function webNginxGroup(): SeedGroup {
  return g('WEB_SG', [
    r('DG_ngx', 'DiskGroup', { DiskGroupName: 'web', StartVolumes: '1' }),
    r('Vol_ngx', 'Volume', { Volume: 'vol_web', DiskGroup: 'web' }),
    r('Mount_ngx', 'Mount', { MountPoint: '/usr/share/nginx', BlockDevice: '/dev/vx/dsk/web/vol_web' }),
    r('Tomcat_app', 'Tomcat', { CatalinaHome: '/opt/tomcat', ListenPort: '8080' }, true),
    r('Nginx_ngx', 'Nginx', { ConfPath: '/etc/nginx/nginx.conf', ListenPort: '80', ProcessName: 'nginx' }, true),
    r('IP_ngx', 'IP', { Address: '10.60.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_ngx', 'NIC', { Device: 'eth0' }),
  ], [
    ['Vol_ngx', 'DG_ngx'],
    ['Mount_ngx', 'Vol_ngx'],
    ['IP_ngx', 'NIC_ngx'],
    ['Tomcat_app', 'Mount_ngx'],
    ['Tomcat_app', 'IP_ngx'],
    ['Nginx_ngx', 'Tomcat_app'],
  ])
}

/** Oracle 19c/23ai 多租户案例组（CDB→PDB→LSNR，Flex ASM 存储，展示新版 Oracle HA 覆盖） */
function oracle19cGroup(): SeedGroup {
  return g('ORA19C_SG', [
    r('DG_orcl19c', 'DiskGroup', { DiskGroupName: 'orcl19c', StartVolumes: '1', RDFSite: '' }),
    r('Vol_orcl19c', 'Volume', { Volume: 'vol_orcl', DiskGroup: 'orcl19c' }),
    r('ASM_orcl19c', 'OracleASM', {
      ASMInstance: '+ASM1',
      DiskGroup: 'DATA_FLEX',
      OracleHome: '/u01/app/19.0.0/grid',
      StorageLib: 'ASMFD',
      FlexAsm: 'TRUE',
      Owner: 'grid',
    }),
    r('Mount_orcl19c', 'Mount', { MountPoint: '/u01/app/oracle/oradata', BlockDevice: '/dev/vx/dsk/orcl19c/vol_orcl' }),
    r('ORA_CDB19c', 'Oracle', {
      Sid: 'ORCLCDB',
      Owner: 'oracle',
      Home: '/u01/app/oracle/product/19.0.0/dbhome_1',
      Pfile: '/u01/app/oracle/product/19.0.0/dbhome_1/dbs/initORCLCDB.ora',
    }, true),
    r('PDB_plug1', 'OraclePDB', {
      PdbName: 'ORCLPDB1',
      CdbInstance: 'ORA_CDB19c',
      OracleHome: '/u01/app/oracle/product/19.0.0/dbhome_1',
      OpenMode: 'READ WRITE',
      Owner: 'oracle',
    }, true),
    r('IP_orcl19c', 'IP', { Address: '10.70.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_orcl19c', 'NIC', { Device: 'eth0' }),
    r('LSNR_19c', 'Netlsnr', {
      Owner: 'oracle',
      Home: '/u01/app/oracle/product/19.0.0/dbhome_1',
      TnsAdmin: '/u01/app/oracle/product/19.0.0/dbhome_1/network/admin',
      Listener: 'LISTENER_19C',
    }),
  ], [
    ['Vol_orcl19c', 'DG_orcl19c'],
    ['Mount_orcl19c', 'Vol_orcl19c'],
    ['ORA_CDB19c', 'Mount_orcl19c'],
    ['ORA_CDB19c', 'IP_orcl19c'],
    ['IP_orcl19c', 'NIC_orcl19c'],
    ['PDB_plug1', 'ORA_CDB19c'],
    ['LSNR_19c', 'PDB_plug1'],
  ])
}

/** Redis 哨兵主从案例组（主/从/哨兵三资源 + VIP，展示集群化服务在 VCS 中的管理方式） */
function redisClusterGroup(): SeedGroup {
  return g('REDIS_SG', [
    r('DG_redis', 'DiskGroup', { DiskGroupName: 'redis', StartVolumes: '1' }),
    r('Vol_redis', 'Volume', { Volume: 'vol_redis', DiskGroup: 'redis' }),
    r('Mount_redis', 'Mount', { MountPoint: '/etc/redis', BlockDevice: '/dev/vx/dsk/redis/vol_redis' }),
    r('Redis_master', 'Redis', {
      RedisHome: '/usr/local/redis',
      ConfPath: '/etc/redis/redis_6379.conf',
      Port: '6379',
      Password: 'redispass',
      ClusterMode: 'sentinel',
    }, true),
    r('Redis_replica', 'Redis', {
      RedisHome: '/usr/local/redis',
      ConfPath: '/etc/redis/redis_6380.conf',
      Port: '6380',
      ClusterMode: 'sentinel',
    }),
    r('Redis_sentinel', 'Redis', {
      RedisHome: '/usr/local/redis',
      ConfPath: '/etc/redis/sentinel.conf',
      Port: '26379',
      ClusterMode: 'sentinel',
    }),
    r('IP_redis', 'IP', { Address: '10.80.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_redis', 'NIC', { Device: 'eth0' }),
  ], [
    ['Vol_redis', 'DG_redis'],
    ['Mount_redis', 'Vol_redis'],
    ['Redis_master', 'Mount_redis'],
    ['Redis_replica', 'Mount_redis'],
    ['Redis_master', 'IP_redis'],
    ['Redis_sentinel', 'Redis_master'],
  ])
}

/** Elasticsearch 集群节点案例组（数据盘 + http 探活实战：MonScript 直填 _cluster/health） */
function esHaGroup(): SeedGroup {
  return g('ES_SG', [
    r('DG_es', 'DiskGroup', { DiskGroupName: 'esdata', StartVolumes: '1' }),
    r('Vol_es', 'Volume', { Volume: 'vol_es', DiskGroup: 'esdata' }),
    r('Mount_es', 'Mount', { MountPoint: '/var/lib/elasticsearch', BlockDevice: '/dev/vx/dsk/esdata/vol_es' }),
    r('ES_node1', 'Elasticsearch', {
      ConfPath: '/etc/elasticsearch/elasticsearch.yml',
      DataDir: '/var/lib/elasticsearch',
      Port: '9200',
      NodeRole: 'master,data',
      ClusterName: 'prod-es',
      MonScript: 'http://127.0.0.1:9200/_cluster/health',
    }, true),
    r('IP_es', 'IP', { Address: '10.90.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_es', 'NIC', { Device: 'eth0' }),
  ], [
    ['Vol_es', 'DG_es'],
    ['Mount_es', 'Vol_es'],
    ['ES_node1', 'Mount_es'],
    ['ES_node1', 'IP_es'],
    ['IP_es', 'NIC_es'],
  ])
}

/** Kafka 案例组（**KRaft 模式免 ZK**，对齐 3.x 新版；MonScript 用 shell:nc 做 TCP 探活实战） */
function kafkaHaGroup(): SeedGroup {
  return g('KAFKA_SG', [
    r('DG_kfk', 'DiskGroup', { DiskGroupName: 'kafka', StartVolumes: '1' }),
    r('Vol_kfk', 'Volume', { Volume: 'vol_kfk', DiskGroup: 'kafka' }),
    r('Mount_kfk', 'Mount', { MountPoint: '/var/kafka-logs', BlockDevice: '/dev/vx/dsk/kafka/vol_kfk' }),
    r('Kafka_kfk', 'Kafka', {
      KafkaHome: '/opt/kafka',
      Mode: 'KRaft',
      BrokerId: '0',
      Port: '9092',
      ControllerPort: '9093',
      MonScript: 'shell:nc -z 127.0.0.1 9092',
    }, true),
    r('IP_kfk', 'IP', { Address: '10.95.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_kfk', 'NIC', { Device: 'eth0' }),
  ], [
    ['Vol_kfk', 'DG_kfk'],
    ['Mount_kfk', 'Vol_kfk'],
    ['IP_kfk', 'NIC_kfk'],
    ['Kafka_kfk', 'Mount_kfk'],
    ['Kafka_kfk', 'IP_kfk'],
  ])
}

/** MongoDB 副本集案例组（主/从/仲裁三成员 + 共享数据盘，pgrep 探活实战） */
function mongoRsGroup(): SeedGroup {
  return g('MONGO_RS_SG', [
    r('DG_mongo', 'DiskGroup', { DiskGroupName: 'mongo', StartVolumes: '1' }),
    r('Vol_mongo', 'Volume', { Volume: 'vol_mongo', DiskGroup: 'mongo' }),
    r('Mount_mongo', 'Mount', { MountPoint: '/var/lib/mongodb', BlockDevice: '/dev/vx/dsk/mongo/vol_mongo' }),
    r('Mongo_primary', 'MongoDB', {
      ConfPath: '/etc/mongod.conf',
      DataDir: '/var/lib/mongodb',
      Port: '27017',
      ReplSetName: 'rs0',
      MonScript: 'shell:pgrep -x mongod',
    }, true),
    r('Mongo_secondary', 'MongoDB', {
      ConfPath: '/etc/mongod-sec.conf',
      DataDir: '/var/lib/mongodb-sec',
      Port: '27018',
      ReplSetName: 'rs0',
      MonScript: 'shell:pgrep -x mongod',
    }),
    r('Mongo_arbiter', 'MongoDB', {
      ConfPath: '/etc/mongod-arb.conf',
      DataDir: '/var/lib/mongodb-arb',
      Port: '27019',
      ReplSetName: 'rs0',
      MonScript: 'shell:pgrep -x mongod',
    }),
    r('IP_mongo', 'IP', { Address: '10.85.0.10', NetMask: '255.255.255.0', Device: 'eth0' }, true),
    r('NIC_mongo', 'NIC', { Device: 'eth0' }),
  ], [
    ['Vol_mongo', 'DG_mongo'],
    ['Mount_mongo', 'Vol_mongo'],
    ['Mongo_primary', 'Mount_mongo'],
    ['Mongo_secondary', 'Mount_mongo'],
    ['Mongo_arbiter', 'Mount_mongo'],
    ['Mongo_primary', 'IP_mongo'],
  ])
}

/** 27 个 Demo 集群（18 个照抄 Windows 版 + 9 个常用/新版/云服务案例），顺序即端口顺序：15554 起 */
export const CLUSTER_SEEDS: SeedCluster[] = [
  { name: 'AIX_NFS', platform: 'AIX', groups: [nfsGroup('a', 'en0', '/exports/aix')] },
  { name: 'AcmePrimarySite', platform: 'Solaris', groups: [appGroup('Acme_Web_SG', 'acme', 'hme0', '/webspace', '/usr/apache/bin/httpd', 'Process')] },
  { name: 'AcmeSecondarySite', platform: 'Solaris', groups: [appGroup('Acme_Web_SG', 'acme', 'hme0', '/webspace', '/usr/apache/bin/httpd', 'Process')] },
  {
    name: 'CONSOLIDATION',
    platform: 'AIX',
    groups: [
      appGroup('GRP_DB2', 'db2', 'en0', '/data/db2', '/opt/IBM/db2/start.sh'),
      g('GRP_FILES', [
        r('DG_fil', 'DiskGroup', { DiskGroupName: 'dgfil', StartVolumes: '1' }),
        r('Vol_fil', 'Volume', { Volume: 'volfil', DiskGroup: 'dgfil' }),
        r('Mount_fil', 'Mount', { MountPoint: '/data/files', BlockDevice: '/dev/vx/dsk/dgfil/volfil' }),
        r('Share_fil', 'Share', { PathName: '/data/files' }),
      ], [
        ['Vol_fil', 'DG_fil'],
        ['Mount_fil', 'Vol_fil'],
        ['Share_fil', 'Mount_fil'],
      ]),
    ],
  },
  { name: 'HP_NFS', platform: 'HP-UX', groups: [nfsGroup('hp', 'lan0', '/exports/hpux')] },
  { name: 'LIN_NFS', platform: 'Linux', groups: [nfsGroup('lnx', 'eth0', '/exports/linux')] },
  { name: 'SOL_NPLUS1', platform: 'Solaris', groups: [appGroup('NPLUS1_SG', 'np1', 'hme0', '/opt/nplus1', '/opt/nplus1/bin/start.sh')] },
  { name: 'SOL_ORACLE', platform: 'Solaris', groups: [oracleGroup()] },
  { name: 'SOL_ORA_SRDF_C1', platform: 'Solaris', groups: [oracleGroup('', 'R1')] },
  { name: 'SOL_ORA_SRDF_C2', platform: 'Solaris', groups: [oracleGroup('', 'R2')] },
  { name: 'WIN_2K10_VVR_C1', platform: 'W2K8', groups: [vvrGroup('VVR_2K10_SG', 'v10', 'Primary', 'IIS Admin Service')] },
  { name: 'WIN_2K10_VVR_C2', platform: 'W2K8', groups: [vvrGroup('VVR_2K10_SG', 'v10', 'Secondary', 'IIS Admin Service')] },
  { name: 'WIN_NTAP_EXCH_CL1', platform: 'W2K3', groups: [vvrGroup('EXCH_SG', 'ntap', 'Primary', 'MSExchangeIS')] },
  { name: 'WIN_NTAP_EXCH_CL2', platform: 'W2K3', groups: [vvrGroup('EXCH_SG', 'ntap', 'Secondary', 'MSExchangeIS')] },
  { name: 'WIN_SQL2K5_VVR_C1', platform: 'W2K8', groups: [vvrGroup('SQL_VVR_SG', 'sql2k5', 'Primary', 'MSSQLSERVER')] },
  { name: 'WIN_SQL2K5_VVR_C2', platform: 'W2K8', groups: [vvrGroup('SQL_VVR_SG', 'sql2k5', 'Secondary', 'MSSQLSERVER')] },
  { name: 'WIN_SQL2K8_VVR_C1', platform: 'W2K8', groups: [vvrGroup('SQL_VVR_SG', 'sql2k8', 'Primary', 'MSSQLSERVER')] },
  { name: 'WIN_SQL2K8_VVR_C2', platform: 'W2K8', groups: [vvrGroup('SQL_VVR_SG', 'sql2k8', 'Secondary', 'MSSQLSERVER')] },
  // ---- 常用服务案例（v2.4 补充：双机 MySQL HA / Nginx+Tomcat Web 链）----
  { name: 'MYSQL_HA', platform: 'Linux', groups: [mysqlHaGroup()] },
  { name: 'WEB_NGINX_HA', platform: 'Linux', groups: [webNginxGroup()] },
  // ---- 新版 Oracle 案例（v2.5 补充：19c/23ai 多租户 CDB+PDB + Flex ASM/ASMFD）----
  { name: 'ORACLE_19C_HA', platform: 'Linux', groups: [oracle19cGroup()] },
  // ---- 集群化服务案例（v2.7 补充：Redis 哨兵主从 / ES http 探活 / Kafka ZK+Broker / MongoDB 副本集）----
  { name: 'REDIS_CLUSTER', platform: 'Linux', groups: [redisClusterGroup()] },
  { name: 'ELASTICSEARCH_HA', platform: 'Linux', groups: [esHaGroup()] },
  { name: 'KAFKA_HA', platform: 'Linux', groups: [kafkaHaGroup()] },
  { name: 'MONGODB_RS', platform: 'Linux', groups: [mongoRsGroup()] },
]

/** 首个模拟器端口（与 Windows 版一致从 15554 起，逐集群 +1） */
export const FIRST_SIM_PORT = 15554

/**
 * 写入 Demo 集群（幂等：仅当 cluster 表为空时执行）
 * @param db 数据库连接
 */
export function seedDemoClusters(db: import('better-sqlite3').Database): void {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM cluster').get() as { c: number }).c
  if (count > 0) return

  const insCluster = db.prepare(
    'INSERT INTO cluster (name, platform, status, simulator_port, wac_port) VALUES (?, ?, ?, ?, -1)',
  )
  const insSystem = db.prepare('INSERT INTO system (cluster_id, name, status) VALUES (?, ?, ?)')
  const insGroup = db.prepare(
    'INSERT INTO service_group (cluster_id, name, system_list, autostart_list) VALUES (?, ?, ?, ?)',
  )
  const typeRows = db.prepare('SELECT id, code FROM resource_type').all() as { id: number; code: string }[]
  const typeMap = new Map(typeRows.map((t) => [t.code, t.id]))
  const insRes = db.prepare(
    "INSERT INTO resource (group_id, type_id, name, enabled, critical, state) VALUES (?, ?, ?, 1, ?, 'OFFLINE')",
  )
  const insAttr = db.prepare('INSERT INTO resource_attr (resource_id, key, value) VALUES (?, ?, ?)')
  const insLink = db.prepare('INSERT INTO resource_link (group_id, child_id, parent_id) VALUES (?, ?, ?)')

  const tx = db.transaction(() => {
    CLUSTER_SEEDS.forEach((c, idx) => {
      const cid = Number(insCluster.run(c.name, c.platform, 'STOPPED', FIRST_SIM_PORT + idx).lastInsertRowid)
      const systems = c.systems ?? ['sys1', 'sys2']
      for (const s of systems) insSystem.run(cid, s, 'OFFLINE')

      for (const grp of c.groups) {
        const gid = Number(
          insGroup.run(cid, grp.name, JSON.stringify(grp.systemList), JSON.stringify(grp.autostartList ?? [])).lastInsertRowid,
        )
        const resIdMap = new Map<string, number>()
        for (const res of grp.resources) {
          const tid = typeMap.get(res.type)
          if (!tid) throw new Error(`种子资源 ${res.name} 引用了未定义类型 ${res.type}`)
          const rid = Number(insRes.run(gid, tid, res.name, res.critical ? 1 : 0).lastInsertRowid)
          resIdMap.set(res.name, rid)
          for (const [k, v] of Object.entries(res.attrs ?? {})) insAttr.run(rid, k, v)
        }
        for (const [child, parent] of grp.links) {
          const childId = resIdMap.get(child)
          const parentId = resIdMap.get(parent)
          if (!childId || !parentId) throw new Error(`种子依赖边 ${child}->${parent} 引用了未定义资源`)
          insLink.run(gid, childId, parentId)
        }
      }
    })
  })
  tx()
}
