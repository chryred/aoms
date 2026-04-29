import { useEffect, useState } from 'react'
import { helpApi } from '@/api/help'
import type { HelpSystem } from '@/api/help'
import type { SessionMeta } from '@/lib/guestSessionCache'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { formatRelative } from '@/lib/utils'

interface Props {
  sessions: SessionMeta[]
  employeeId: string
  onResume: (sessionId: string) => void
  onStartNew: () => void
  onWipe: () => void
}

/** 사번 부분 마스킹 — 어깨너머 노출 차단. 'EMP1234' → 'EM***34' */
function maskEmployeeId(id: string): string {
  const trimmed = id.trim()
  if (trimmed.length <= 2) return trimmed
  if (trimmed.length <= 4) {
    return trimmed[0] + '*'.repeat(trimmed.length - 2) + trimmed[trimmed.length - 1]
  }
  return trimmed.slice(0, 2) + '*'.repeat(trimmed.length - 4) + trimmed.slice(-2)
}

export function GuestRecentSessions({ sessions, employeeId, onResume, onStartNew, onWipe }: Props) {
  const [systemMap, setSystemMap] = useState<Map<number, string>>(new Map())

  // 시스템 목록 로드 (비동기 — 로드 전에는 ID 그대로 표시)
  useEffect(() => {
    helpApi
      .getSystems()
      .then((data: HelpSystem[]) => {
        const map = new Map<number, string>()
        data.forEach((s) => map.set(s.id, s.display_name))
        setSystemMap(map)
      })
      .catch(() => {
        // 시스템 목록 로드 실패 시 ID 그대로 표시
      })
  }, [])

  if (!sessions.length) return null

  return (
    <div className="bg-bg-base flex min-h-screen flex-col items-center justify-center px-4 py-6">
      {/* 헤더 */}
      <div className="mb-1 text-center">
        <h2 className="text-text-primary text-lg font-semibold">이어서 진행할 대화가 있어요</h2>
      </div>
      <p className="text-text-secondary mb-1 text-sm">
        {maskEmployeeId(employeeId)}님 · 최근 {sessions.length}개
      </p>
      <p className="text-text-disabled mb-4 text-[11px] leading-relaxed">
        24시간 이내 같은 사번으로 진행한 대화를 이어가실 수 있어요
      </p>

      {/* 카드 리스트 */}
      <ul className="my-4 flex w-full max-w-md flex-col gap-2">
        {sessions.map((session) => (
          <li key={session.session_id}>
            <button
              type="button"
              onClick={() => onResume(session.session_id)}
              className="border-border bg-surface shadow-neu-flat hover:shadow-neu-pressed hover:border-accent focus:ring-accent w-full rounded-sm border px-3 py-3 text-left transition-all focus:ring-1 focus:outline-none"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-text-primary min-w-0 flex-1 truncate text-sm font-medium">
                  {session.title || '(제목 없음)'}
                </span>
                <span className="text-text-disabled shrink-0 text-xs">
                  {formatRelative(session.last_message_at)}
                </span>
              </div>

              {session.system_ids.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {session.system_ids.map((id) => (
                    <span
                      key={id}
                      className="bg-bg-base text-text-secondary rounded-sm px-1.5 py-0.5 text-xs"
                    >
                      {systemMap.get(id) ?? String(id)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* 하단 액션 */}
      <div className="flex w-full max-w-md items-center justify-between gap-2">
        <button
          type="button"
          onClick={onWipe}
          className="text-text-disabled hover:text-critical focus:ring-accent rounded-sm px-2 py-1.5 text-xs transition-colors focus:ring-1 focus:outline-none"
        >
          기록 모두 삭제
        </button>
        <NeuButton variant="primary" size="sm" onClick={onStartNew}>
          새 대화 시작
        </NeuButton>
      </div>
    </div>
  )
}
