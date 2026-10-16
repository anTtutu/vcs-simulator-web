/**
 * 文件：src/utils/diff.ts
 * 用途：轻量行级 diff（LCS）—— 快照对比视图用，无第三方依赖
 * 作者：Anttu
 * 日期：2026-10-15
 */

/** 单侧行：text 内容，changed 是否为差异行 */
export interface DiffRow {
  text: string
  changed: boolean
}

/**
 * 行级 diff：基于最长公共子序列（适合几十~几百行的配置文本）
 * @param a 旧文本
 * @param b 新文本
 * @returns [旧侧行列表, 新侧行列表]（changed 行分别对应删除/新增）
 */
export function diffLines(a: string, b: string): [DiffRow[], DiffRow[]] {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length
  // LCS 动规表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const left: DiffRow[] = []
  const right: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      left.push({ text: A[i++], changed: false })
      right.push({ text: B[j++], changed: false })
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: A[i++], changed: true })
    } else {
      right.push({ text: B[j++], changed: true })
    }
  }
  while (i < n) left.push({ text: A[i++], changed: true })
  while (j < m) right.push({ text: B[j++], changed: true })
  return [left, right]
}
