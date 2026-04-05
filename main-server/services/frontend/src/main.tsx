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
            background: '#1E2127',
            color: '#E2E8F2',
            borderRadius: '12px',
            boxShadow: '3px 3px 7px #111317, -3px -3px 7px #2B2F37',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#22C55E', secondary: '#1E2127' },
          },
          error: {
            iconTheme: { primary: '#EF4444', secondary: '#1E2127' },
          },
        }}
      />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
)
