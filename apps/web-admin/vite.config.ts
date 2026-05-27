import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_ADMIN_API_BASE_URL?.replace('/api/v1', '') ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
