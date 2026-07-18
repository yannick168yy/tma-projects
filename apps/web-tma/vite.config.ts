import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // 静态资源(JS/CSS/字体/图)地址：设 VITE_ASSET_BASE=CloudFront 域名则 assets 走 CDN，
  // 未设时走源站(相对 '/')，便于回滚 + CloudFront 未就绪时安全。API 调用不受此影响(另走 VITE_BFF_BASE_URL)。
  base: process.env.VITE_ASSET_BASE || '/',
  plugins: [react(), tailwindcss()],
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
