import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev only: forward API calls to the backend so no CORS setup is needed locally.
    proxy: { '/api': { target: process.env.VITE_DEV_API ?? 'http://localhost:4000', changeOrigin: true } },
  },
})
