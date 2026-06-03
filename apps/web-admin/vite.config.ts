import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
