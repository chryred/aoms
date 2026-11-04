import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import os from 'os'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 가장 무거운 테스트(ApmLivePage 위젯 12~30개 렌더)도 단독 실행 시 2.3초 미만이다. 워커 다수가 CPU 를
    // 나눠 쓸 때 기본 5초 상한을 넘기는 오탐만 막는 안전망이며, 테스트 자체의 타이밍 의존은 별도로 제거했다.
    // 워커를 코어 수만큼 띄우면 jsdom+대형 import 가 CPU 를 서로 빼앗아 개별 테스트가 늘어진다 — 절반만 사용
    maxWorkers: Math.max(2, Math.floor(os.availableParallelism() / 2)),
    testTimeout: 15000,
    hookTimeout: 15000,
    // stubGlobal(ResizeObserver/rAF/matchMedia 등)을 쓴 테스트가 afterEach 를 빼먹어도 다음 테스트로 새지 않게 한다
    unstubGlobals: true,
    unstubEnvs: true,
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
      '/t/': 'http://localhost:8330',
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
