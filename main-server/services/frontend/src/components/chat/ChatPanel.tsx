import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { usePatchChatSession } from '@/hooks/mutations/usePatchChatSession'
import { useChatPromptCategories } from '@/hooks/queries/useChatPromptCategories'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatScope } from '@/hooks/useChatScope'
import { useChatSessionBootstrap } from '@/hooks/useChatSessionBootstrap'
import { useChatStreaming } from '@/hooks/useChatStreaming'
import { useChatContextNotice } from '@/hooks/useChatContextNotice'
import { useScreenContext } from '@/hooks/useScreenContext'
import { useChatStore } from '@/store/chatStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { ROUTES } from '@/constants/routes'
import type { ChatMessage } from '@/types/chat'
import { cn } from '@/lib/utils'
import { buildQueriedSystemNames, describeScope } from '@/lib/chatScope'
import { getContextualPrompts } from '@/config/chatPrompts'
import { useIncidentNextAction } from '@/hooks/queries/useIncidentNextAction'
import { Sparkles } from 'lucide-react'
import { ChatComposer } from './ChatComposer'
import { ChatContextNotice } from './ChatContextNotice'
import { ChatHeader } from './ChatHeader'
import { ChatMessageView, StreamingAssistantMessage } from './ChatMessage'
import { ToolCallCard } from './ToolCallCard'

const RECENT_SESSION_LIMIT = 10

export function ChatPanel() {
  const navigate = useNavigate()
  const isOpen = useChatStore((s) => s.isOpen)
  const setOpen = useChatStore((s) => s.setOpen)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)
  const setThinking = useChatStore((s) => s.setThinking)
  const resetUnread = useChatStore((s) => s.resetUnread)
  const incrementUnread = useChatStore((s) => s.incrementUnread)
  const autoInsightIncidentId = useChatStore((s) => s.autoInsightIncidentId)
  const setAutoInsightIncidentId = useChatStore((s) => s.setAutoInsightIncidentId)

  // 화면 컨텍스트는 렌더마다 최신 값이며, 전송하는 순간의 값이 서버로 간다(useChatStreaming).
  // 여기서 쓰는 값은 시작 화면의 칩·자동 분석 버튼 표시용.
  const screenContext = useScreenContext()

  // Feature 5C-1: 인시던트 컨텍스트가 있을 때 next_action_meta 조회 → status별 prompt chip
  const { data: nextActionMeta } = useIncidentNextAction(screenContext.incident_id)
  const incidentStatus = nextActionMeta?.status ?? null

  const { data: systems = [] } = useSystems()
  const patchSession = usePatchChatSession()
  const { scopeIds, primaryIds, ready: scopeReady, saveScope } = useChatScope()

  // 열 때마다: 오늘(KST) 대화가 아니면 새 대화, 빈 오늘 대화는 재사용. 생성은 이 훅 한 곳에서만.
  const {
    ready: sessionReady,
    sessions,
    startNewSession,
  } = useChatSessionBootstrap({ active: isOpen, scopeIds, scopeReady })

  const {
    attachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    readyKeys,
    isUploading,
  } = useChatAttachments(currentSessionId)

  const promptCategories = useChatPromptCategories()

  const { data: messages, isError: isMessagesError } = useChatMessages(currentSessionId)

  // localStorage에 남은 삭제된 세션 ID 무효화 — messages 404 감지 시 초기화
  useEffect(() => {
    if (isMessagesError && currentSessionId) {
      setCurrentSessionId(null)
    }
  }, [isMessagesError, currentSessionId, setCurrentSessionId])

  const {
    streamText,
    streamThought,
    streamingTools,
    streamImages,
    streamScope,
    isStreaming,
    isStreamingRef,
    lastSentContentRef,
    abortRef,
    handleSend,
    handleAutoInsight,
    handleRetry,
    abortStream,
  } = useChatStreaming({
    currentSessionId,
    screenContext,
    readyKeys,
    clearAttachments,
    messages,
    onStreamEnd: () => {
      if (!isOpen) incrementUnread()
    },
  })

  const [restoreValue, setRestoreValue] = useState<{ content: string; nonce: number } | undefined>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  // 스트리밍 상태 → 마스코트 thinking 동기화
  useEffect(() => {
    setThinking(isStreaming)
  }, [isStreaming, setThinking])

  // 패널 열릴 때 미읽은 카운트 초기화
  useEffect(() => {
    if (isOpen) resetUnread()
  }, [isOpen, resetUnread])

  // 닫기 전 포커스를 외부로 이동 — aria-hidden 적용 시 포커스 잔류 경고 방지
  const closePanel = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setOpen(false)
  }, [setOpen])

  // 세션이 정해지기 전(오늘 대화 판정·생성 중)에는 전송·자동 분석을 막아 어제 대화에 섞이지 않게 한다
  const canSend = !!currentSessionId && sessionReady

  // Feature G — 외부 트리거(NextActionCard 등)에서 set된 incident_id로 1회 자동 분석 발화
  useEffect(() => {
    if (!isOpen) return
    if (!canSend) return
    if (!autoInsightIncidentId) return
    if (isStreaming) return
    const id = autoInsightIncidentId
    setAutoInsightIncidentId(null)
    void handleAutoInsight(id)
  }, [
    isOpen,
    canSend,
    autoInsightIncidentId,
    isStreaming,
    setAutoInsightIncidentId,
    handleAutoInsight,
  ])

  const handleNewChat = useCallback(async () => {
    if (isStreamingRef.current) abortStream()
    const created = await startNewSession()
    if (created) clearAttachments()
  }, [isStreamingRef, abortStream, startNewSession, clearAttachments])

  const currentSession = useMemo(
    () => sessions?.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
  )

  const recentSessions = useMemo(
    () =>
      sessions
        ?.slice()
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, RECENT_SESSION_LIMIT) ?? [],
    [sessions],
  )

  // 헤더 칩은 서버가 이 대화에 실제로 쓰는 범위(세션 system_ids)를 보여준다. 아직 목록에 없으면 기본 범위.
  const shownScopeIds = currentSession?.system_ids ?? scopeIds

  // 범위 변경: 현재 세션 PATCH + 이 사용자 기본값으로 저장
  const handleScopeChange = useCallback(
    (ids: number[]) => {
      saveScope(ids)
      if (currentSessionId) {
        patchSession.mutate({ sessionId: currentSessionId, data: { system_ids: ids } })
      }
    },
    [saveScope, currentSessionId, patchSession],
  )

  const notice = useChatContextNotice({
    active: isOpen,
    currentSessionId,
    messageCount: messages?.length ?? 0,
    screenContext,
  })

  const queriedByMessage = useMemo(
    () => buildQueriedSystemNames(messages, systems),
    [messages, systems],
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
        void handleNewChat()
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
          abortStream()
          setRestoreValue({ content: lastSentContentRef.current, nonce: Date.now() })
        } else {
          closePanel()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleNewChat, closePanel, isStreamingRef, abortStream, lastSentContentRef])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 150
  }, [])

  // [1] 스트리밍 토큰: rAF로 프레임당 1회 병합 (토큰마다 즉시 scrollTo 방지)
  useEffect(() => {
    if (userScrolledUpRef.current) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      rafRef.current = null
    })
  }, [streamText, streamingTools.length])

  // [2] 메시지 목록·스트리밍 상태 전환: 저빈도 이벤트 → smooth/instant
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isStreaming && userScrolledUpRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? 'instant' : 'smooth' })
  }, [messages?.length, isStreaming])

  // [3] 언마운트 시 rAF 정리
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // 언마운트 시 스트림 취소 (닫기는 백그라운드 유지)
  useEffect(() => {
    const ref = abortRef
    return () => {
      ref.current?.abort()
    }
  }, [abortRef])

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
          scopeSystemIds={shownScopeIds}
          primarySystemIds={primaryIds}
          onScopeChange={handleScopeChange}
          onViewAll={() => {
            closePanel()
            navigate(ROUTES.CHAT)
          }}
        />

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="bg-bg-base flex-1 space-y-3 overflow-y-auto px-3 py-3"
        >
          {(!currentSessionId || !messages || messages.length === 0) && !isStreaming && (
            <div className="mt-4 px-1">
              <p className="text-text-primary mb-3 text-center text-sm font-medium">
                어떤 도움이 필요하신가요?
              </p>

              {/* Feature 5C-2: 인시던트 자동 분석 버튼 — incident_id 있을 때만 표시 */}
              {screenContext?.incident_id && (
                <button
                  type="button"
                  onClick={() => {
                    const id = parseInt(String(screenContext.incident_id ?? '0'), 10)
                    if (id > 0) handleAutoInsight(id)
                  }}
                  disabled={isStreaming || !canSend}
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
                const contextualChips = getContextualPrompts(screenContext?.screen, incidentStatus)
                if (!screenContext?.screen || contextualChips.length === 0) return null
                return (
                  <div className="mb-3">
                    {screenContext.screen_label && (
                      <p className="text-text-secondary mb-1.5 text-[11px]">
                        현재 화면: {screenContext.screen_label}
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
                          disabled={isStreaming || !canSend}
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
                          disabled={isStreaming || !canSend}
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
          {notice.show && (
            <ChatContextNotice
              onNewChat={() => {
                notice.dismiss()
                void handleNewChat()
              }}
              onContinue={notice.dismiss}
            />
          )}
          {messages?.map((m: ChatMessage) => (
            <ChatMessageView
              key={m.id}
              message={m}
              sessionId={currentSessionId ?? ''}
              onRetry={handleRetry}
              queriedSystems={queriedByMessage.get(m.id)}
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
              scopeLabel={describeScope(streamScope)}
            />
          )}
        </div>

        <ChatComposer
          disabled={!canSend}
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
