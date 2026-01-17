import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Important for Electron (file:// protocol)
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_CIDER_HOST || 'http://localhost:10767',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})