import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, PhoneCall } from 'lucide-react'
import toast from 'react-hot-toast'
import { describeChatError } from '@/lib/chatErrorMessage'
import { streamGuestMessage, type HelpSessionResponse } from '@/api/help'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatMessageView, StreamingAssistantMessage } from '@/components/chat/ChatMessage'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { GuestEscalateButton } from '@/components/help/GuestEscalateButton'
import { GuestRecentSessions } from '@/components/help/GuestRecentSessions'
import { GuestSystemGrid } from '@/components/help/GuestSystemGrid'
import { HelpVisitorForm } from '@/components/help/HelpVisitorForm'
import { helpApi } from '@/api/help'
import { addOrUpdateSession, loadCache, wipeCache, type SessionMeta } from '@/lib/guestSessionCache'
import type { ChatMessage, ChatStreamEvent } from '@/types/chat'
import { cn } from '@/lib/utils'
import { NeuButton } from '@/components/neumorphic/NeuButton'

type Phase = 'visitor_form' | 'recent_sessions' | 'system_select' | 'chat' | 'escalated'

interface StreamingToolState {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  running: boolean
  thought?: string
}

let _msgSeq = 0
function newMsgId() {
  return `local-${Date.now()}-${++_msgSeq}`
}

const GUEST_PROMPTS = [
  { category: '운영 정책', prompt: 'VIP 등급 기준이 무엇인가요?' },
  { category: '처리 절차', prompt: '장애 발생 시 보고 절차를 알려주세요.' },
  { category: '매뉴얼', prompt: '시스템 점검 일정은 어떻게 확인하나요?' },
  { category: '문의 방법', prompt: '담당자에게 긴급 연락하는 방법은?' },
]

export function GuestEntryPage() {
  const [phase, setPhase] = useState<Phase>('visitor_form')
  const [session, setSession] = useState<HelpSessionResponse | null>(null)
  const [selectedSystemIds, setSelectedSystemIds] = useState<number[]>([])
  const [incidentId, setIncidentId] = useState<number | null>(null)
  const [cachedSessions, setCachedSessions] = useState<SessionMeta[]>([])

  // 채팅 상태 (로컬, DB 미동기화)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [prefill, setPrefill] = useState<{ content: string; nonce: number } | undefined>()

  // 자주 묻는 질문
  const [frequentQuestions, setFrequentQuestions] = useState<string[]>([])

  // 시스템명 매핑 (헤더 친근 톤 노출용 — chat phase에서 한 번 로드)
  const [systemMap, setSystemMap] = useState<Map<number, string>>(new Map())

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (phase === 'chat') {
      helpApi
        .getFrequentQuestions(6)
        .then((r) => setFrequentQuestions(r.questions.map((q) => q.content)))
        .catch(() => {})

      // 시스템 이름 매핑 — 헤더에 "{system_names} 관련 질문에 답해드려요" 표시용
      if (systemMap.size === 0) {
        helpApi
          .getSystems()
          .then((systems) => {
            const m = new Map<number, string>()
            systems.forEach((s) => m.set(s.id, s.display_name))
            setSystemMap(m)
          })
          .catch(() => {})
      }
    }
  }, [phase, systemMap.size])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamText, streamingTools.length])

  useEffect(() => () => abortRef.current?.abort(), [])

  /**
   * phase 전환을 브라우저 history와 동기화.
   * - 뒤로가기 시 popstate 이벤트로 이전 phase로 복원
   * - visitor_form으로 돌아가면 세션 상태 모두 초기화 (의도적 새 시작)
   * - 첫 마운트 시 visitor_form을 history baseline으로 기록
   */
  const goToPhase = useCallback((next: Phase) => {
    window.history.pushState({ phase: next }, '', window.location.pathname)
    setPhase(next)
  }, [])

  useEffect(() => {
    // 첫 마운트 baseline — replaceState로 현재 entry에 phase 정보만 기록 (새 entry 생성 X)
    if (!window.history.state?.phase) {
      window.history.replaceState({ phase: 'visitor_form' }, '', window.location.pathname)
    }

    const handlePopState = (e: PopStateEvent) => {
      const restored = (e.state?.phase as Phase | undefined) ?? 'visitor_form'
      setPhase(restored)
      if (restored === 'visitor_form') {
        // 폼으로 돌아가면 깨끗한 시작 — 진행 중 SSE 취소 + 상태 초기화
        abortRef.current?.abort()
        setSession(null)
        setMessages([])
        setStreamText('')
        setStreamThought(undefined)
        setStreamingTools([])
        setCachedSessions([])
        setSelectedSystemIds([])
        setIncidentId(null)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const finishStream = useCallback(() => {
    setStreamText('')
    setStreamThought(undefined)
    setStreamingTools([])
    setIsStreaming(false)
  }, [])

  const handleEvent = useCallback((event: ChatStreamEvent) => {
    switch (event.type) {
      case 'user_saved':
        break
      case 'thought':
        setStreamThought(String((event.data as { thought?: string }).thought ?? ''))
        break
      case 'tool_call': {
        const data = event.data as { tool?: string; args?: Record<string, unknown> }
        setStreamingTools((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${prev.length}`,
            name: data.tool ?? '(unknown)',
            args: data.args ?? {},
            running: true,
          },
        ])
        break
      }
      case 'tool_result': {
        const data = event.data as { tool?: string; result?: Record<string, unknown> }
        setStreamingTools((prev) => {
          const updated = [...prev]
          const idx = updated.findIndex((t) => t.running && t.name === data.tool)
          if (idx >= 0)
            updated[idx] = { ...updated[idx], result: data.result ?? {}, running: false }
          return updated
        })
        break
      }
      case 'token': {
        const chunk = String((event.data as { chunk?: string }).chunk ?? '')
        setStreamText((prev) => prev + chunk)
        break
      }
      case 'final': {
        const content = String((event.data as { content?: string }).content ?? '')
        if (content) {
          setMessages((prev) => [
            ...prev,
            {
              id: newMsgId(),
              session_id: '',
              role: 'assistant',
              content,
              attachments: [],
              created_at: new Date().toISOString(),
            },
          ])
        }
        break
      }
      case 'error': {
        const msg = String((event.data as { message?: string }).message ?? '오류가 발생했습니다.')
        toast.error(msg)
        break
      }
      default:
        break
    }
  }, [])

  const handleEventRef = useRef(handleEvent)
  handleEventRef.current = handleEvent

  const handleSend = useCallback(
    async (content: string) => {
      if (!session || isStreaming) return
      setPrefill(undefined)
      setIsStreaming(true)
      setStreamText('')
      setStreamThought(undefined)
      setStreamingTools([])

      setMessages((prev) => [
        ...prev,
        {
          id: newMsgId(),
          session_id: session.session_id,
          role: 'user',
          content,
          attachments: [],
          created_at: new Date().toISOString(),
        },
      ])

      // localStorage 캐시 갱신 — 첫 메시지를 title로, 이후 메시지는 last_message_at만 갱신
      const trimmed = content.length > 30 ? content.slice(0, 30) + '…' : content
      const freshCache = loadCache()
      const existingMeta = freshCache?.sessions.find((m) => m.session_id === session.session_id)
      addOrUpdateSession(session.employee_id, {
        session_id: session.session_id,
        title: existingMeta?.title ?? trimmed,
        created_at: existingMeta?.created_at ?? new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        system_ids: selectedSystemIds,
      })

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamGuestMessage(
          session.session_id,
          content,
          (ev) => handleEventRef.current(ev),
          controller.signal,
        )
      } catch (err) {
        const msg = describeChatError(err)
        if (msg) toast.error(msg)
      } finally {
        finishStream()
      }
    },
    [session, isStreaming, finishStream, selectedSystemIds],
  )

  const handleSessionCreated = (s: HelpSessionResponse) => {
    const cache = loadCache()
    if (cache && cache.visitor_employee_id === s.employee_id && cache.sessions.length > 0) {
      setCachedSessions(cache.sessions)
      setSession(s)
      goToPhase('recent_sessions')
    } else {
      setSession(s)
      goToPhase('system_select')
    }
  }

  const handleResume = useCallback(
    async (sessionId: string) => {
      if (!session) return
      try {
        const meta = cachedSessions.find((m) => m.session_id === sessionId)
        const restored = await helpApi.getMessages(sessionId, session.employee_id)
        setMessages(restored)
        setSession({
          session_id: sessionId,
          employee_id: session.employee_id,
          system_id: meta?.system_ids?.[0] ?? null,
        })
        setSelectedSystemIds(meta?.system_ids ?? [])
        goToPhase('chat')
      } catch {
        toast.error('이전 대화를 불러오지 못했습니다.')
      }
    },
    [session, cachedSessions, goToPhase],
  )

  const handleStartNew = () => {
    goToPhase('system_select')
  }

  const handleWipeAll = () => {
    wipeCache()
    setCachedSessions([])
    goToPhase('system_select')
  }

  const handleSystemSelected = (systemIds: number[]) => {
    setSelectedSystemIds(systemIds)
    goToPhase('chat')
  }

  const handleEscalated = (id: number) => {
    setIncidentId(id)
    goToPhase('escalated')
  }

  if (phase === 'visitor_form') {
    return <HelpVisitorForm onSuccess={handleSessionCreated} />
  }

  if (phase === 'recent_sessions') {
    return (
      <GuestRecentSessions
        sessions={cachedSessions}
        employeeId={session?.employee_id ?? ''}
        onResume={handleResume}
        onStartNew={handleStartNew}
        onWipe={handleWipeAll}
      />
    )
  }

  if (phase === 'system_select') {
    return <GuestSystemGrid onSelect={handleSystemSelected} />
  }

  if (phase === 'escalated') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <CheckCircle className="text-normal mb-4 h-12 w-12" />
        <h2 className="text-text-primary mb-2 text-lg font-semibold">담당자 접수 완료</h2>
        <p className="text-text-secondary text-sm">
          문의가 접수되었습니다.
          {incidentId && (
            <span className="text-text-primary font-medium"> (접수번호 #{incidentId})</span>
          )}
        </p>
        <p className="text-text-secondary mt-1 text-sm">담당자가 확인 후 연락드릴 예정입니다.</p>
        <NeuButton
          variant="secondary"
          size="sm"
          className="mt-6"
          onClick={() => {
            setIncidentId(null)
            goToPhase('chat')
          }}
        >
          채팅으로 돌아가기
        </NeuButton>
      </div>
    )
  }

  // phase === 'chat'
  return (
    <div className="flex h-screen flex-col">
      {/* 헤더 */}
      <div className="border-border bg-surface flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-text-primary text-sm font-semibold">어떤 도움이 필요하세요?</h1>
          <p className="text-text-secondary text-xs">
            {(() => {
              if (selectedSystemIds.length === 0) {
                return '전체 시스템 관련 질문에 답해드려요'
              }
              const names = selectedSystemIds
                .map((id) => systemMap.get(id))
                .filter(Boolean) as string[]
              if (names.length === 0) {
                return `${selectedSystemIds.length}개 시스템 관련 질문에 답해드려요`
              }
              if (names.length === 1) return `${names[0]} 관련 질문에 답해드려요`
              return `${names[0]} 외 ${names.length - 1}개 시스템 관련 질문에 답해드려요`
            })()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleWipeAll}
            className="text-text-disabled hover:text-critical focus:ring-accent rounded-sm px-2 py-1.5 text-xs transition-colors focus:ring-1 focus:outline-none"
          >
            기록 삭제
          </button>
          {session && (
            <GuestEscalateButton sessionId={session.session_id} onEscalated={handleEscalated} />
          )}
        </div>
      </div>

      {/* 메시지 영역 */}
      <div ref={scrollRef} className="bg-bg-base flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !isStreaming && (
          <div className="mt-4 px-1">
            <p className="text-text-primary mb-3 text-center text-sm font-medium">
              어떤 도움이 필요하신가요?
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {GUEST_PROMPTS.map(({ category, prompt }) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  className={cn(
                    'border-border rounded-sm border p-3 text-left transition-colors',
                    'hover:bg-accent-muted hover:border-accent',
                    'focus:ring-accent focus:ring-1 focus:outline-none',
                  )}
                >
                  <div className="text-text-secondary mb-1 text-xs">{category}</div>
                  <div className="text-text-primary text-sm">{prompt}</div>
                </button>
              ))}
            </div>
            {frequentQuestions.length > 0 && (
              <div className="mt-4">
                <p className="text-text-secondary mb-2 text-xs font-medium">자주 묻는 질문</p>
                <div className="flex flex-wrap gap-2">
                  {frequentQuestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPrefill({ content: q, nonce: Date.now() })}
                      className={cn(
                        'border-border text-text-secondary rounded-sm border px-2.5 py-1.5 text-xs',
                        'hover:border-accent hover:text-text-primary transition-colors',
                      )}
                    >
                      {q.length > 30 ? q.slice(0, 30) + '…' : q}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <ChatMessageView key={m.id} message={m} sessionId={session?.session_id ?? ''} />
        ))}

        {streamingTools.map((t) => (
          <ToolCallCard
            key={t.id}
            toolName={t.name}
            args={t.args}
            result={t.result}
            running={t.running}
            thought={t.thought}
          />
        ))}

        {isStreaming && (streamText || streamThought) && (
          <StreamingAssistantMessage content={streamText} running thought={streamThought} />
        )}
      </div>

      {/* 에스컬레이션 힌트 (메시지가 있을 때) */}
      {messages.length > 0 && (
        <div className="border-border flex items-center justify-end gap-2 border-t px-3 py-1.5">
          <PhoneCall className="text-text-disabled h-3.5 w-3.5" />
          <span className="text-text-disabled text-xs">원하는 답변을 못 찾으셨나요?</span>
          {session && (
            <GuestEscalateButton sessionId={session.session_id} onEscalated={handleEscalated} />
          )}
        </div>
      )}

      <ChatComposer
        disabled={!session}
        streaming={isStreaming}
        attachments={[]}
        uploadingCount={0}
        onAddFiles={() => {}}
        onRemoveAttachment={() => {}}
        onSend={handleSend}
        showAttach={false}
        prefillValue={prefill}
      />
    </div>
  )
}
