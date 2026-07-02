import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages project page serves under /norack-pwa/ (public repo name).
  // base is applied to asset URLs + router basename.
  base: '/norack-pwa/',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/webhook': {
        target: 'https://n8nlocal.winterarmy.net',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
