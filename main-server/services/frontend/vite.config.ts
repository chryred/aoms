import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/**',
        'src/test/**',
        'src/main.tsx',
        '**/*.d.ts',
        'src/types/**',
        'vite.config.ts',
        'eslint.config.js',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
  },
  server: {
    host: true,
    port: 3001,
    proxy: {
      '/api/v1/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      '/api': 'http://localhost:8080',
      // OIDC IdP endpoints (백엔드). /oauth/login 은 프론트엔드 SPA 라우트라 제외.
      '/oauth/authorize': 'http://localhost:8080',
      '/oauth/token': 'http://localhost:8080',
      '/oauth/userinfo': 'http://localhost:8080',
      '/oauth/jwks': 'http://localhost:8080',
      '/.well-known/openid-configuration': 'http://localhost:8080',
      '/analyze': 'http://localhost:8000',
      '/aggregation': 'http://localhost:8000',
      '/grafana/': 'http://localhost:3000',
      '/qdrant': {
        target: process.env.QDRANT_URL ?? 'http://localhost:6333',
        rewrite: (path: string) => path.replace(/^\/qdrant/, ''),
      },
    },
  },
})
