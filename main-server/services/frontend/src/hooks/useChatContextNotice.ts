import { useEffect, useRef, useState } from 'react'
import { useChatStore, type LastSentContext } from '@/store/chatStore'
import type { ScreenContext } from '@/types/chat'

interface Options {
  active: boolean
  currentSessionId: string | null
  messageCount: number
  screenContext: ScreenContext
}

interface Notice {
  system_id?: string
  incident_id?: string
  /** 활성화 시점의 lastSentContext — 이후 질문을 보내 바뀌면 안내를 거둔다 */
  baselineKey: string
}

const keyOf = (c: LastSentContext | null) => JSON.stringify(c)

/**
 * 같은 날 대화를 다른 화면(시스템·인시던트)에서 열었을 때 "새 대화로 시작할까요?" 안내 여부.
 * 패널을 열 때(또는 /chat 진입 시) 화면 컨텍스트를 스냅샷으로 잡아 그 대화에서 마지막으로 쓰던 것과 비교한다.
 * 메시지가 없거나, 지금 화면에 시스템·인시던트가 없거나, 비교 기준이 없으면 안내하지 않는다. 자동 전환은 하지 않는다.
 */
export function useChatContextNotice({
  active,
  currentSessionId,
  messageCount,
  screenContext,
}: Options) {
  const lastSentContext = useChatStore((s) => s.lastSentContext)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const ctxRef = useRef(screenContext)
  ctxRef.current = screenContext

  useEffect(() => {
    if (!active) {
      setNotice(null)
      return
    }
    setNotice({
      system_id: ctxRef.current.system_id,
      incident_id: ctxRef.current.incident_id,
      baselineKey: keyOf(useChatStore.getState().lastSentContext),
    })
    setDismissed(false)
  }, [active])

  const last = lastSentContext
  const show =
    !!notice &&
    !dismissed &&
    messageCount > 0 &&
    !!currentSessionId &&
    !!last &&
    last.sessionId === currentSessionId &&
    keyOf(last) === notice.baselineKey &&
    (!!notice.system_id || !!notice.incident_id) &&
    ((notice.system_id ?? '') !== (last.system_id ?? '') ||
      (notice.incident_id ?? '') !== (last.incident_id ?? ''))

  return { show, dismiss: () => setDismissed(true) }
}
