import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import {
  Server,
  AlertTriangle,
  BookOpen,
  FileSearch,
  TrendingUp,
  History,
} from 'lucide-react'
import { streamChatMessage } from '@/api/chat'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import { useCreateChatSession } from '@/hooks/mutations/useCreateChatSession'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatStore } from '@/store/chatStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { qk } from '@/constants/queryKeys'
import type { ChatMessage, ChatStreamEvent } from '@/types/chat'
import { cn } from '@/lib/utils'
import { ChatComposer } from './ChatComposer'
import { ChatHeader } from './ChatHeader'
import { ChatMessageView, StreamingAssistantMessage } from './ChatMessage'
import { ToolCallCard } from './ToolCallCard'

const PROMPT_CATEGORIES = [
  {
    icon: Server,
    category: '시스템 상태',
    prompt: 'CRM 서버 오늘 CPU 사용률 알려줘',
  },
  {
    icon: AlertTriangle,
    category: '장애 이력',
    prompt: '지난주 결제 시스템 장애 원인 정리해줘',
  },
  {
    icon: BookOpen,
    category: '운영 정책',
    prompt: 'VIP 등급 기준이 뭐야?',
  },
  {
    icon: FileSearch,
    category: '로그 분석',
    prompt: '방금 발생한 알림 관련 에러 로그 보여줘',
  },
  {
    icon: TrendingUp,
    category: '메트릭 추이',
    prompt: '고객경험 시스템 메모리 사용률 추이',
  },
  {
    icon: History,
    category: '유사 사례',
    prompt: '비슷한 장애 이력 검색해줘',
  },
] as const

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
  const filterSystemId = useChatStore((s) => s.filterSystemId)
  const setFilterSystemId = useChatStore((s) => s.setFilterSystemId)

  const { data: systems = [] } = useSystems()

  const qc = useQueryClient()
  const { data: sessions } = useChatSessions(isOpen)
  const createSession = useCreateChatSession()
  const {
    attachments,
    addFiles,
    remove: removeAttachment,
    clear: clearAttachments,
    readyKeys,
    isUploading,
  } = useChatAttachments(currentSessionId)

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
        onSuccess: (s) => setCurrentSessionId(s.id),
      })
    }
  }, [isOpen, currentSessionId, sessions, setCurrentSessionId, createSession])

  const { data: messages } = useChatMessages(currentSessionId)

  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

  // 스트리밍이 끝나면 message list 재조회로 화면 교체
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
      },
    })
  }, [createSession, isStreaming, setCurrentSessionId, clearAttachments])

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

      // Esc — 패널 닫기
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, handleNewChat, setOpen])

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
        'bg-surface border-border flex flex-col',

        // === 모바일 (<lg): fixed overlay 유지 ===
        'fixed top-0 right-0 z-40 h-screen w-full',
        'shadow-side-overlay',
        'transition-transform duration-200 ease-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',

        // === 데스크탑 (lg+): push layout ===
        'lg:static lg:top-auto lg:right-auto lg:z-auto',
        'lg:h-full lg:translate-x-0 lg:shadow-none',
        'lg:overflow-hidden lg:transition-[width] lg:duration-200',
        isOpen ? 'lg:w-[420px] lg:border-l' : 'lg:w-0 lg:border-0',
      )}
    >
      <ChatHeader
        title={currentSession?.title ?? '새 대화'}
        onNewChat={handleNewChat}
        onClose={() => setOpen(false)}
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
          <div className="mt-4 px-1">
            <p className="text-text-primary mb-3 text-center text-sm font-medium">
              어떤 도움이 필요하신가요?
            </p>
            <div className="grid grid-cols-1 gap-2">
              {PROMPT_CATEGORIES.map(({ icon: Icon, category, prompt }) => (
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
        )}
        {messages?.map((m: ChatMessage) => (
          <ChatMessageView key={m.id} message={m} sessionId={currentSessionId ?? ''} onRetry={handleRetry} />
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
          <StreamingAssistantMessage content={streamText} running={true} thought={streamThought} />
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
  )
}
