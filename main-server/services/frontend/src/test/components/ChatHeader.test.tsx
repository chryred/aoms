import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('@/components/mascot', () => ({
  Synap: () => null,
  SynapMini: () => null,
}))

import { ChatHeader } from '@/components/chat/ChatHeader'
import { StreamingAssistantMessage, ChatMessageView } from '@/components/chat/ChatMessage'
import type { System } from '@/types/system'
import type { ChatSession } from '@/types/chat'

const systems = [
  { id: 1, system_name: 'pay', display_name: '결제' },
  { id: 2, system_name: 'crm', display_name: 'CRM' },
] as System[]

const session = (id: string, title: string): ChatSession => ({
  id,
  title,
  area_code: 'chat_assistant',
  system_ids: [],
  created_at: '2026-11-10T00:00:00',
  updated_at: new Date().toISOString().slice(0, 19),
})

const base = {
  title: '새 대화',
  onNewChat: () => {},
  systems,
  primarySystemIds: [1, 2],
  onScopeChange: () => {},
}

describe('ChatHeader — 범위 칩', () => {
  it('담당 시스템이면 "담당 시스템: 결제·CRM" 칩을 보이고 툴팁을 단다', () => {
    render(<ChatHeader {...base} scopeSystemIds={[1, 2]} />)
    const chip = screen.getByRole('button', { name: /담당 시스템: 결제·CRM/ })
    expect(chip).toHaveAttribute('title', expect.stringContaining('시스템 이름을 쓰거나'))
  })

  it('범위가 비면 "전체 시스템"', () => {
    render(<ChatHeader {...base} scopeSystemIds={[]} />)
    expect(screen.getByRole('button', { name: /전체 시스템/ })).toBeInTheDocument()
  })

  it('칩을 누르면 시스템 선택이 펼쳐지고 바꾼 값이 전달된다', async () => {
    const onScopeChange = vi.fn()
    render(<ChatHeader {...base} scopeSystemIds={[1]} onScopeChange={onScopeChange} />)
    await userEvent.click(screen.getByRole('button', { name: /선택 시스템: 결제/ }))
    // 펼쳐진 SystemMultiSelect 에서 CRM 을 추가
    await userEvent.click(screen.getByRole('button', { name: /^결제$/ }))
    await userEvent.click(screen.getByRole('option', { name: 'CRM' }))
    expect(onScopeChange).toHaveBeenCalledWith([1, 2])
  })
})

describe('ChatHeader — 세션 드롭다운', () => {
  it('세션이 1개여도 선택 버튼을 보이고 "전체 대화 보기"가 있다', async () => {
    const onViewAll = vi.fn()
    render(
      <ChatHeader
        {...base}
        title="첫 대화"
        scopeSystemIds={[]}
        sessions={[session('a', '첫 대화')]}
        currentSessionId="a"
        onSessionSelect={() => {}}
        onViewAll={onViewAll}
      />,
    )
    await userEvent.click(screen.getByText('첫 대화'))
    await userEvent.click(screen.getByRole('button', { name: '전체 대화 보기' }))
    expect(onViewAll).toHaveBeenCalledTimes(1)
  })
})

describe('범위 표시 라벨', () => {
  it('스트리밍 답변 위에 scope 라벨을 보인다', () => {
    render(<StreamingAssistantMessage content="" running scopeLabel="기본 범위: 결제" />)
    expect(screen.getByText('기본 범위: 결제')).toBeInTheDocument()
  })

  it('지난 답변 위에 "조회: 결제, CRM" 을 보인다', () => {
    render(
      <ChatMessageView
        sessionId="s"
        queriedSystems={['결제', 'CRM']}
        message={{
          id: 'a1',
          session_id: 's',
          role: 'assistant',
          content: '정상입니다',
          attachments: [],
          created_at: '2026-11-10T00:00:00',
        }}
      />,
    )
    expect(screen.getByText('조회: 결제, CRM')).toBeInTheDocument()
  })
})
