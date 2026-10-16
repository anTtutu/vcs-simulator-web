/**
 * 文件：test/seed.spec.ts
 * 用途：种子数据完整性测试 —— 13 类型 / 18 集群 / SOL_ORACLE 拓扑 / 幂等性
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { describe, it, expect, afterAll } from 'vitest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { seedDemoClusters } from '../src/db/seed/clusters.seed.js'
import { seedResourceTypes } from '../src/db/seed/types.seed.js'

let ctx: TestCtx
afterAll(() => ctx && cleanupCtx(ctx))

describe('种子数据完整性', () => {
  ctx = createTestCtx()

  it('内置 37 种资源类型（含二开示例 + 新版 Oracle + 常用服务 + Kafka/MongoDB）', () => {
    const n = (ctx.db.prepare('SELECT COUNT(*) AS c FROM resource_type').get() as { c: number }).c
    expect(n).toBe(37)
    const codes = ctx.db.prepare('SELECT code FROM resource_type').all().map((r: { code: string }) => r.code)
    expect(codes).toContain('OracleASM')
    expect(codes).toContain('OraclePDB')
    expect(codes).toContain('MySQL')
    expect(codes).toContain('Zookeeper')
    expect(codes).toEqual(expect.arrayContaining([
      'Nginx', 'Tomcat', 'PostgreSQL', 'Redis', 'RabbitMQ', 'Samba',
      'IIS', 'DHCP', 'OpenLDAP', 'Jenkins', 'Etcd', 'Prometheus', 'Varnish', 'Memcached', 'Elasticsearch', 'Consul', 'ActiveMQ',
    ]))
    // OracleASM 升级：Flex ASM/ASMFD 新版属性
    const asm = ctx.db
      .prepare("SELECT attr_schema FROM resource_type WHERE code = 'OracleASM'")
      .get() as { attr_schema: string }
    const asmKeys = (JSON.parse(asm.attr_schema) as { key: string }[]).map((s) => s.key)
    expect(asmKeys).toEqual(expect.arrayContaining(['ASMInstance', 'DiskGroup', 'StorageLib', 'FlexAsm']))
    // OraclePDB：多租户必填属性
    const pdb = ctx.db
      .prepare("SELECT attr_schema FROM resource_type WHERE code = 'OraclePDB'")
      .get() as { attr_schema: string }
    const pdbSchema = JSON.parse(pdb.attr_schema) as { key: string; required?: boolean }[]
    expect(pdbSchema.filter((s) => s.required).map((s) => s.key)).toEqual(['PdbName', 'CdbInstance', 'OracleHome'])
  })

  it('25 个 Demo 集群（18 照抄 + 7 案例），端口从 15554 连续递增', () => {
    const rows = ctx.db.prepare('SELECT name, simulator_port FROM cluster ORDER BY simulator_port').all() as {
      name: string
      simulator_port: number
    }[]
    expect(rows).toHaveLength(25)
    expect(rows[0]).toMatchObject({ name: 'AIX_NFS', simulator_port: 15554 })
    expect(rows[17]).toMatchObject({ name: 'WIN_SQL2K8_VVR_C2', simulator_port: 15571 })
    expect(rows[18]).toMatchObject({ name: 'MYSQL_HA', simulator_port: 15572 })
    expect(rows[19]).toMatchObject({ name: 'WEB_NGINX_HA', simulator_port: 15573 })
    expect(rows[20]).toMatchObject({ name: 'ORACLE_19C_HA', simulator_port: 15574 })
    expect(rows[21]).toMatchObject({ name: 'REDIS_CLUSTER', simulator_port: 15575 })
    expect(rows[22]).toMatchObject({ name: 'ELASTICSEARCH_HA', simulator_port: 15576 })
    expect(rows[23]).toMatchObject({ name: 'KAFKA_HA', simulator_port: 15577 })
    expect(rows[24]).toMatchObject({ name: 'MONGODB_RS', simulator_port: 15578 })
    // 案例集群的组/资源完整性
    const ha = ctx.db.prepare('SELECT id FROM cluster WHERE name = ?').get('MYSQL_HA') as { id: number }
    const groups = ctx.db.prepare('SELECT id FROM service_group WHERE cluster_id = ?').all(ha.id) as { id: number }[]
    expect(groups).toHaveLength(1)
    const res = ctx.db.prepare('SELECT COUNT(*) AS c FROM resource WHERE group_id = ?').get(groups[0].id) as { c: number }
    expect(res.c).toBe(6)
    // 19c 案例：CDB→PDB→LSNR 多租户链
    const o19 = ctx.db.prepare('SELECT id FROM cluster WHERE name = ?').get('ORACLE_19C_HA') as { id: number }
    const g19 = ctx.db.prepare('SELECT id FROM service_group WHERE cluster_id = ?').all(o19.id) as { id: number }[]
    const res19 = ctx.db.prepare('SELECT name FROM resource WHERE group_id = ?').all(g19[0].id) as { name: string }[]
    const names = res19.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['ASM_orcl19c', 'ORA_CDB19c', 'PDB_plug1', 'LSNR_19c']))
    // Redis 案例：主/从/哨兵三成员
    const rc = ctx.db.prepare('SELECT id FROM cluster WHERE name = ?').get('REDIS_CLUSTER') as { id: number }
    const rg = ctx.db.prepare('SELECT id FROM service_group WHERE cluster_id = ?').all(rc.id) as { id: number }[]
    const rnames = ctx.db.prepare('SELECT name FROM resource WHERE group_id = ?').all(rg[0].id) as { name: string }[]
    expect(rnames.map((r) => r.name)).toEqual(expect.arrayContaining(['Redis_master', 'Redis_replica', 'Redis_sentinel']))
  })

  it('SOL_ORACLE：1 服务组 / 9 资源 / 9 条依赖边（截图拓扑还原）', () => {
    const id = clusterIdByName(ctx, 'SOL_ORACLE')
    const groups = ctx.db.prepare('SELECT id, name, system_list, autostart_list FROM service_group WHERE cluster_id = ?').all(id) as {
      id: number
      name: string
      system_list: string
      autostart_list: string
    }[]
    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('ORA_PROD_Group')
    expect(JSON.parse(groups[0].system_list)).toEqual([
      { name: 'sys1', priority: 0 },
      { name: 'sys2', priority: 1 },
    ])
    expect(JSON.parse(groups[0].autostart_list)).toEqual(['sys1'])

    const gid = groups[0].id
    const res = ctx.db.prepare('SELECT name, critical FROM resource WHERE group_id = ?').all(gid) as {
      name: string
      critical: number
    }[]
    expect(res).toHaveLength(9)
    // 关键资源：ORA 与 IP 为 Critical
    const critMap = Object.fromEntries(res.map((r) => [r.name, r.critical]))
    expect(critMap['ORA_oraprod']).toBe(1)
    expect(critMap['IP_oraprod']).toBe(1)
    expect(critMap['DG_oraprod']).toBe(0)

    const links = ctx.db.prepare('SELECT COUNT(*) AS c FROM resource_link WHERE group_id = ?').get(gid) as { c: number }
    expect(links.c).toBe(9)
  })

  it('Netlsnr 属性与 Windows 版属性视图截图一致（8 项）', () => {
    const row = ctx.db
      .prepare(
        `SELECT a.key, a.value FROM resource_attr a
         JOIN resource r ON r.id = a.resource_id
         WHERE r.name = 'LSNR_oraprod_lsnr' ORDER BY a.key`,
      )
      .all() as { key: string; value: string }[]
    const map = Object.fromEntries(row.map((x) => [x.key, x.value]))
    expect(map).toMatchObject({
      Owner: 'oraprod',
      Home: '/prod/u01/oracle/product/8.1.5',
      TnsAdmin: '/prod/u01/oracle/network/admin',
      Listener: 'LISTENER_PROD',
      MonScript: './bin/Netlsnr/LsnrTest.pl',
    })
  })

  it('种子幂等：重复执行不产生重复数据', () => {
    seedResourceTypes(ctx.db)
    seedDemoClusters(ctx.db)
    const c = (ctx.db.prepare('SELECT COUNT(*) AS c FROM cluster').get() as { c: number }).c
    expect(c).toBe(25)
  })

  it('成对容灾集群：SRDF 两端的 RDFSite 属性分别为 R1/R2', () => {
    const getRdf = (clusterName: string): string => {
      const cid = clusterIdByName(ctx, clusterName)
      const row = ctx.db
        .prepare(
          `SELECT a.value FROM resource_attr a
           JOIN resource r ON r.id = a.resource_id
           JOIN service_group g ON g.id = r.group_id
           WHERE g.cluster_id = ? AND a.key = 'RDFSite'`,
        )
        .get(cid) as { value: string }
      return row?.value
    }
    expect(getRdf('SOL_ORA_SRDF_C1')).toBe('R1')
    expect(getRdf('SOL_ORA_SRDF_C2')).toBe('R2')
  })
})
