import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { Menu, Plus, MessageSquare } from 'lucide-react'
import { streamChatMessage } from '@/api/chat'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import { useCreateChatSession } from '@/hooks/mutations/useCreateChatSession'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatStore } from '@/store/chatStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { qk } from '@/constants/queryKeys'
import type { ChatMessage, ChatSession, ChatStreamEvent } from '@/types/chat'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatMessageView, StreamingAssistantMessage } from '@/components/chat/ChatMessage'
import { ToolCallCard } from '@/components/chat/ToolCallCard'

interface StreamingToolState {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  running: boolean
  thought?: string
}

export function ChatPage() {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)
  const filterSystemId = useChatStore((s) => s.filterSystemId)
  const setFilterSystemId = useChatStore((s) => s.setFilterSystemId)

  const { data: systems = [] } = useSystems()

  const qc = useQueryClient()
  const { data: sessions } = useChatSessions(true)
  const createSession = useCreateChatSession()
  const {
    attachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    readyKeys,
    isUploading,
  } = useChatAttachments(currentSessionId)

  // 세션이 없으면 자동 생성 또는 최신 세션 복원
  useEffect(() => {
    if (currentSessionId) return
    if (sessions && sessions.length > 0) {
      setCurrentSessionId(sessions[0].id)
      return
    }
    if (sessions && sessions.length === 0 && !createSession.isPending) {
      createSession.mutate(undefined, {
        onSuccess: (s) => setCurrentSessionId(s.id),
      })
    }
  }, [currentSessionId, sessions, setCurrentSessionId, createSession])

  const { data: messages } = useChatMessages(currentSessionId)

  const [mobileSessionListOpen, setMobileSessionListOpen] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

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
          filterSystemId,
        )
      } catch (err) {
        console.error(err)
        toast.error('채팅 중 오류가 발생했습니다.')
      } finally {
        finishStream()
      }
    },
    [currentSessionId, isStreaming, readyKeys, clearAttachments, finishStream, filterSystemId],
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
      },
    })
  }, [createSession, isStreaming, setCurrentSessionId, clearAttachments])

  const currentSession = useMemo(
    () => sessions?.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
  )

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
          <div className="border-border border-b px-3 py-2">
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
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {sessions && sessions.length === 0 && (
              <p className="text-text-disabled px-3 py-4 text-center text-xs">대화 없음</p>
            )}
            {sessions?.map((session: ChatSession) => (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  setCurrentSessionId(session.id)
                  setMobileSessionListOpen(false)
                }}
                aria-current={session.id === currentSessionId ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors',
                  'min-h-[44px]',
                  'focus:ring-accent focus:ring-1 focus:outline-none',
                  session.id === currentSessionId
                    ? 'bg-accent text-accent-contrast font-medium'
                    : 'text-text-secondary hover:bg-accent-muted hover:text-text-primary',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{session.title || '새 대화'}</span>
              </button>
            ))}
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
            filterSystemId={filterSystemId}
            onFilterSystemChange={setFilterSystemId}
          />

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="bg-bg-base flex-1 space-y-3 overflow-y-auto px-3 py-3"
          >
            {messages?.length === 0 && !isStreaming && (
              <div className="text-text-secondary mt-6 text-center text-sm">
                <div className="mb-1">무엇이든 물어보세요.</div>
                <div className="text-[11px]">예) &ldquo;CRM 서버 오늘 CPU 사용률 알려줘&rdquo;</div>
              </div>
            )}
            {messages?.map((m: ChatMessage) => (
              <ChatMessageView key={m.id} message={m} sessionId={currentSessionId ?? ''} />
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
          />
        </div>
      </div>
    </div>
  )
}
