import { describe, it, expect, vi, beforeEach } from 'vitest'

// ky 모킹 (vi.mock 호이스팅 주의 - vi.fn() 직접 사용)
vi.mock('ky', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(() => ({ json: vi.fn().mockResolvedValue({}) })),
      post: vi.fn(() => ({ json: vi.fn().mockResolvedValue({}) })),
    })),
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ token: 'test-token' })),
  },
}))

describe('logAnalyzerSearchApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('모듈 로드 성공', async () => {
    const module = await import('@/api/logAnalyzer')
    expect(module.logAnalyzerSearchApi).toBeDefined()
    expect(typeof module.logAnalyzerSearchApi.similarSearch).toBe('function')
    expect(typeof module.logAnalyzerSearchApi.getCollectionInfo).toBe('function')
    expect(typeof module.logAnalyzerSearchApi.getAggregationStatus).toBe('function')
  })
})
