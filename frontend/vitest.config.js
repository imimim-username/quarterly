import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,                         // CSS imports are no-ops in unit tests
    setupFiles: './src/test-setup.js',
  },
})
