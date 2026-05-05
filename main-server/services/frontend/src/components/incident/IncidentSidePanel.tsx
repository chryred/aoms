import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, ExternalLink, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { ROUTES } from '@/constants/routes'
import { cn, formatKST, formatRelative } from '@/lib/utils'
import { useBannerVisible } from '@/hooks/useBannerVisible'
import { useUpdateIncident } from '@/hooks/queries/useIncidents'
import type { IncidentOut } from '@/api/incidents'

const PANEL_DESC_ID = 'incident-panel-desc'
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const STATUS_LABELS: Record<string, string> = {
  open: '신규',
  acknowledged: '확인됨',
  investigating: '원인파악 중',
  resolved: '해결됨',
  closed: '종료',
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-critical/15 text-critical border-critical/30',
  acknowledged: 'bg-warning/15 text-warning border-warning/30',
  investigating: 'bg-accent/15 text-accent border-accent/30',
  resolved: 'bg-normal/15 text-normal border-normal/30',
  closed: 'bg-surface text-text-disabled border-border',
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
  info: 'text-text-secondary',
}

const ALL_STATUSES: { label: string; value: string }[] = [
  { label: '신규', value: 'open' },
  { label: '확인됨', value: 'acknowledged' },
  { label: '원인파악 중', value: 'investigating' },
  { label: '해결됨', value: 'resolved' },
  { label: '종료', value: 'closed' },
]

interface IncidentSidePanelProps {
  incident: IncidentOut | null
  onClose: () => void
}

function MttrText({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-text-disabled">—</span>
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return <span className="tabular-nums">{h > 0 ? `${h}h ${m}m` : `${m}m`}</span>
}

export function IncidentSidePanel({ incident, onClose }: IncidentSidePanelProps) {
  if (!incident) return null
  return (
    <>
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden="true"
        role="presentation"
      />
      <IncidentSidePanelContent incident={incident} onClose={onClose} />
    </>
  )
}

function IncidentSidePanelContent({
  incident,
  onClose,
}: {
  incident: IncidentOut
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { mutate: update, isPending } = useUpdateIncident(incident.id)
  const bannerVisible = useBannerVisible()

  const [severity, setSeverity] = useState(incident.severity)
  const [notes, setNotes] = useState(incident.root_cause ?? '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setSeverity(incident.severity)
    setNotes(incident.root_cause ?? '')
    setDirty(false)
  }, [incident.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Focus trap + Escape
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSave = () => {
    update(
      { severity, root_cause: notes || undefined },
      {
        onSuccess: () => {
          toast.success('저장됐습니다')
          setDirty(false)
        },
        onError: () => toast.error('저장에 실패했습니다'),
      },
    )
  }

  const handleStatusChange = (nextStatus: string) => {
    update(
      { status: nextStatus },
      {
        onSuccess: () =>
          toast.success(`상태가 "${STATUS_LABELS[nextStatus] ?? nextStatus}"로 변경됐습니다`),
        onError: () => toast.error('상태 변경에 실패했습니다'),
      },
    )
  }

  const nextStatuses = ALL_STATUSES.filter((s) => s.value !== incident.status)

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`인시던트 #${incident.id} 상세`}
      aria-describedby={PANEL_DESC_ID}
      className={cn(
        'fixed right-0 bottom-0 z-40 flex flex-col transition-[top] duration-200',
        bannerVisible ? 'top-9' : 'top-0',
        'bg-surface border-border shadow-neu-flat border-l',
        'w-full max-w-md',
      )}
    >
      {/* 헤더 */}
      <div className="border-border flex items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-text-disabled mb-1 font-mono text-xs">#{incident.id}</div>
          <h2 className="text-text-primary line-clamp-2 text-sm font-semibold leading-snug">
            {incident.title}
          </h2>
          <p id={PANEL_DESC_ID} className="text-text-secondary mt-1 text-xs">
            {incident.system_display_name ?? '시스템 미지정'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="패널 닫기"
          className="text-text-disabled hover:text-text-secondary mt-0.5 shrink-0 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 스크롤 영역 */}
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* 상태 배지 + 감지 시각 */}
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
              STATUS_STYLES[incident.status] ?? 'bg-surface text-text-secondary border-border',
            )}
          >
            {STATUS_LABELS[incident.status] ?? incident.status}
          </span>
          <span className="text-text-disabled text-xs">
            {formatRelative(incident.detected_at)} · {formatKST(incident.detected_at, 'datetime')}
          </span>
        </div>

        {/* MTTR */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-text-disabled mb-1 text-[0.75rem]">MTTR</p>
            <p className="text-text-secondary text-sm">
              <MttrText minutes={incident.mttr_minutes} />
            </p>
          </div>
          <div>
            <p className="text-text-disabled mb-1 text-[0.75rem]">알림 수</p>
            <p className="text-text-secondary text-sm tabular-nums">{incident.alert_count}건</p>
          </div>
        </div>

        {/* 심각도 편집 */}
        <NeuSelect
          label="심각도"
          id="panel-severity"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value)
            setDirty(true)
          }}
          aria-label="심각도 수정"
        >
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </NeuSelect>
        <p className="text-text-disabled -mt-3 text-xs">
          현재:{' '}
          <span className={cn('font-medium uppercase', SEVERITY_STYLES[incident.severity])}>
            {incident.severity}
          </span>
        </p>

        {/* 메모 / 근본 원인 편집 */}
        <NeuTextarea
          id="panel-notes"
          label="메모 / 근본 원인"
          placeholder="상황 메모, 근본 원인 분석 내용을 기록하세요"
          rows={4}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setDirty(true)
          }}
        />

        {/* 저장 버튼 */}
        {dirty && (
          <NeuButton size="sm" onClick={handleSave} disabled={isPending} className="w-full">
            <Save className="h-3.5 w-3.5" />
            {isPending ? '저장 중...' : '변경 사항 저장'}
          </NeuButton>
        )}

        {/* 상태 전환 버튼들 — 현재 상태 제외한 모든 상태 허용 */}
        <div>
          <p className="text-text-disabled mb-2 text-[0.75rem]">상태 전환</p>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map(({ label, value }) => (
              <NeuButton
                key={value}
                size="sm"
                variant="ghost"
                onClick={() => handleStatusChange(value)}
                disabled={isPending}
              >
                {label}
              </NeuButton>
            ))}
          </div>
        </div>
      </div>

      {/* 하단: 상세 페이지 이동 */}
      <div className="border-border border-t px-5 py-3">
        <Link
          to={ROUTES.incidentDetail(incident.id)}
          className="text-accent hover:text-accent/80 flex w-full items-center justify-center gap-1.5 text-sm transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          상세 페이지에서 보기
        </Link>
      </div>
    </div>
  )
}
