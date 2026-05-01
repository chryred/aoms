import { useCallback, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  useCreateChatSession,
  useDeleteChatSession,
  useRestoreChatSession,
} from '@/hooks/mutations/useCreateChatSession'
import { usePatchChatSession } from '@/hooks/mutations/usePatchChatSession'
import type { ActiveMenuSession } from './useChatPageState'
import type { ChatSession } from '@/types/chat'

interface UseChatSessionManagerOptions {
  currentSessionId: string | null
  setCurrentSessionId: (id: string | null) => void
  filterSystemIds: number[]
  sessions: ChatSession[] | undefined
  debouncedQ: string
  activeMenuSession: ActiveMenuSession | null
  setActiveMenuSession: (s: ActiveMenuSession | null) => void
  clearAttachments: () => void
  abortStream: () => void
  isStreaming: boolean
}

export function useChatSessionManager({
  currentSessionId,
  setCurrentSessionId,
  filterSystemIds,
  sessions,
  debouncedQ,
  activeMenuSession,
  setActiveMenuSession,
  clearAttachments,
  abortStream,
  isStreaming,
}: UseChatSessionManagerOptions) {
  const createSession = useCreateChatSession()
  const deleteSession = useDeleteChatSession()
  const restoreSession = useRestoreChatSession()
  const patchSession = usePatchChatSession()

  // Auto-create or restore: if no current session, pick the most recent or create a new one
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
          if (filterSystemIds.length > 0) {
            patchSession.mutate({ sessionId: s.id, data: { system_ids: filterSystemIds } })
          }
        },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, sessions, debouncedQ, setCurrentSessionId, createSession])

  const handleNewChat = useCallback(() => {
    if (isStreaming) {
      abortStream()
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
    abortStream,
  ])

  const handleRenameSubmit = useCallback(
    async (title: string) => {
      if (!activeMenuSession) return
      await patchSession.mutateAsync({ sessionId: activeMenuSession.id, data: { title } })
      setActiveMenuSession(null)
    },
    [activeMenuSession, patchSession, setActiveMenuSession],
  )

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
  }, [
    activeMenuSession,
    deleteSession,
    restoreSession,
    currentSessionId,
    setCurrentSessionId,
    setActiveMenuSession,
  ])

  return {
    createSession,
    deleteSession,
    handleNewChat,
    handleRenameSubmit,
    handleDeleteConfirm,
  }
}
