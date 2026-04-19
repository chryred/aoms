import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { streamChatMessage } from '@/api/chat'
import { useChatMessages } from '@/hooks/queries/useChatMessages'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import { useCreateChatSession } from '@/hooks/mutations/useCreateChatSession'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useChatStore } from '@/store/chatStore'
import { useUiStore } from '@/store/uiStore'
import { qk } from '@/constants/queryKeys'
import type { ChatMessage, ChatStreamEvent } from '@/types/chat'
import { cn } from '@/lib/utils'
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
  const criticalCount = useUiStore((s) => s.criticalCount)
  const hasBanner = criticalCount > 0

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
        )
      } catch (err) {
        console.error(err)
        toast.error('채팅 중 오류가 발생했습니다.')
      } finally {
        finishStream()
      }
    },
    [currentSessionId, isStreaming, readyKeys, clearAttachments, finishStream],
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

  // 새 메시지/스트림 업데이트 시 하단으로 스크롤
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages?.length, streamText, streamingTools.length, isStreaming])

  // 언마운트/패널 닫힘 시 스트림 취소
  useEffect(() => {
    if (!isOpen) abortRef.current?.abort()
  }, [isOpen])

  return (
    <div
      className={cn(
        'fixed right-0 z-40 w-full sm:w-[440px]',
        'bg-surface border-border flex flex-col border-l shadow-[-8px_0_24px_rgba(0,0,0,0.3)]',
        'transition-transform duration-200 ease-out',
        hasBanner ? 'top-9 h-[calc(100%-2.25rem)]' : 'top-0 h-full',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
      aria-hidden={!isOpen}
    >
      <ChatHeader
        title={currentSession?.title ?? '새 대화'}
        onNewChat={handleNewChat}
        onClose={() => setOpen(false)}
        disabled={isStreaming}
      />

      <div ref={scrollRef} className="bg-bg-base flex-1 space-y-3 overflow-y-auto px-3 py-3">
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
