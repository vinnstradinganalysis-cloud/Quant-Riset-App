import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: './',
  // inspectAttr hanya untuk mode dev — di production build ia merusak file JS node_modules
  plugins: command === 'serve' ? [inspectAttr(), react()] : [react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      // Menggunakan cara modern ESM (bebas dari error __dirname di Vercel)
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',      // Menentukan folder output secara eksplisit
    emptyOutDir: true,   // Memaksa Vite membersihkan folder dist sebelum menulis file baru
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/monaco-editor')) return 'monaco'
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts'
          if (id.includes('node_modules/lightweight-charts')) return 'tvcharts'
        },
      },
    },
  },
}));
