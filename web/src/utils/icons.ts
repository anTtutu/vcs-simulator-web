/**
 * 文件：src/utils/icons.ts
 * 用途：图标工具 —— Windows 版 VCS Simulator 风格的资源类型立体 SVG 图标（isometric 三面体/圆柱堆）
 *       · resourceIconSvg(typeCode)：SVG data URI（拓扑节点 image / 向导类型卡片大图）
 *       · STATE_COLORS / PLATFORM_BADGES / clusterStatusIcon：状态色、平台徽标、集群状态图标
 *       树形控件小尺寸仍用类型自带 emoji（DB icon 字段），大尺寸场景一律用 SVG
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 资源状态 → 颜色（画布节点与树徽标共用） */
export const STATE_COLORS: Record<string, string> = {
  ONLINE: '#2e9e44',
  OFFLINE: '#8a9099',
  FAULTED: '#d63a2f',
  STARTING: '#e6a23c',
  STOPPING: '#e6a23c',
  WAITING: '#909399',
  UNKNOWN: '#c0c4cc',
}

/** 平台 → 徽标（Windows 版列表的平台图标语义映射） */
export const PLATFORM_BADGES: Record<string, { text: string; bg: string }> = {
  AIX: { text: 'AIX', bg: '#3f7cad' },
  Solaris: { text: '☀ Solaris', bg: '#c76a1a' },
  'HP-UX': { text: 'HP-UX', bg: '#6b3fa0' },
  Linux: { text: '🐧 Linux', bg: '#4a7a28' },
  W2K3: { text: 'W2K3', bg: '#5a6068' },
  W2K8: { text: 'W2K8', bg: '#2f6cb5' },
}

/** 集群状态 → 列表图标 */
export function clusterStatusIcon(status: string): { text: string; cls: string } {
  switch (status) {
    case 'RUNNING':
      return { text: '✔', cls: 'ok' }
    case 'STARTING':
    case 'STOPPING':
      return { text: '⏳', cls: 'busy' }
    default:
      return { text: '⏻', cls: 'stopped' }
  }
}

// ====================================================================
// 资源类型立体图标：Microsoft Fluent Emoji 3D（MIT 许可）
// assets/3d-icons/*.svg 来自 https://github.com/microsoft/fluentui-emoji
// 3D 渲染质感与 Windows 版 VCS 的立体图标气质对齐；自定义类型用 Package 兜底
// =================================================================
import diskgroupIcon from '../assets/3d-icons/diskgroup.svg'
import volumeIcon from '../assets/3d-icons/volume.svg'
import mountIcon from '../assets/3d-icons/mount.svg'
import rvgIcon from '../assets/3d-icons/rvg.svg'
import nicIcon from '../assets/3d-icons/nic.svg'
import ipIcon from '../assets/3d-icons/ip.svg'
import oracleIcon from '../assets/3d-icons/oracle.svg'
import netlsnrIcon from '../assets/3d-icons/netlsnr.svg'
import processIcon from '../assets/3d-icons/process.svg'
import applicationIcon from '../assets/3d-icons/application.svg'
import nfsIcon from '../assets/3d-icons/nfs.svg'
import shareIcon from '../assets/3d-icons/share.svg'
import proxyIcon from '../assets/3d-icons/proxy.svg'
import customIcon from '../assets/3d-icons/custom.svg'
import oracleasmIcon from '../assets/3d-icons/oracleasm.svg'
import mysqlIcon from '../assets/3d-icons/mysql.svg'
import oraclepdbIcon from '../assets/3d-icons/oraclepdb.svg'
import nginxIcon from '../assets/3d-icons/nginx.svg'
import tomcatIcon from '../assets/3d-icons/tomcat.svg'
import postgresqlIcon from '../assets/3d-icons/postgresql.svg'
import redisIcon from '../assets/3d-icons/redis.svg'
import rabbitmqIcon from '../assets/3d-icons/rabbitmq.svg'
import sambaIcon from '../assets/3d-icons/samba.svg'
import iisIcon from '../assets/3d-icons/iis.svg'
import dhcpIcon from '../assets/3d-icons/dhcp.svg'
import openldapIcon from '../assets/3d-icons/openldap.svg'
import jenkinsIcon from '../assets/3d-icons/jenkins.svg'
import etcdIcon from '../assets/3d-icons/etcd.svg'
import prometheusIcon from '../assets/3d-icons/prometheus.svg'
import varnishIcon from '../assets/3d-icons/varnish.svg'
import memcachedIcon from '../assets/3d-icons/memcached.svg'
import elasticsearchIcon from '../assets/3d-icons/elasticsearch.svg'
import consulIcon from '../assets/3d-icons/consul.svg'
import activemqIcon from '../assets/3d-icons/activemq.svg'
import minioIcon from '../assets/3d-icons/minio.svg'

/** 类型 code → 3D 图标 URL（vite 静态资源） */
const ICON_URLS: Record<string, string> = {
  DiskGroup: diskgroupIcon,
  Volume: volumeIcon,
  Mount: mountIcon,
  RVG: rvgIcon,
  NIC: nicIcon,
  IP: ipIcon,
  Oracle: oracleIcon,
  Netlsnr: netlsnrIcon,
  Process: processIcon,
  Application: applicationIcon,
  NFS: nfsIcon,
  Share: shareIcon,
  Proxy: proxyIcon,
  // 二开示例类型
  OracleASM: oracleasmIcon,
  OraclePDB: oraclepdbIcon,
  MySQL: mysqlIcon,
  // 常用服务模块
  Nginx: nginxIcon,
  Tomcat: tomcatIcon,
  PostgreSQL: postgresqlIcon,
  Redis: redisIcon,
  RabbitMQ: rabbitmqIcon,
  Samba: sambaIcon,
  IIS: iisIcon,
  DHCP: dhcpIcon,
  OpenLDAP: openldapIcon,
  Jenkins: jenkinsIcon,
  Etcd: etcdIcon,
  Prometheus: prometheusIcon,
  Varnish: varnishIcon,
  Memcached: memcachedIcon,
  Elasticsearch: elasticsearchIcon,
  Consul: consulIcon,
  ActiveMQ: activemqIcon,
  MinIO: minioIcon,
}

/**
 * 资源类型 → 立体 3D 图标 URL（拓扑节点 / 类型向导大图）
 * @param typeCode 类型 code（未匹配走 Package 兜底）
 */
export function resourceIconSvg(typeCode: string): string {
  return ICON_URLS[typeCode] ?? customIcon
}
