import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'react-hot-toast'
import { queryClient } from '@/lib/queryClient'
import { App } from './App'
import './index.css'

// 테스트 전용: dev 환경에서 queryClient를 window에 노출
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__qc = queryClient
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            borderRadius: '4px',
            boxShadow: 'var(--shadow-neu-flat)',
            fontSize: '14px',
          },
          success: {
            iconTheme: {
              primary: 'var(--color-normal)',
              secondary: 'var(--color-surface)',
            },
          },
          error: {
            iconTheme: {
              primary: 'var(--color-critical)',
              secondary: 'var(--color-surface)',
            },
          },
        }}
      />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
)
