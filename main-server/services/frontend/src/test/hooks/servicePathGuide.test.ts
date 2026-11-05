import { describe, it, expect } from 'vitest'
import { servicePathGuide } from '@/hooks/useAgentFormLogic'

describe('servicePathGuide', () => {
  it('JEUS 는 비워 두면 자동 탐지 안내를 보여준다', () => {
    const g = servicePathGuide('jeus')
    expect(g.placeholder).toBe('비워 두면 자동 탐지')
    expect(g.hint).toBe('비워 두면 실행 중인 JEUS 에서 자동 탐지 (jeus.home/domains/도메인명)')
  })

  it('다른 서비스 유형은 기존 placeholder 를 유지하고 힌트가 없다', () => {
    expect(servicePathGuide('tomcat')).toEqual({ placeholder: '~/tomcat', hint: null })
    expect(servicePathGuide('jboss')).toEqual({ placeholder: '~/jboss', hint: null })
  })
})
