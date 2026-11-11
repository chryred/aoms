import { describe, it, expect } from 'vitest'
import {
  buildQueriedSystemNames,
  describeScope,
  describeScopeChip,
  sameIdSet,
} from '@/lib/chatScope'
import { isSameKstDay } from '@/lib/utils'
import type { ChatMessage } from '@/types/chat'

const systems = [
  { id: 1, system_name: 'pay', display_name: '결제' },
  { id: 2, system_name: 'crm', display_name: 'CRM' },
  { id: 3, system_name: 'pos', display_name: 'POS' },
  { id: 4, system_name: 'erp', display_name: 'ERP' },
]

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm',
  session_id: 's',
  role: 'assistant',
  content: '',
  attachments: [],
  created_at: '2026-11-10T00:00:00',
  ...over,
})

describe('describeScope (SSE scope 이벤트 표시)', () => {
  it('source=session → "기본 범위: {이름}"', () => {
    expect(
      describeScope({
        source: 'session',
        systems: [{ id: 1, system_name: 'pay', display_name: '결제' }],
      }),
    ).toBe('기본 범위: 결제')
  })
  it('source=screen → "현재 화면({이름}) 기준"', () => {
    expect(
      describeScope({
        source: 'screen',
        systems: [{ id: 1, system_name: 'pay', display_name: '결제' }],
      }),
    ).toBe('현재 화면(결제) 기준')
  })
  it('source=all → "전체 시스템 기준"', () => {
    expect(describeScope({ source: 'all', systems: [] })).toBe('전체 시스템 기준')
  })
  it('이벤트가 없으면 null', () => {
    expect(describeScope(null)).toBeNull()
  })
})

describe('buildQueriedSystemNames (지난 답변 "조회: …")', () => {
  it('같은 턴 tool 메시지의 system_id 를 이름으로 모은다(중복 제거)', () => {
    const map = buildQueriedSystemNames(
      [
        msg({ id: 'u1', role: 'user' }),
        msg({ id: 't1', role: 'tool', system_id: 1 }),
        msg({ id: 't2', role: 'tool', system_id: 2 }),
        msg({ id: 't3', role: 'tool', system_id: 1 }),
        msg({ id: 'a1', role: 'assistant' }),
        msg({ id: 'u2', role: 'user' }),
        msg({ id: 'a2', role: 'assistant' }),
      ],
      systems,
    )
    expect(map.get('a1')).toEqual(['결제', 'CRM'])
    expect(map.has('a2')).toBe(false) // 조회 시스템이 없으면 표시 안 함
  })
  it('알 수 없는 system_id 는 건너뛴다', () => {
    const map = buildQueriedSystemNames(
      [msg({ id: 't', role: 'tool', system_id: 99 }), msg({ id: 'a', role: 'assistant' })],
      systems,
    )
    expect(map.has('a')).toBe(false)
  })
})

describe('describeScopeChip', () => {
  it('담당 시스템과 같으면 "담당 시스템: 결제·CRM"', () => {
    expect(describeScopeChip([1, 2], [2, 1], systems)).toBe('담당 시스템: 결제·CRM')
  })
  it('담당과 다르면 "선택 시스템"', () => {
    expect(describeScopeChip([3], [1, 2], systems)).toBe('선택 시스템: POS')
  })
  it('빈 배열이면 "전체 시스템"', () => {
    expect(describeScopeChip([], [1], systems)).toBe('전체 시스템')
  })
  it('4개 이상이면 외 N 으로 줄인다', () => {
    expect(describeScopeChip([1, 2, 3, 4], [1, 2, 3, 4], systems)).toBe(
      '담당 시스템: 결제·CRM·POS 외 1',
    )
  })
  it('sameIdSet 은 순서와 무관', () => {
    expect(sameIdSet([1, 2], [2, 1])).toBe(true)
    expect(sameIdSet([1], [1, 2])).toBe(false)
  })
})

describe('isSameKstDay — KST 자정 경계', () => {
  // KST 2026-11-10 00:00 == UTC 2026-11-09T15:00
  const now = new Date('2026-11-10T00:30:00+09:00')
  it('KST 자정 직후 생성분은 오늘', () => {
    expect(isSameKstDay('2026-11-09T15:00:00', now)).toBe(true)
  })
  it('KST 자정 1초 전(UTC 14:59:59) 생성분은 어제', () => {
    expect(isSameKstDay('2026-11-09T14:59:59', now)).toBe(false)
  })
  it('UTC 날짜는 같아도 KST 로는 다른 날이면 오늘이 아니다', () => {
    expect(isSameKstDay('2026-11-10T01:00:00', new Date('2026-11-09T23:59:00+09:00'))).toBe(false)
  })
  it('Z 접미사가 있어도 동일하게 판정', () => {
    expect(isSameKstDay('2026-11-09T15:00:00Z', now)).toBe(true)
  })
})
