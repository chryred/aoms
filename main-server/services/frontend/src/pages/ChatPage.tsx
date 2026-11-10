import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Menu, Plus, MessageSquare } from 'lucide-react'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import { useChatPromptCategories } from '@/hooks/queries/useChatPromptCategories'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useSystems } from '@/hooks/queries/useSystems'
import { usePatchChatSession } from '@/hooks/mutations/usePatchChatSession'
import { useChatPageState } from '@/hooks/useChatPageState'
import { useChatScope } from '@/hooks/useChatScope'
import { useChatSessionBootstrap } from '@/hooks/useChatSessionBootstrap'
import { useChatContextNotice } from '@/hooks/useChatContextNotice'
import { useScreenContext } from '@/hooks/useScreenContext'
import { useChatSessionManager } from '@/hooks/useChatSessionManager'
import { useChatStreaming } from '@/hooks/useChatStreaming'
import type { ChatMessage, ChatSession } from '@/types/chat'
import { cn, formatRelative } from '@/lib/utils'
import { buildQueriedSystemNames, describeScope } from '@/lib/chatScope'
import { getContextualPrompts } from '@/config/chatPrompts'
import { ROUTES } from '@/constants/routes'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatContextNotice } from '@/components/chat/ChatContextNotice'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatMessageView, StreamingAssistantMessage } from '@/components/chat/ChatMessage'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { ChatSessionSearchInput } from '@/components/chat/ChatSessionSearchInput'
import { SessionItemMenu } from '@/components/chat/SessionItemMenu'
import { SessionRenameModal } from '@/components/chat/SessionRenameModal'
import { SessionDeleteConfirmModal } from '@/components/chat/SessionDeleteConfirmModal'

export function ChatPage() {
  const navigate = useNavigate()
  const {
    currentSessionId,
    setCurrentSessionId,
    searchQ,
    setSearchQ,
    debouncedQ,
    mobileSessionListOpen,
    setMobileSessionListOpen,
    restoreValue,
    setRestoreValue,
    activeMenuSession,
    setActiveMenuSession,
  } = useChatPageState()

  const { data: sessions } = useChatSessions(true, debouncedQ || undefined)
  const { data: messages } = useChatMessages(currentSessionId)
  const { data: systems = [] } = useSystems()
  const patchSession = usePatchChatSession()
  const promptCategories = useChatPromptCategories()
  const screenContext = useScreenContext()
  const { scopeIds, primaryIds, ready: scopeReady, saveScope } = useChatScope()

  // 진입할 때: 오늘(KST) 대화가 아니면 새 대화, 빈 오늘 대화는 재사용 (우하단 패널과 같은 훅)
  const {
    ready: sessionReady,
    isCreating,
    startNewSession,
  } = useChatSessionBootstrap({ active: true, scopeIds, scopeReady })

  const {
    attachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    readyKeys,
    isUploading,
  } = useChatAttachments(currentSessionId)

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
    handleRetry,
    abortStream,
  } = useChatStreaming({
    currentSessionId,
    screenContext,
    readyKeys,
    clearAttachments,
    messages,
  })

  const { deleteSession, handleNewChat, handleRenameSubmit, handleDeleteConfirm } =
    useChatSessionManager({
      currentSessionId,
      setCurrentSessionId,
      startNewSession,
      isCreatingSession: isCreating,
      activeMenuSession,
      setActiveMenuSession,
      clearAttachments,
      abortStream,
      isStreaming,
    })

  const currentSession = useMemo(
    () => sessions?.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
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

  // 세션이 정해지기 전(오늘 대화 판정·생성 중)에는 전송을 막아 어제 대화에 섞이지 않게 한다
  const canSend = !!currentSessionId && sessionReady

  const notice = useChatContextNotice({
    active: true,
    currentSessionId,
    messageCount: messages?.length ?? 0,
    screenContext,
  })

  const queriedByMessage = useMemo(
    () => buildQueriedSystemNames(messages, systems),
    [messages, systems],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const isMac = navigator.userAgent.toUpperCase().includes('MAC')

    const handleKeyDown = (e: KeyboardEvent) => {
      const cmdKey = isMac ? e.metaKey : e.ctrlKey
      const inInput =
        e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement

      // Cmd/Ctrl+N — new chat (always)
      if (cmdKey && e.key === 'n') {
        e.preventDefault()
        void handleNewChat()
        return
      }

      // Cmd/Ctrl+ArrowUp/Down — previous/next session (not in input)
      if (
        cmdKey &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
        !inInput &&
        sessions &&
        sessions.length > 0
      ) {
        e.preventDefault()
        const currentIdx = sessions.findIndex((s) => s.id === currentSessionId)
        if (e.key === 'ArrowUp') {
          const prevIdx = currentIdx > 0 ? currentIdx - 1 : 0
          setCurrentSessionId(sessions[prevIdx].id)
        } else {
          const nextIdx = currentIdx < sessions.length - 1 ? currentIdx + 1 : sessions.length - 1
          setCurrentSessionId(sessions[nextIdx].id)
        }
        return
      }

      // / — focus composer (not in input)
      if (e.key === '/' && !inInput && !cmdKey) {
        e.preventDefault()
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="메시지를 입력하세요"]',
        )
        textarea?.focus()
        return
      }

      // Esc — abort streaming + restore, or close mobile drawer
      if (e.key === 'Escape') {
        if (isStreamingRef.current) {
          abortRef.current?.abort()
          setRestoreValue({ content: lastSentContentRef.current, nonce: Date.now() })
        } else {
          setMobileSessionListOpen(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    handleNewChat,
    sessions,
    currentSessionId,
    setCurrentSessionId,
    isStreamingRef,
    abortRef,
    lastSentContentRef,
    setRestoreValue,
    setMobileSessionListOpen,
  ])

  // Scroll to bottom on new messages/tokens
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const rafRef = useRef<number | null>(null)

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

  // Cancel stream on unmount
  useEffect(() => {
    const ctrl = abortRef.current
    return () => {
      ctrl?.abort()
    }
  }, [abortRef])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="AI 어시스턴트" description="운영 지식 검색 및 시스템 현황 질의" />

      {/* Mobile session toggle */}
      <div className="border-border bg-surface mb-2 flex items-center gap-2 rounded-sm border px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileSessionListOpen(true)}
          className="text-text-secondary hover:text-text-primary flex min-h-[44px] items-center gap-2 rounded-sm px-2"
          aria-label="세션 목록 열기"
        >
          <Menu className="h-4 w-4" />
          <span className="text-sm">세션 목록</span>
        </button>
        <span className="text-text-secondary text-xs">{sessions?.length ?? 0}개 대화</span>
      </div>

      {/* Mobile drawer backdrop */}
      {mobileSessionListOpen && (
        <div
          className="bg-overlay fixed inset-0 z-20 lg:hidden"
          onClick={() => setMobileSessionListOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* Session list panel */}
        <div
          className={cn(
            'border-border bg-surface flex shrink-0 flex-col rounded-sm border',
            // Mobile: fixed overlay drawer
            'fixed inset-y-0 left-0 z-30 w-72 transition-transform duration-200 ease-out',
            mobileSessionListOpen ? 'translate-x-0' : '-translate-x-full',
            // lg+: static sibling
            'lg:static lg:z-auto lg:w-64 lg:translate-x-0',
          )}
        >
          <div className="border-border flex flex-col gap-2 border-b px-3 py-2">
            <NeuButton
              variant="secondary"
              size="sm"
              onClick={handleNewChat}
              disabled={isCreating}
              className="w-full"
            >
              <Plus className="h-4 w-4" />
              <span>새 대화</span>
            </NeuButton>
            <ChatSessionSearchInput value={searchQ} onChange={setSearchQ} />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {sessions && sessions.length === 0 && (
              <p className="text-text-disabled px-3 py-4 text-center text-xs">
                {debouncedQ ? '검색 결과 없음' : '대화 없음'}
              </p>
            )}
            {sessions?.map((session: ChatSession) => {
              const isActive = session.id === currentSessionId
              return (
                <div
                  key={session.id}
                  className={cn(
                    'group flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    'min-h-[44px]',
                    isActive
                      ? 'bg-accent text-accent-contrast font-medium'
                      : 'text-text-secondary hover:bg-accent-muted hover:text-text-primary',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentSessionId(session.id)
                      setMobileSessionListOpen(false)
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 text-left',
                      'focus:ring-accent rounded-sm focus:ring-1 focus:outline-none',
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{session.title || '새 대화'}</div>
                      {session.matched_in === 'message' && session.match_preview && (
                        <div className="text-text-secondary mt-0.5 truncate text-[11px]">
                          💬 {session.match_preview}
                        </div>
                      )}
                      <div
                        className={cn(
                          'truncate text-[10px]',
                          isActive ? 'text-accent-contrast/70' : 'text-text-disabled',
                        )}
                      >
                        {formatRelative(session.updated_at)}
                      </div>
                    </div>
                  </button>
                  <SessionItemMenu
                    onRename={() =>
                      setActiveMenuSession({
                        id: session.id,
                        title: session.title || '새 대화',
                        mode: 'rename',
                      })
                    }
                    onDelete={() =>
                      setActiveMenuSession({
                        id: session.id,
                        title: session.title || '새 대화',
                        mode: 'delete',
                      })
                    }
                    className={cn(
                      'shrink-0 transition-opacity duration-100',
                      // Mobile/touch: always visible (no hover)
                      // Desktop (md+): show on hover only
                      'opacity-100 md:opacity-0 md:group-hover:opacity-100',
                      isActive && 'md:opacity-100',
                    )}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Chat area */}
        <div className="border-border bg-surface flex min-w-0 flex-1 flex-col rounded-sm border">
          <ChatHeader
            title={currentSession?.title ?? '새 대화'}
            subtitle={null}
            onNewChat={handleNewChat}
            disabled={isStreaming}
            systems={systems}
            scopeSystemIds={shownScopeIds}
            primarySystemIds={primaryIds}
            onScopeChange={handleScopeChange}
            onViewAll={() => navigate(ROUTES.CHAT)}
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

                {/* Screen-specific quick prompt chips */}
                {screenContext.screen &&
                  getContextualPrompts(screenContext.screen, null).length > 0 && (
                    <div className="mb-3">
                      {screenContext.screen_label && (
                        <p className="text-text-secondary mb-1.5 text-[11px]">
                          현재 화면: {screenContext.screen_label}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {getContextualPrompts(screenContext.screen, null).map((chip) => (
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
                  )}

                {/* Recommended prompt cards — grouped by category */}
                <div className="space-y-3">
                  {promptCategories.map((group) => (
                    <div key={group.label}>
                      <p className="text-text-secondary mb-1.5 text-[11px] font-medium tracking-wide uppercase">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
                <p className="text-text-disabled mt-4 hidden text-center text-[11px] lg:block">
                  {navigator.userAgent.toUpperCase().includes('MAC')
                    ? '단축키: Cmd+N 새 대화 | Cmd+↑/↓ 세션 이동 | / 입력 포커스'
                    : '단축키: Ctrl+N 새 대화 | Ctrl+↑/↓ 세션 이동 | / 입력 포커스'}
                </p>
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

      {/* Rename modal */}
      <SessionRenameModal
        open={activeMenuSession?.mode === 'rename'}
        initialTitle={activeMenuSession?.title ?? ''}
        onClose={() => setActiveMenuSession(null)}
        onSubmit={handleRenameSubmit}
        isPending={patchSession.isPending}
      />

      {/* Delete confirm modal */}
      <SessionDeleteConfirmModal
        open={activeMenuSession?.mode === 'delete'}
        sessionTitle={activeMenuSession?.title ?? ''}
        onClose={() => setActiveMenuSession(null)}
        onConfirm={handleDeleteConfirm}
        isPending={deleteSession.isPending}
      />
    </div>
  )
}
