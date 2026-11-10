import { useDeferredValue, useEffect, useState } from 'react'
import { useChatStore } from '@/store/chatStore'

export type ActiveMenuMode = 'rename' | 'delete'
export interface ActiveMenuSession {
  id: string
  title: string
  mode: ActiveMenuMode
}

export function useChatPageState() {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)

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
