import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { tenantOverlay } from './vite-tenant-overlay'

// L3 overlay（P3-4）：TENANT=<code> 时用 src/tenants/<code>/ 下的同名文件覆盖主干，
// 产物出到 dist-tenants/<code>/ 并带独立 base，避免与主干产物互相覆盖。
const tenant = process.env.TENANT?.trim() || undefined

export default defineConfig({
  // 静态资源(JS/CSS/字体/图)地址：设 VITE_ASSET_BASE=CloudFront 域名则 assets 走 CDN，
  // 未设时走源站(相对 '/')，便于回滚 + CloudFront 未就绪时安全。API 调用不受此影响(另走 VITE_BFF_BASE_URL)。
  // overlay 租户默认给一个独立前缀：两份产物同时挂在一个站点目录下时，
  // assets 文件名哈希一样但内容不同，混在一起会出现「主干页面加载到 overlay 的 chunk」
  base: process.env.VITE_ASSET_BASE || (tenant ? `/t/${tenant}/` : '/'),
  plugins: [tenantOverlay(tenant), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  build: {
    outDir: tenant ? `dist-tenants/${tenant}` : 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          return 'vendor'
        },
      },
    },
  },
})
