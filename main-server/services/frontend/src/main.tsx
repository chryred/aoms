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
  (window as unknown as Record<string, unknown>).__qc = queryClient
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
            background: '#E8EBF0',
            color: '#1A1F2E',
            borderRadius: '12px',
            boxShadow: '6px 6px 12px #C8CBD4, -6px -6px 12px #FFFFFF',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#16A34A', secondary: '#E8EBF0' },
          },
          error: {
            iconTheme: { primary: '#DC2626', secondary: '#E8EBF0' },
          },
        }}
      />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>
)
