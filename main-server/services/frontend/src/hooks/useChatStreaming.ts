import { useCallback, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { describeChatError } from '@/lib/chatErrorMessage'
import { useQueryClient } from '@tanstack/react-query'
import { streamAutoInsight, streamChatMessage } from '@/api/chat'
import { useChatStore } from '@/store/chatStore'
import { qk } from '@/constants/queryKeys'
import type {
  ChatMessage,
  ChatScopeEvent,
  ChatStreamEvent,
  MessageImage,
  ScreenContext,
} from '@/types/chat'

export interface StreamingToolState {
  id: string
  name: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  running: boolean
  thought?: string
}

interface UseChatStreamingOptions {
  currentSessionId: string | null
  /** 지금 화면의 컨텍스트(useScreenContext). 전송하는 순간의 최신 값이 사용된다 */
  screenContext: ScreenContext
  readyKeys: string[]
  clearAttachments: () => void
  messages: ChatMessage[] | undefined
  /** 스트림이 끝날 때마다 호출 (예: 패널이 닫혀 있으면 안 읽음 카운트 증가) */
  onStreamEnd?: () => void
}

export function useChatStreaming({
  currentSessionId,
  screenContext,
  readyKeys,
  clearAttachments,
  messages,
  onStreamEnd,
}: UseChatStreamingOptions) {
  const qc = useQueryClient()
  const setLastSentContext = useChatStore((s) => s.setLastSentContext)

  // 전송 시점에 최신 화면 컨텍스트·콜백을 읽도록 ref 로 들고 있는다
  const screenContextRef = useRef(screenContext)
  screenContextRef.current = screenContext
  const onStreamEndRef = useRef(onStreamEnd)
  onStreamEndRef.current = onStreamEnd

  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
  const [streamImages, setStreamImages] = useState<MessageImage[]>([])
  const [streamScope, setStreamScope] = useState<ChatScopeEvent | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const lastSentContentRef = useRef<string>('')
  const isStreamingRef = useRef(false)

  // Keep isStreamingRef in sync for use in event handlers / keyboard shortcuts
  const updateIsStreaming = useCallback((val: boolean) => {
    isStreamingRef.current = val
    setIsStreaming(val)
  }, [])

  const finishStream = useCallback(() => {
    setStreamText('')
    setStreamThought(undefined)
    setStreamingTools([])
    setStreamImages([])
    setStreamScope(null)
    updateIsStreaming(false)
    if (currentSessionId) {
      qc.invalidateQueries({ queryKey: qk.chat.messages(currentSessionId) })
      qc.invalidateQueries({ queryKey: qk.chat.sessions() })
    }
    onStreamEndRef.current?.()
  }, [qc, currentSessionId, updateIsStreaming])

  // handleEvent must reference latest streamThought without stale closure.
  // We use a ref to hold the handler so handleSend can reference it stably.
  const handleEventRef = useRef<(event: ChatStreamEvent) => void>(() => {})

  const handleEvent = useCallback(
    (event: ChatStreamEvent) => {
      switch (event.type) {
        case 'scope':
          setStreamScope(event.data as unknown as ChatScopeEvent)
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
          break
        case 'error': {
          const msg = String((event.data as { message?: string }).message ?? '알 수 없는 오류')
          toast.error(msg)
          break
        }
        default:
          break
      }
    },
    [currentSessionId, qc, streamThought],
  )

  // Update the ref each render so the latest handleEvent is always used
  handleEventRef.current = handleEvent

  const resetStreamState = useCallback(() => {
    setStreamText('')
    setStreamThought(undefined)
    setStreamingTools([])
    setStreamImages([])
    setStreamScope(null)
  }, [])

  // 이 대화에서 마지막으로 쓴 화면 컨텍스트 — 다른 화면에서 다시 열었는지 판단하는 기준
  const rememberContext = useCallback(
    (sessionId: string, ctx: ScreenContext) =>
      setLastSentContext({ sessionId, system_id: ctx.system_id, incident_id: ctx.incident_id }),
    [setLastSentContext],
  )

  const handleSend = useCallback(
    async (content: string) => {
      if (!currentSessionId) {
        toast.error('세션이 없습니다.')
        return
      }
      if (isStreamingRef.current) return
      lastSentContentRef.current = content
      updateIsStreaming(true)
      resetStreamState()

      const controller = new AbortController()
      abortRef.current = controller
      const keys = readyKeys
      clearAttachments()
      const ctx = screenContextRef.current
      rememberContext(currentSessionId, ctx)

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
          ctx,
        )
      } catch (err) {
        // AbortError는 사용자/세션 전환·삭제로 인한 정상 취소 — 무시
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        console.error(err)
        const msg = describeChatError(err)
        if (msg) toast.error(msg)
      } finally {
        finishStream()
      }
    },
    [
      currentSessionId,
      readyKeys,
      clearAttachments,
      finishStream,
      updateIsStreaming,
      resetStreamState,
      rememberContext,
    ],
  )

  // 선제적 통찰(Feature 5C-2): user 메시지 없이 인시던트 자동 분석
  const handleAutoInsight = useCallback(
    async (incidentId: number) => {
      if (!currentSessionId) {
        toast.error('세션이 없습니다.')
        return
      }
      if (isStreamingRef.current) return
      updateIsStreaming(true)
      resetStreamState()

      const controller = new AbortController()
      abortRef.current = controller
      const ctx = screenContextRef.current
      rememberContext(currentSessionId, ctx)

      try {
        await streamAutoInsight(
          currentSessionId,
          incidentId,
          (event: ChatStreamEvent) => {
            handleEventRef.current(event)
          },
          controller.signal,
          ctx,
        )
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error(err)
        const msg = describeChatError(err)
        if (msg) toast.error(msg)
      } finally {
        finishStream()
      }
    },
    [currentSessionId, finishStream, updateIsStreaming, resetStreamState, rememberContext],
  )

  const handleRetry = useCallback(
    (failedMessageId: string) => {
      if (!messages || isStreamingRef.current) return
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
    [messages, handleSend],
  )

  const abortStream = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
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
  }
}
