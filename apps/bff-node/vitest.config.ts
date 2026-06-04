import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    // 让 vitest 处理 .js 后缀的 TS 文件（NodeNext 模式）
    server: {
      deps: {
        inline: [/koa/, /supertest/],
      },
    },
  },
  resolve: {
    extensions: ['.ts', '.mts', '.cts', '.js'],
  },
})
