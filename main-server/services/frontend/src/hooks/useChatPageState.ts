import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import type { ScreenContext } from '@/types/chat'

export type ActiveMenuMode = 'rename' | 'delete'
export interface ActiveMenuSession {
  id: string
  title: string
  mode: ActiveMenuMode
}

export function useChatPageState() {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)
  const filterSystemIds = useChatStore((s) => s.filterSystemIds)
  const setFilterSystemIds = useChatStore((s) => s.setFilterSystemIds)
  const consumePendingScreenContext = useChatStore((s) => s.consumePendingScreenContext)

  const { data: systems = [] } = useSystems()
  const { data: primarySystems } = useMyPrimarySystems()
  const user = useAuthStore((s) => s.user)

  // Screen context consumed once on mount
  const [latestScreenContext, setLatestScreenContext] = useState<ScreenContext | null>(null)
  useEffect(() => {
    const ctx = consumePendingScreenContext()
    if (ctx) setLatestScreenContext(ctx)
    // consumePendingScreenContext is a stable function reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // filterSystemIds default initialization: apply once when user info is loaded
  const defaultsApplied = useRef(false)
  useEffect(() => {
    if (defaultsApplied.current) return
    if (filterSystemIds.length > 0) {
      // Already restored from persistence, keep as-is
      defaultsApplied.current = true
      return
    }
    if (!user) return

    if (user.role === 'admin') {
      if (systems.length > 0) {
        setFilterSystemIds(systems.map((s) => s.id))
        defaultsApplied.current = true
      }
    } else {
      if (primarySystems !== undefined) {
        if (primarySystems.length > 0) {
          setFilterSystemIds(primarySystems.map((s) => s.system_id))
        }
        defaultsApplied.current = true
      }
    }
  }, [user, systems, primarySystems, filterSystemIds, setFilterSystemIds])

  // Session list search
  const [searchQ, setSearchQ] = useState('')
  const deferredQ = useDeferredValue(searchQ)
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(deferredQ), 200)
    return () => clearTimeout(timer)
  }, [deferredQ])

  // Mobile session drawer
  const [mobileSessionListOpen, setMobileSessionListOpen] = useState(false)

  // Composer prefill (Esc restore + prompt chips)
  const [restoreValue, setRestoreValue] = useState<{ content: string; nonce: number } | undefined>()

  // Modal state (single modal policy)
  const [activeMenuSession, setActiveMenuSession] = useState<ActiveMenuSession | null>(null)

  return {
    // Store-backed state
    currentSessionId,
    setCurrentSessionId,
    filterSystemIds,
    setFilterSystemIds,
    // Screen context
    latestScreenContext,
    // Search
    searchQ,
    setSearchQ,
    debouncedQ,
    // Mobile UI
    mobileSessionListOpen,
    setMobileSessionListOpen,
    // Composer restore
    restoreValue,
    setRestoreValue,
    // Modal
    activeMenuSession,
    setActiveMenuSession,
  }
}
