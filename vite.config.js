import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 1929,
    proxy: {
      '/api': {
        target: 'http://localhost:1930',
        changeOrigin: true,
      },
    },
  },
})
