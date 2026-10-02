import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward all /api/* requests to the Wrangler worker dev server.
      // This prevents Vite's own server from returning 404 for API routes.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        // Also proxy WebSocket upgrades (used for /api/rooms/:code/ws)
        ws: true,
      },
    },
  },
})
