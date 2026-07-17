import { defineConfig } from 'vite'

export default defineConfig({
  base: '/AIS_viewer/',
  build: {
    outDir: 'dist/client',
    target: 'esnext',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
