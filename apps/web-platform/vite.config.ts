import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 平台后台独立部署在自己的域名/端口下，与租户后台零重叠。
// 合并的话租户侧的 JS 包里会带上平台 API 路径与字段结构，路由隐藏挡不住扒包。
export default defineConfig({
  base: '/platform/',
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
