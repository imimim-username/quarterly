import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['@graphiql/react', 'graphql', 'react', 'react-dom'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8790'
    }
  }
})
