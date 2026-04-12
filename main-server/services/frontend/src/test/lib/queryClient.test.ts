import { describe, it, expect } from 'vitest'
import { queryClient } from '@/lib/queryClient'
import { QueryClient } from '@tanstack/react-query'

describe('queryClient', () => {
  it('QueryClient 인스턴스', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })

  it('staleTime=30_000', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.queries?.staleTime).toBe(30_000)
  })

  it('gcTime=300_000', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.queries?.gcTime).toBe(300_000)
  })

  it('retry=1', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.queries?.retry).toBe(1)
  })

  it('refetchOnWindowFocus=false', () => {
    const opts = queryClient.getDefaultOptions()
    expect(opts.queries?.refetchOnWindowFocus).toBe(false)
  })
})
