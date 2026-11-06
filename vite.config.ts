import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' + HashRouter means the build works on any GitHub Pages path
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
} as any)
