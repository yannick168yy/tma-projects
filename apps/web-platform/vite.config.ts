import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 平台后台独立部署在自己的域名/端口下，与租户后台零重叠。
// 合并的话租户侧的 JS 包里会带上平台 API 路径与字段结构，路由隐藏挡不住扒包。
// base 由构建方决定：生产有独立域名 platform.betogo.games，直接挂根路径；
// 测试环境只有 188facai.com 一个域名，只能用 /platform/ 前缀挤在租户站旁边。
// 路由 basename 与登录跳转都读 import.meta.env.BASE_URL，跟着这里走，不再各写一份。
export default defineConfig({
  base: process.env.PLATFORM_BASE || '/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: process.env.VITE_PLATFORM_API_BASE_URL?.replace('/api/v1', '') ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
