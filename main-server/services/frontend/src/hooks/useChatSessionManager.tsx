import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useDeleteChatSession, useRestoreChatSession } from '@/hooks/mutations/useCreateChatSession'
import { usePatchChatSession } from '@/hooks/mutations/usePatchChatSession'
import type { ActiveMenuSession } from './useChatPageState'
import type { ChatSession } from '@/types/chat'

interface UseChatSessionManagerOptions {
  currentSessionId: string | null
  setCurrentSessionId: (id: string | null) => void
  /** useChatSessionBootstrap 의 startNewSession — 자동 생성과 같은 단일 생성 경로(동시 생성 방지) */
  startNewSession: () => Promise<ChatSession | null>
  isCreatingSession: boolean
  activeMenuSession: ActiveMenuSession | null
  setActiveMenuSession: (s: ActiveMenuSession | null) => void
  clearAttachments: () => void
  abortStream: () => void
  isStreaming: boolean
}

export function useChatSessionManager({
  currentSessionId,
  setCurrentSessionId,
  startNewSession,
  isCreatingSession,
  activeMenuSession,
  setActiveMenuSession,
  clearAttachments,
  abortStream,
  isStreaming,
}: UseChatSessionManagerOptions) {
  const deleteSession = useDeleteChatSession()
  const restoreSession = useRestoreChatSession()
  const patchSession = usePatchChatSession()

  const handleNewChat = useCallback(async () => {
    if (isStreaming) {
      abortStream()
    }
    const created = await startNewSession()
    if (created) clearAttachments()
  }, [isStreaming, abortStream, startNewSession, clearAttachments])

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
    isCreatingSession,
    deleteSession,
    handleNewChat,
    handleRenameSubmit,
    handleDeleteConfirm,
  }
}
