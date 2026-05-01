import { useCallback, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { describeChatError } from '@/lib/chatErrorMessage'
import { useQueryClient } from '@tanstack/react-query'
import { streamChatMessage } from '@/api/chat'
import { qk } from '@/constants/queryKeys'
import type { ChatMessage, ChatStreamEvent, ScreenContext } from '@/types/chat'

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
  latestScreenContext: ScreenContext | null
  readyKeys: string[]
  clearAttachments: () => void
  messages: ChatMessage[] | undefined
}

export function useChatStreaming({
  currentSessionId,
  latestScreenContext,
  readyKeys,
  clearAttachments,
  messages,
}: UseChatStreamingOptions) {
  const qc = useQueryClient()

  const [streamText, setStreamText] = useState('')
  const [streamThought, setStreamThought] = useState<string | undefined>()
  const [streamingTools, setStreamingTools] = useState<StreamingToolState[]>([])
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
    updateIsStreaming(false)
    if (currentSessionId) {
      qc.invalidateQueries({ queryKey: qk.chat.messages(currentSessionId) })
      qc.invalidateQueries({ queryKey: qk.chat.sessions() })
    }
  }, [qc, currentSessionId, updateIsStreaming])

  // handleEvent must reference latest streamThought without stale closure.
  // We use a ref to hold the handler so handleSend can reference it stably.
  const handleEventRef = useRef<(event: ChatStreamEvent) => void>(() => {})

  const handleEvent = useCallback(
    (event: ChatStreamEvent) => {
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
    },
    [currentSessionId, qc, streamThought],
  )

  // Update the ref each render so the latest handleEvent is always used
  handleEventRef.current = handleEvent

  const handleSend = useCallback(
    async (content: string) => {
      if (!currentSessionId) {
        toast.error('세션이 없습니다.')
        return
      }
      if (isStreamingRef.current) return
      lastSentContentRef.current = content
      updateIsStreaming(true)
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
      latestScreenContext,
      updateIsStreaming,
    ],
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
    isStreaming,
    isStreamingRef,
    lastSentContentRef,
    abortRef,
    handleSend,
    handleRetry,
    abortStream,
  }
}
