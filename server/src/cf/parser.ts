/**
 * 文件：src/cf/parser.ts
 * 用途：main.cf 解析器 —— 手写 tokenizer + 递归下降，产出领域模型
 *       支持：include / cluster / system / service group 块、资源属性块、requires 依赖、
 *             { a = 1, b = 2 } 与 { v1, v2 } 两种列表、// 与 # 注释
 * 作者：Anttu
 * 日期：2026-10-15
 */
import { BizError } from '../domain/clusterLifecycle.js'

// ---------- 词法 ----------

type TokenType = 'ident' | 'string' | 'number' | 'punct'
interface Token {
  type: TokenType
  value: string
  line: number
}

/**
 * 词法分析：将 main.cf 文本切分为 token 流
 * @param text 配置文本
 * @returns token 列表
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  while (i < text.length) {
    const ch = text[i]
    // 换行
    if (ch === '\n') {
      line++
      i++
      continue
    }
    // 空白
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // 行注释 // 与 #
    if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    // 字符串
    if (ch === '"') {
      let j = i + 1
      let val = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          val += text[j + 1] ?? ''
          j += 2
        } else {
          val += text[j]
          j++
        }
      }
      if (j >= text.length) throw new BizError(400, `main.cf 第 ${line} 行：字符串未闭合`)
      tokens.push({ type: 'string', value: val, line })
      i = j + 1
      continue
    }
    // 符号
    if ('(){}=,'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch, line })
      i++
      continue
    }
    // 标识符 / 数字
    if (/[A-Za-z_0-9.\-+]/.test(ch)) {
      let j = i
      while (j < text.length && /[A-Za-z_0-9.\-+]/.test(text[j])) j++
      const val = text.slice(i, j)
      tokens.push({ type: /^[0-9.\-+]+$/.test(val) ? 'number' : 'ident', value: val, line })
      i = j
      continue
    }
    throw new BizError(400, `main.cf 第 ${line} 行：无法识别的字符 "${ch}"`)
  }
  return tokens
}

// ---------- 语法 ----------

/** 属性值：标量或列表（带键对/纯值两种） */
export type CfValue = string | CfList
export interface CfList {
  /** 带键对（如 SystemList = { sys1 = 0 }） */
  pairs?: Record<string, string>
  /** 纯值列表（如 AutoStartList = { sys1 }） */
  values?: string[]
}
/** 属性块：保序键值 */
export type CfAttrs = Record<string, CfValue>

/** 服务组 */
export interface CfGroup {
  name: string
  attrs: CfAttrs
  resources: { name: string; attrs: CfAttrs }[]
  links: [string, string][] // [child, parent]
}
/** 解析结果模型 */
export interface CfModel {
  includes: string[]
  cluster: { name: string; attrs: CfAttrs }
  systems: { name: string; attrs: CfAttrs }[]
  groups: CfGroup[]
  warnings: string[]
}

/**
 * 解析 main.cf 文本
 * @param text 配置文本
 * @returns 领域模型（含 warnings：跳过的无法归位内容）
 */
export function parseMainCf(text: string): CfModel {
  const tokens = tokenize(text)
  let pos = 0
  const warnings: string[] = []

  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  const expect = (value: string) => {
    const t = next()
    if (!t || t.value !== value) {
      throw new BizError(400, `main.cf 第 ${t?.line ?? '?'} 行：期望 "${value}"，实际 "${t?.value ?? 'EOF'}"`)
    }
    return t
  }
  const isPunct = (v: string) => peek()?.type === 'punct' && peek().value === v

  // ---- 值解析：string/number/ident 或 {列表} ----
  function parseValue(): CfValue {
    const t = peek()
    if (!t) throw new BizError(400, 'main.cf 意外结束（期望属性值）')
    if (isPunct('{')) {
      next()
      // 判断键对列表还是纯值列表：看第一个非 { token 后是否跟 =
      const list: CfList = {}
      if (isPunct('}')) {
        next()
        return list
      }
      // 探测：ident/string 后跟 '=' 即键对
      const probeIdx = pos
      const first = tokens[probeIdx]
      const isPairs = first && tokens[probeIdx + 1]?.type === 'punct' && tokens[probeIdx + 1].value === '='
      if (isPairs) {
        list.pairs = {}
        while (!isPunct('}')) {
          const k = next()
          expect('=')
          const v = next()
          list.pairs[k.value] = v.value
          if (isPunct(',')) next()
        }
        next() // }
        return list
      }
      list.values = []
      while (!isPunct('}')) {
        const v = next()
        list.values.push(v.value)
        if (isPunct(',')) next()
      }
      next() // }
      return list
    }
    next()
    return t.value
  }

  // ---- 属性块：( KEY = value ... ) ----
  function parseBlockAttrs(): CfAttrs {
    expect('(')
    const attrs: CfAttrs = {}
    while (!isPunct(')')) {
      const k = next()
      if (!k) throw new BizError(400, 'main.cf 意外结束（属性块未闭合）')
      expect('=')
      attrs[k.value] = parseValue()
    }
    next() // )
    return attrs
  }

  // ---- 顶层遍历 ----
  const model: CfModel = {
    includes: [],
    cluster: { name: '', attrs: {} },
    systems: [],
    groups: [],
    warnings,
  }
  let currentGroup: CfGroup | null = null

  while (pos < tokens.length) {
    const t = peek()
    // include "types.cf"
    if (t.type === 'ident' && t.value === 'include') {
      next()
      const f = next()
      model.includes.push(f.value)
      continue
    }
    // cluster NAME ( ... )
    if (t.type === 'ident' && t.value === 'cluster' && tokens[pos + 1]?.type === 'ident') {
      next()
      model.cluster = { name: next().value, attrs: parseBlockAttrs() }
      continue
    }
    // system NAME ( ... )
    if (t.type === 'ident' && t.value === 'system' && tokens[pos + 1]?.type === 'ident') {
      next()
      model.systems.push({ name: next().value, attrs: parseBlockAttrs() })
      continue
    }
    // service group NAME ( ... )
    if (t.type === 'ident' && t.value === 'service' && tokens[pos + 1]?.value === 'group') {
      next()
      next()
      const name = next().value
      currentGroup = { name, attrs: parseBlockAttrs(), resources: [], links: [] }
      model.groups.push(currentGroup)
      continue
    }
    // 组上下文：NAME requires NAME
    if (t.type === 'ident' && tokens[pos + 1]?.value === 'requires') {
      const child = next().value
      next() // requires
      const parent = next().value
      if (currentGroup) currentGroup.links.push([child, parent])
      else warnings.push(`第 ${t.line} 行：requires 依赖不在任何服务组上下文内，已跳过（${child} requires ${parent}）`)
      continue
    }
    // 组上下文：资源属性块 NAME ( ... )
    if (t.type === 'ident' && tokens[pos + 1]?.type === 'punct' && tokens[pos + 1].value === '(') {
      const name = next().value
      const attrs = parseBlockAttrs()
      if (currentGroup) currentGroup.resources.push({ name, attrs })
      else warnings.push(`第 ${t.line} 行：资源块 ${name} 不在任何服务组内，已跳过`)
      continue
    }
    // 未知 token：跳过并告警
    warnings.push(`第 ${t.line} 行：未识别的标记 "${t.value}"，已跳过`)
    next()
  }
  return model
}
