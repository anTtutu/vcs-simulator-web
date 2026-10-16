/**
 * 文件：test/cf.spec.ts
 * 用途：main.cf 解析/生成/导入测试 —— 与真实 VCS 语法互操作的关键保障
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestCtx, cleanupCtx, clusterIdByName, type TestCtx } from './helpers.js'
import { tokenize, parseMainCf } from '../src/cf/parser.js'
import { generateMainCf, generateTypesCf } from '../src/cf/generator.js'
import { importMainCf } from '../src/cf/importer.js'

let ctx: TestCtx
beforeAll(() => {
  ctx = createTestCtx()
})
afterAll(() => ctx && cleanupCtx(ctx))

/** SOL_ORACLE 生成文本样例（用于手写解析用例） */
const SAMPLE = `
include "types.cf"

cluster MY_ORACLE (
    ClusterName = "MY_ORACLE"
    )

system sys1 (
    )

system sys2 (
    )

service group ORA_PROD_Group (
    SystemList = { sys1 = 0, sys2 = 1 }
    AutoStartList = { sys1 }
    )

    LSNR_oraprod_lsnr requires ORA_oraprod
    ORA_oraprod requires IP_oraprod
    IP_oraprod requires NIC_oraprod  // 行注释
    # 独立注释行

    IP_oraprod (
        Address = "10.10.10.11"
        NetMask = "255.255.255.0"
        Device = hme0
        )
`

describe('main.cf 解析器', () => {
  it('tokenizer：注释/字符串/符号切分', () => {
    const tokens = tokenize(`a = "x y" // 注释\n(z)`)
    expect(tokens.map((t) => t.value)).toEqual(['a', '=', 'x y', '(', 'z', ')'])
  })

  it('解析样例：cluster/system/group/资源块/requires 全部归位', () => {
    const m = parseMainCf(SAMPLE)
    expect(m.cluster.name).toBe('MY_ORACLE')
    expect(m.includes).toEqual(['types.cf'])
    expect(m.systems.map((s) => s.name)).toEqual(['sys1', 'sys2'])
    expect(m.groups).toHaveLength(1)
    const g = m.groups[0]
    expect(g.name).toBe('ORA_PROD_Group')
    expect(g.attrs['SystemList']).toMatchObject({ pairs: { sys1: '0', sys2: '1' } })
    expect(g.attrs['AutoStartList']).toMatchObject({ values: ['sys1'] })
    expect(g.resources).toHaveLength(1)
    expect(g.resources[0]).toMatchObject({ name: 'IP_oraprod', attrs: { Device: 'hme0' } })
    expect(g.links).toContainEqual(['LSNR_oraprod_lsnr', 'ORA_oraprod'])
    expect(g.links).toHaveLength(3)
  })

  it('属性块不在组内 / 悬空 requires 进 warnings', () => {
    const m = parseMainCf(`
cluster T ( )
group_lone ( X = 1 )
A requires B
`)
    expect(m.groups).toHaveLength(0)
    expect(m.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('语法错误带行号', () => {
    expect(() => parseMainCf('cluster ( "x')).toThrowError(/第 1 行/)
  })
})

describe('main.cf 生成 → 解析 → 导入 往返', () => {
  it('SOL_ORACLE 导出文本包含全部关键结构', () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const tree = ctx.repo.getTree(cid)
    const text = generateMainCf({ cluster: tree.cluster, groups: tree.groups })
    expect(text).toContain('include "types.cf"')
    expect(text).toContain('cluster SOL_ORACLE (')
    expect(text).toContain('service group ORA_PROD_Group (')
    expect(text).toContain('SystemList = { sys1 = 0, sys2 = 1 }')
    expect(text).toContain('LSNR_oraprod_lsnr requires ORA_oraprod')
    expect(text).toContain('Address = "10.10.10.11"')
    // types.cf
    const types = generateTypesCf(ctx.repo.listResourceTypes())
    expect(types).toContain('type Netlsnr (')
    expect(types).toContain('str TnsAdmin')
  })

  it('导出文本可完整回灌导入（重命名集群后）', () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const tree = ctx.repo.getTree(cid)
    const text = generateMainCf({ cluster: tree.cluster, groups: tree.groups })
      .replace('cluster SOL_ORACLE (', 'cluster ROUND_TRIP (')
      .replace('ClusterName = "SOL_ORACLE"', 'ClusterName = "ROUND_TRIP"')
    const model = parseMainCf(text)
    const result = importMainCf(ctx.db, model)
    expect(result.clusterName).toBe('ROUND_TRIP')
    expect(result.groups).toBe(1)
    expect(result.resources).toBe(9)
    expect(result.links).toBe(9)

    // 导入后拓扑与原集群一致
    const imported = ctx.repo.getTree(result.clusterId)
    const srcGroup = tree.groups[0]
    const impGroup = imported.groups[0]
    expect(impGroup.resources).toHaveLength(9)
    expect(impGroup.resources.map((r) => r.name).sort()).toEqual(srcGroup.resources.map((r) => r.name).sort())
    // LSNR 依赖 ORA；类型正确识别为 Netlsnr
    const lsnr = impGroup.resources.find((r) => r.name === 'LSNR_oraprod_lsnr')!
    const ora = impGroup.resources.find((r) => r.name === 'ORA_oraprod')!
    expect(lsnr.typeCode).toBe('Netlsnr')
    expect(lsnr.parents).toContain(ora.id)
  })

  it('同名集群导入冲突 409 语义', () => {
    const cid = clusterIdByName(ctx, 'SOL_ORACLE')
    const tree = ctx.repo.getTree(cid)
    const text = generateMainCf({ cluster: tree.cluster, groups: tree.groups })
    const model = parseMainCf(text)
    expect(() => importMainCf(ctx.db, model)).toThrowError(/已存在/)
  })
})
