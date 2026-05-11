import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { describeChatError } from '@/lib/chatErrorMessage'
import { useQueryClient } from '@tanstack/react-query'
import { streamAutoInsight, streamChatMessage } from '@/api/chat'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import { useCreateChatSession } from '@/hooks/mutations/useCreateChatSession'
import { usePatchChatSession } from '@/hooks/mutations/usePatchChatSession'
import { useChatPromptCategories } from '@/hooks/queries/useChatPromptCategories'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatStore } from '@/store/chatStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { qk } from '@/constants/queryKeys'
import type { ChatMessage, ChatStreamEvent, MessageImage, ScreenContext } from '@/types/chat'
import { cn } from '@/lib/utils'
import { getContextualPrompts } from '@/config/chatPrompts'
import { useIncidentNextAction } from '@/hooks/queries/useIncidentNextAction'
import { Sparkles } from 'lucide-react'
import { ChatComposer } from './ChatComposer'
import { ChatHeader } from './ChatHeader'
import { ChatMessageView, StreamingAssistantMessage } from './ChatMessage'
import { ToolCallCard } from './ToolCallCard'

interface StreamingToolState {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  running: boolean
  thought?: string
}

export function ChatPanel() {
  const isOpen = useChatStore((s) => s.isOpen)
  const setOpen = useChatStore((s) => s.setOpen)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)
  const filterSystemIds = useChatStore((s) => s.filterSystemIds)
  const setFilterSystemIds = useChatStore((s) => s.setFilterSystemIds)
  const setThinking = useChatStore((s) => s.setThinking)
  const resetUnread = useChatStore((s) => s.resetUnread)
  const consumePendingScreenContext = useChatStore((s) => s.consumePendingScreenContext)
  const autoInsightIncidentId = useChatStore((s) => s.autoInsightIncidentId)
  const setAutoInsightIncidentId = useChatStore((s) => s.setAutoInsightIncidentId)

  // 패널이 열릴 때 1회 소비하여 로컬 state에 보관
  const [latestScreenContext, setLatestScreenContext] = useState<ScreenContext | null>(null)

  // Feature 5C-1: 인시던트 컨텍스트가 있을 때 next_action_meta 조회 → status별 prompt chip
  const { data: nextActionMeta } = useIncidentNextAction(latestScreenContext?.incident_id)
  const incidentStatus = nextActionMeta?.status ?? null

  const { data: systems = [] } = useSystems()

  const qc = useQueryClient()
  const { data: sessions } = useChatSessions(isOpen)
  const createSession = useCreateChatSession()
  const patchSession = usePatchChatSession()
  const {
    attachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    readyKeys,
    isUploading,
  } = useChatAttachments(currentSessionId)

  const promptCategories = useChatPromptCategories()

  // 세션이 없으면 열 때 자동 생성 또는 최신 세션 복원
  useEffect(() => {
    if (!isOpen) return
    if (currentSessionId) return
    if (sessions && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id)
      return
    }
    if (sessions && sessions.length === 0 && !createSession.isPending) {
      createSession.mutate(undefined, {
        onSuccess: (s) => {
          setCurrentSessionId(s.id)
          if (filterSystemIds.length > 0) {
            patchSession.mutate({ sessionId: s.id, data: { system_ids: filterSystemIds } })
          }
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentSessionId, sessions, setCurrentSessionId, createSession])

  const { data: messages } = useChatMessages(currentSessionId)

  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
  const [streamImages, setStreamImages] = useState<MessageImage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const lastSentContentRef = useRef<string>('')
  const isStreamingRef = useRef(false)
  const [restoreValue, setRestoreValue] = useState<{ content: string; nonce: number } | undefined>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

  useEffect(() => {
    isStreamingRef.current = isStreaming
  }, [isStreaming])

  // 스트리밍 상태 → 마스코트 thinking 동기화
  useEffect(() => {
    setThinking(isStreaming)
  }, [isStreaming, setThinking])

  // 패널 열릴 때 미읽은 카운트 초기화 + 컨텍스트 1회 소비
  useEffect(() => {
    if (isOpen) {
      resetUnread()
      const ctx = consumePendingScreenContext()
      if (ctx) setLatestScreenContext(ctx)
    }
  }, [isOpen, resetUnread, consumePendingScreenContext])

  // 닫기 전 포커스를 외부로 이동 — aria-hidden 적용 시 포커스 잔류 경고 방지
  const closePanel = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setOpen(false)
  }, [setOpen])

  // 스트리밍이 끝나면 message list 재조회로 화면 교체
  const finishStream = useCallback(() => {
    setStreamText('')
    setStreamThought(undefined)
    setStreamingTools([])
    setStreamImages([])
    setIsStreaming(false)
    if (currentSessionId) {
      qc.invalidateQueries({ queryKey: qk.chat.messages(currentSessionId) })
      qc.invalidateQueries({ queryKey: qk.chat.sessions() })
    }
  }, [qc, currentSessionId])

  const handleEventRef = useRef<(event: ChatStreamEvent) => void>(() => {})

  const handleSend = useCallback(
    async (content: string) => {
      if (!currentSessionId) {
        toast.error('세션이 없습니다.')
        return
      }
      if (isStreaming) return
      lastSentContentRef.current = content
      setIsStreaming(true)
      setStreamText('')
      setStreamThought(undefined)
      setStreamingTools([])
      setStreamImages([])

      // optimistic user 메시지는 서버가 user_saved 이벤트로 DB 반영 후 invalidate → 화면 표시되도록 유지
      const controller = new AbortController()
      abortRef.current = controller
      const keys = readyKeys
      clearAttachments()

      try {
        await streamChatMessage(
          currentSessionId,
          content,
          keys,
          (event: ChatStreamEvent) => {
            handleEventRef.current(event)
          },
          controller.signal,
          null,
          latestScreenContext,
        )
      } catch (err) {
        console.error(err)
        const msg = describeChatError(err)
        if (msg) toast.error(msg)
      } finally {
        finishStream()
      }
    },
    [currentSessionId, isStreaming, readyKeys, clearAttachments, finishStream, latestScreenContext],
  )

  // Feature 5C-2: 선제적 통찰 트리거
  const handleAutoInsight = useCallback(
    async (incidentId: number) => {
      if (!currentSessionId) {
        toast.error('세션이 없습니다.')
        return
      }
      if (isStreaming) return

      setIsStreaming(true)
      setStreamText('')
      setStreamThought(undefined)
      setStreamingTools([])
      setStreamImages([])

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await streamAutoInsight(
          currentSessionId,
          incidentId,
          (event: ChatStreamEvent) => {
            handleEventRef.current(event)
          },
          controller.signal,
          latestScreenContext,
        )
      } catch (err) {
        console.error(err)
        const msg = describeChatError(err)
        if (msg) toast.error(msg)
      } finally {
        finishStream()
      }
    },
    [currentSessionId, isStreaming, finishStream, latestScreenContext],
  )

  // Feature G — 외부 트리거(NextActionCard 등)에서 set된 incident_id로 1회 자동 분석 발화
  useEffect(() => {
    if (!isOpen) return
    if (!currentSessionId) return
    if (!autoInsightIncidentId) return
    if (isStreaming) return
    const id = autoInsightIncidentId
    setAutoInsightIncidentId(null)
    void handleAutoInsight(id)
  }, [
    isOpen,
    currentSessionId,
    autoInsightIncidentId,
    isStreaming,
    setAutoInsightIncidentId,
    handleAutoInsight,
  ])

  const handleEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
      case 'auto_insight_start':
        // Feature 5C-2: 자동 분석 시작 시그널 — 현재는 별도 처리 없음 (향후 토스트/스피너 추가 가능)
        break
      case 'user_saved':
        if (currentSessionId) {
          qc.invalidateQueries({ queryKey: qk.chat.messages(currentSessionId) })
        }
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
            thought: streamThought,
          },
        ])
        break
      }
      case 'tool_result': {
        const data = event.data as {
          tool?: string
          result?: Record<string, unknown>
        }
        setStreamingTools((prev) => {
          if (prev.length === 0) return prev
          const updated = [...prev]
          const idx = updated.findIndex((t) => t.running && t.name === data.tool)
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              result: data.result ?? {},
              running: false,
            }
          }
          return updated
        })
        break
      }
      case 'token': {
        const chunk = String((event.data as { chunk?: string }).chunk ?? '')
        setStreamText((prev) => prev + chunk)
        break
      }
      case 'meta': {
        const data = event.data as { images?: MessageImage[]; guide_ids?: string[] }
        if (Array.isArray(data.images) && data.images.length > 0) {
          setStreamImages(data.images)
        }
        break
      }
      case 'final':
        // finishStream이 finally에서 실행됨. 여기선 빈 처리.
        break
      case 'error': {
        const msg = String((event.data as { message?: string }).message ?? '알 수 없는 오류')
        toast.error(msg)
        break
      }
      default:
        break
    }
  }
  handleEventRef.current = handleEvent

  const handleNewChat = useCallback(() => {
    if (isStreaming) {
      abortRef.current?.abort()
    }
    createSession.mutate(undefined, {
      onSuccess: (s) => {
        setCurrentSessionId(s.id)
        clearAttachments()
        if (filterSystemIds.length > 0) {
          patchSession.mutate({ sessionId: s.id, data: { system_ids: filterSystemIds } })
        }
      },
    })
  }, [
    createSession,
    isStreaming,
    setCurrentSessionId,
    clearAttachments,
    filterSystemIds,
    patchSession,
  ])

  const currentSession = useMemo(
    () => sessions?.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
  )

  const recentSessions = useMemo(
    () =>
      sessions
        ?.slice()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5) ?? [],
    [sessions],
  )

  const handleRetry = useCallback(
    (failedMessageId: string) => {
      if (!messages || isStreaming) return
      const failedIdx = messages.findIndex((m) => m.id === failedMessageId)
      if (failedIdx <= 0) return
      let userIdx = failedIdx - 1
      while (userIdx >= 0 && messages[userIdx].role !== 'user') {
        userIdx--
      }
      if (userIdx < 0) return
      const userContent = messages[userIdx].content
      if (!userContent.trim()) return
      handleSend(userContent)
    },
    [messages, isStreaming, handleSend],
  )

  // filterSystemIds 변경 시 현재 세션에 PATCH
  const handleFilterChange = useCallback(
    (ids: number[]) => {
      setFilterSystemIds(ids)
      if (currentSessionId) {
        patchSession.mutate({ sessionId: currentSessionId, data: { system_ids: ids } })
      }
    },
    [setFilterSystemIds, currentSessionId, patchSession],
  )

  // 키보드 단축키
  useEffect(() => {
    if (!isOpen) return

    const isMac = navigator.userAgent.toUpperCase().includes('MAC')

    const handleKeyDown = (e: KeyboardEvent) => {
      const cmdKey = isMac ? e.metaKey : e.ctrlKey
      const inInput =
        e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement

      // Cmd/Ctrl+N — 새 대화 (항상)
      if (cmdKey && e.key === 'n') {
        e.preventDefault()
        handleNewChat()
        return
      }

      // / — 입력창 포커스 (입력 중 아닐 때)
      if (e.key === '/' && !inInput && !cmdKey) {
        e.preventDefault()
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="메시지를 입력하세요"]',
        )
        textarea?.focus()
        return
      }

      // Esc — 스트리밍 중이면 중단 + 복원, 아니면 패널 닫기
      if (e.key === 'Escape') {
        if (isStreamingRef.current) {
          abortRef.current?.abort()
          setRestoreValue({ content: lastSentContentRef.current, nonce: Date.now() })
        } else {
          closePanel()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleNewChat, closePanel])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 100
  }, [])

  // 새 메시지/스트림 업데이트 시 하단으로 스크롤
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 스트리밍 중 사용자가 위로 스크롤했으면 강제 이동 안 함
    if (isStreaming && userScrolledUpRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? 'instant' : 'smooth' })
  }, [messages?.length, streamText, streamingTools.length, isStreaming])

  // 언마운트/패널 닫힘 시 스트림 취소
  useEffect(() => {
    if (!isOpen) abortRef.current?.abort()
  }, [isOpen])

  // inert 속성: 닫힌 상태에서 DOM 내부 요소의 키보드 포커스 및 AT 접근 차단 (WCAG 2.1.1)
  const inertProps = !isOpen ? { inert: '' as const } : {}

  return (
    <div
      {...inertProps}
      aria-hidden={!isOpen}
      className={cn(
        'border-border',

        // === 모바일 (<lg): fixed overlay 유지 ===
        'fixed top-0 right-0 z-40 h-screen w-full',
        'shadow-side-overlay',
        'transition-transform duration-300 ease-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',

        // === 데스크탑 (lg+): push layout ===
        // 너비만 애니메이션. 내부 콘텐츠는 고정 폭 inner div가 담당하여 reflow 방지
        'lg:static lg:top-auto lg:right-auto lg:z-auto',
        'lg:h-full lg:translate-x-0 lg:shadow-none',
        'lg:overflow-hidden lg:transition-[width] lg:duration-300 lg:ease-out',
        isOpen ? 'lg:w-[420px] lg:border-l' : 'lg:w-0 lg:border-0',
      )}
    >
      <div className="bg-surface flex h-full w-full flex-col lg:w-[420px] lg:shrink-0">
        <ChatHeader
          title={currentSession?.title ?? '새 대화'}
          sessions={recentSessions}
          currentSessionId={currentSessionId}
          onSessionSelect={setCurrentSessionId}
          onNewChat={handleNewChat}
          onClose={closePanel}
          disabled={isStreaming}
          systems={systems}
          filterSystemIds={filterSystemIds}
          onFilterSystemChange={handleFilterChange}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-bg-base flex-1 space-y-3 overflow-y-auto px-3 py-3"
        >
          {messages?.length === 0 && !isStreaming && (
            <div className="mt-4 px-1">
              <p className="text-text-primary mb-3 text-center text-sm font-medium">
                어떤 도움이 필요하신가요?
              </p>

              {/* Feature 5C-2: 인시던트 자동 분석 버튼 — incident_id 있을 때만 표시 */}
              {latestScreenContext?.incident_id && (
                <button
                  type="button"
                  onClick={() => {
                    const id = parseInt(String(latestScreenContext.incident_id ?? '0'), 10)
                    if (id > 0) handleAutoInsight(id)
                  }}
                  disabled={isStreaming || !currentSessionId}
                  className={cn(
                    'bg-accent text-accent-contrast shadow-neu-flat',
                    'mb-3 flex w-full items-center justify-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium',
                    'hover:shadow-neu-pressed focus:ring-accent focus:ring-1 focus:outline-none',
                    'transition-shadow',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                  aria-label="인시던트 자동 분석 시작"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>이 인시던트 자동 분석 시작</span>
                </button>
              )}

              {/* 화면별 / 인시던트 status별 quick prompt chips */}
              {(() => {
                const contextualChips = getContextualPrompts(
                  latestScreenContext?.screen,
                  incidentStatus,
                )
                if (!latestScreenContext?.screen || contextualChips.length === 0) return null
                return (
                  <div className="mb-3">
                    {latestScreenContext.screen_label && (
                      <p className="text-text-secondary mb-1.5 text-[11px]">
                        현재 화면: {latestScreenContext.screen_label}
                        {nextActionMeta && (
                          <span className="text-accent ml-2">
                            · 인시던트: {nextActionMeta.status_ko} ({nextActionMeta.progress_pct}%)
                          </span>
                        )}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {contextualChips.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setRestoreValue({ content: chip, nonce: Date.now() })}
                          disabled={isStreaming || !currentSessionId}
                          className={cn(
                            'border-border rounded-sm border px-2.5 py-1 text-left text-xs transition-colors',
                            'text-text-secondary hover:bg-accent-muted hover:border-accent hover:text-text-primary',
                            'focus:ring-accent focus:ring-1 focus:outline-none',
                            'disabled:cursor-not-allowed disabled:opacity-40',
                          )}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}

              <div className="space-y-3">
                {promptCategories.map((group) => (
                  <div key={group.label}>
                    <p className="text-text-secondary mb-1.5 text-[11px] font-medium tracking-wide uppercase">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                      {group.items.map(({ icon: Icon, category, prompt }) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => handleSend(prompt)}
                          disabled={isStreaming || !currentSessionId}
                          className={cn(
                            'border-border rounded-sm border p-3 text-left transition-colors',
                            'hover:bg-accent-muted hover:border-accent',
                            'focus:ring-accent focus:ring-1 focus:outline-none',
                            'disabled:cursor-not-allowed disabled:opacity-40',
                          )}
                        >
                          <div className="text-text-secondary mb-1 flex items-center gap-1.5 text-xs">
                            <Icon className="h-3.5 w-3.5" />
                            <span>{category}</span>
                          </div>
                          <div className="text-text-primary text-sm">{prompt}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {messages?.map((m: ChatMessage) => (
            <ChatMessageView
              key={m.id}
              message={m}
              sessionId={currentSessionId ?? ''}
              onRetry={handleRetry}
            />
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
          {isStreaming && (
            <StreamingAssistantMessage
              content={streamText}
              running={true}
              thought={streamThought}
              images={streamImages}
            />
          )}
        </div>

        <ChatComposer
          disabled={!currentSessionId}
          streaming={isStreaming}
          attachments={attachments}
          uploadingCount={isUploading ? 1 : 0}
          onAddFiles={addFiles}
          onRemoveAttachment={removeAttachment}
          onSend={handleSend}
          prefillValue={restoreValue}
        />
      </div>
    </div>
  )
}
