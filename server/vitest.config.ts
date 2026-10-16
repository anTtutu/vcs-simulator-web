import { defineConfig } from 'vitest/config'

/**
 * 后端单测配置：
 * - 测试文件位于 test 目录下的 *.spec.ts（不参与 tsc 构建）
 * - 单测一律使用临时 SQLite 文件（见 test/helpers.ts），不污染开发库
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // 测试文件顺序执行：各文件会设置 VCS_DB_PATH/VCS_LOG_DIR 等 process.env（worker 间共享，并行会互相覆盖）
    fileParallelism: false,
    // 防止意外连到真实开发库：测试进程强制注入内存库路径
    env: {
      VCS_DB_PATH: './data/vcs-test.db',
    },
  },
})
