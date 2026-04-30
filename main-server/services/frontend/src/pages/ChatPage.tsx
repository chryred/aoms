import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { describeChatError } from '@/lib/chatErrorMessage'
import { useQueryClient } from '@tanstack/react-query'
import { Menu, Plus, MessageSquare } from 'lucide-react'
import { streamChatMessage } from '@/api/chat'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import {
  useCreateChatSession,
  useDeleteChatSession,
  useRestoreChatSession,
} from '@/hooks/mutations/useCreateChatSession'
import { usePatchChatSession } from '@/hooks/mutations/usePatchChatSession'
import { useChatPromptCategories } from '@/hooks/queries/useChatPromptCategories'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { qk } from '@/constants/queryKeys'
import type { ChatMessage, ChatSession, ChatStreamEvent, ScreenContext } from '@/types/chat'
import { cn, formatRelative } from '@/lib/utils'
import { SCREEN_PROMPTS } from '@/config/chatPrompts'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatMessageView, StreamingAssistantMessage } from '@/components/chat/ChatMessage'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { ChatSessionSearchInput } from '@/components/chat/ChatSessionSearchInput'
import { SessionItemMenu } from '@/components/chat/SessionItemMenu'
import { SessionRenameModal } from '@/components/chat/SessionRenameModal'
import { SessionDeleteConfirmModal } from '@/components/chat/SessionDeleteConfirmModal'

interface StreamingToolState {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  running: boolean
  thought?: string
}

type ActiveMenuMode = 'rename' | 'delete'
interface ActiveMenuSession {
  id: string
  title: string
  mode: ActiveMenuMode
}

export function ChatPage() {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)
  const filterSystemIds = useChatStore((s) => s.filterSystemIds)
  const setFilterSystemIds = useChatStore((s) => s.setFilterSystemIds)
  const consumePendingScreenContext = useChatStore((s) => s.consumePendingScreenContext)

  // 진입 시 1회 소비하여 로컬 state에 보관
  const [latestScreenContext, setLatestScreenContext] = useState<ScreenContext | null>(null)

  useEffect(() => {
    const ctx = consumePendingScreenContext()
    if (ctx) setLatestScreenContext(ctx)
    // consumePendingScreenContext는 안정된 함수 참조이므로 의존성에 포함
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: systems = [] } = useSystems()
  const { data: primarySystems } = useMyPrimarySystems()
  const user = useAuthStore((s) => s.user)

  // filterSystemIds 디폴트 초기화: 빈 배열이고 사용자 정보가 로드된 경우에만 1회 적용
  const defaultsApplied = useRef(false)
  useEffect(() => {
    if (defaultsApplied.current) return
    if (filterSystemIds.length > 0) {
      // 이미 persist 복원된 값이 있으면 그대로 사용
      defaultsApplied.current = true
      return
    }
    if (!user) return

    if (user.role === 'admin') {
      // admin은 모든 시스템이 로드되었을 때 전체 선택
      if (systems.length > 0) {
        setFilterSystemIds(systems.map((s) => s.id))
        defaultsApplied.current = true
      }
    } else {
      // 일반 사용자: 담당 시스템 기본 선택 (로드 완료 시)
      if (primarySystems !== undefined) {
        if (primarySystems.length > 0) {
          setFilterSystemIds(primarySystems.map((s) => s.system_id))
        }
        // 담당 시스템 0개면 빈 상태 유지
        defaultsApplied.current = true
      }
    }
  }, [user, systems, primarySystems, filterSystemIds, setFilterSystemIds])

  const qc = useQueryClient()

  // 세션 검색
  const [searchQ, setSearchQ] = useState('')
  const deferredQ = useDeferredValue(searchQ)
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(deferredQ), 200)
    return () => clearTimeout(timer)
  }, [deferredQ])

  const { data: sessions } = useChatSessions(true, debouncedQ || undefined)
  const createSession = useCreateChatSession()
  const deleteSession = useDeleteChatSession()
  const restoreSession = useRestoreChatSession()
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

  // 모달 상태 (단일 모달 정책)
  const [activeMenuSession, setActiveMenuSession] = useState<ActiveMenuSession | null>(null)

  // 세션이 없으면 자동 생성 또는 최신 세션 복원
  useEffect(() => {
    if (currentSessionId) return
    if (sessions && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id)
      return
    }
    if (sessions && sessions.length === 0 && !debouncedQ && !createSession.isPending) {
      createSession.mutate(undefined, {
        onSuccess: (s) => {
          setCurrentSessionId(s.id)
          // system_ids 전달
          if (filterSystemIds.length > 0) {
            patchSession.mutate({ sessionId: s.id, data: { system_ids: filterSystemIds } })
          }
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, sessions, debouncedQ, setCurrentSessionId, createSession])

  const { data: messages } = useChatMessages(currentSessionId)

  const [mobileSessionListOpen, setMobileSessionListOpen] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
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

  const finishStream = useCallback(() => {
    setStreamText('')
    setStreamThought(undefined)
    setStreamingTools([])
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

  const handleEvent = (event: ChatStreamEvent) => {
    switch (event.type) {
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
      case 'final':
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
  const filterSystemIdsRef = useRef(filterSystemIds)
  useEffect(() => {
    filterSystemIdsRef.current = filterSystemIds
  }, [filterSystemIds])

  const handleFilterChange = useCallback(
    (ids: number[]) => {
      setFilterSystemIds(ids)
      if (currentSessionId) {
        patchSession.mutate({ sessionId: currentSessionId, data: { system_ids: ids } })
      }
    },
    [setFilterSystemIds, currentSessionId, patchSession],
  )

  // 세션 이름 변경 핸들러
  const handleRenameSubmit = useCallback(
    async (title: string) => {
      if (!activeMenuSession) return
      await patchSession.mutateAsync({ sessionId: activeMenuSession.id, data: { title } })
      setActiveMenuSession(null)
    },
    [activeMenuSession, patchSession],
  )

  // 세션 삭제 핸들러 — 삭제 후 Undo 토스트 (8초)
  const handleDeleteConfirm = useCallback(async () => {
    if (!activeMenuSession) return
    const { id, title } = activeMenuSession
    await deleteSession.mutateAsync(id)
    if (currentSessionId === id) {
      setCurrentSessionId(null)
    }
    setActiveMenuSession(null)

    const truncated = title.length > 20 ? `${title.slice(0, 20)}…` : title
    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <span>
            <span className="text-text-primary font-medium">&ldquo;{truncated}&rdquo;</span>{' '}
            <span className="text-text-secondary">대화를 삭제했어요</span>
          </span>
          <button
            type="button"
            onClick={async () => {
              toast.dismiss(t.id)
              try {
                const restored = await restoreSession.mutateAsync(id)
                setCurrentSessionId(restored.id)
                toast.success('대화를 복구했어요')
              } catch {
                toast.error('복구에 실패했어요. 잠시 후 다시 시도해주세요.')
              }
            }}
            className="text-accent hover:text-accent-contrast hover:bg-accent rounded-sm px-2 py-1 text-xs font-medium transition-colors"
          >
            되돌리기
          </button>
        </span>
      ),
      { duration: 8000 },
    )
  }, [activeMenuSession, deleteSession, restoreSession, currentSessionId, setCurrentSessionId])

  // 키보드 단축키
  useEffect(() => {
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

      // Cmd/Ctrl+ArrowUp/Down — 세션 이전/다음 (입력창 외부일 때만)
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

      // / — 입력창 포커스 (입력 중 아닐 때)
      if (e.key === '/' && !inInput && !cmdKey) {
        e.preventDefault()
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder="메시지를 입력하세요"]',
        )
        textarea?.focus()
        return
      }

      // Esc — 스트리밍 중이면 중단 + 복원, 아니면 모바일 drawer 닫기
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
  }, [handleNewChat, sessions, currentSessionId, setCurrentSessionId])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 100
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isStreaming && userScrolledUpRef.current) return
    el.scrollTo({ top: el.scrollHeight, behavior: isStreaming ? 'instant' : 'smooth' })
  }, [messages?.length, streamText, streamingTools.length, isStreaming])

  // 언마운트 시 스트림 취소
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="AI 어시스턴트" description="운영 지식 검색 및 시스템 현황 질의" />

      {/* 모바일 전용 세션 토글 */}
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

      {/* 모바일 drawer 백드롭 */}
      {mobileSessionListOpen && (
        <div
          className="bg-overlay fixed inset-0 z-20 lg:hidden"
          onClick={() => setMobileSessionListOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 세션 목록 패널 */}
        <div
          className={cn(
            'border-border bg-surface flex shrink-0 flex-col rounded-sm border',
            // 모바일: fixed overlay drawer
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
              disabled={createSession.isPending}
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
                      // 모바일/터치 환경: 항상 가시화 (hover 없음)
                      // 데스크탑(md 이상): hover 시에만 노출
                      'opacity-100 md:opacity-0 md:group-hover:opacity-100',
                      isActive && 'md:opacity-100',
                    )}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* 채팅 영역 */}
        <div className="border-border bg-surface flex min-w-0 flex-1 flex-col rounded-sm border">
          <ChatHeader
            title={currentSession?.title ?? '새 대화'}
            subtitle={null}
            onNewChat={handleNewChat}
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

                {/* 화면별 quick prompt chips */}
                {latestScreenContext?.screen && SCREEN_PROMPTS[latestScreenContext.screen] && (
                  <div className="mb-3">
                    {latestScreenContext.screen_label && (
                      <p className="text-text-secondary mb-1.5 text-[11px]">
                        현재 화면: {latestScreenContext.screen_label}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {SCREEN_PROMPTS[latestScreenContext.screen].map((chip) => (
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
                )}

                {/* 추천 카드 — 의미 그룹별 sub-header + 3+3 layout */}
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
                <p className="text-text-disabled mt-4 hidden text-center text-[11px] lg:block">
                  {navigator.userAgent.toUpperCase().includes('MAC')
                    ? '단축키: Cmd+N 새 대화 | Cmd+↑/↓ 세션 이동 | / 입력 포커스'
                    : '단축키: Ctrl+N 새 대화 | Ctrl+↑/↓ 세션 이동 | / 입력 포커스'}
                </p>
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

      {/* 이름 변경 모달 */}
      <SessionRenameModal
        open={activeMenuSession?.mode === 'rename'}
        initialTitle={activeMenuSession?.title ?? ''}
        onClose={() => setActiveMenuSession(null)}
        onSubmit={handleRenameSubmit}
        isPending={patchSession.isPending}
      />

      {/* 삭제 확인 모달 */}
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
