import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, ExternalLink, Save, Pencil, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { ROUTES } from '@/constants/routes'
import {
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUS_STYLES,
  INCIDENT_SEVERITY_STYLES,
} from '@/constants/incident'
import { cn, formatKST, formatRelative } from '@/lib/utils'
import { useBannerVisible } from '@/hooks/useBannerVisible'
import { useUpdateIncident } from '@/hooks/queries/useIncidents'
import { useIncidentFeedback } from '@/hooks/queries/useIncidentFeedback'
import { FeedbackDetailView } from './FeedbackDetailView'
import { FeedbackForm } from './FeedbackForm'
import type { IncidentOut } from '@/api/incidents'

const PANEL_DESC_ID = 'incident-panel-desc'
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

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
  const open = !!incident
  const bannerVisible = useBannerVisible()
  const panelRef = useRef<HTMLDivElement>(null)

  // 닫힘 애니메이션 중에도 컨텐츠 유지
  const lastIncidentRef = useRef<IncidentOut | null>(null)
  if (incident) lastIncidentRef.current = incident
  const displayIncident = incident ?? lastIncidentRef.current

  // Focus trap + Escape (열려 있을 때만)
  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel — 항상 mount, 슬라이드 in/out */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={displayIncident ? `인시던트 #${displayIncident.id} 상세` : '인시던트 상세'}
        aria-describedby={PANEL_DESC_ID}
        aria-hidden={!open}
        className={cn(
          'border-border bg-surface fixed right-0 bottom-0 z-50 flex w-full max-w-md flex-col border-l transition-[translate,top] duration-300',
          bannerVisible ? 'top-12' : 'top-0',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {displayIncident && (
          <IncidentSidePanelContent incident={displayIncident} onClose={onClose} />
        )}
      </div>
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
  const { mutate: update, isPending } = useUpdateIncident(incident.id)

  const [severity, setSeverity] = useState(incident.severity)
  const [notes, setNotes] = useState(incident.root_cause ?? '')
  const [dirty, setDirty] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [isRevising, setIsRevising] = useState(false)

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(incident.title)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // 인시던트 피드백 조회 (all 상태)
  const { data: feedbacks } = useIncidentFeedback(incident.id, 'all')
  const latestFeedback = useMemo(
    () =>
      feedbacks?.length
        ? [...feedbacks].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )[0]
        : null,
    [feedbacks],
  )

  const canRegister = ['resolved', 'closed'].includes(incident.status)

  useEffect(() => {
    setSeverity(incident.severity)
    setNotes(incident.root_cause ?? '')
    setDirty(false)
    setIsRegistering(false)
    setIsRevising(false)
    setIsEditingTitle(false)
    setTitleDraft(incident.title)
  }, [incident.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isEditingTitle) titleInputRef.current?.focus()
  }, [isEditingTitle])

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

  const handleTitleSave = () => {
    const trimmed = titleDraft.trim()
    if (!trimmed) {
      toast.error('제목을 입력해주세요')
      setTitleDraft(incident.title)
      setIsEditingTitle(false)
      return
    }
    if (trimmed === incident.title) {
      setIsEditingTitle(false)
      return
    }
    update(
      { title: trimmed },
      {
        onSuccess: () => {
          toast.success('제목이 수정됐습니다')
          setIsEditingTitle(false)
        },
        onError: () => {
          toast.error('제목 수정에 실패했습니다')
          setTitleDraft(incident.title)
          setIsEditingTitle(false)
        },
      },
    )
  }

  const handleStatusChange = (nextStatus: string) => {
    update(
      { status: nextStatus },
      {
        onSuccess: () =>
          toast.success(
            `상태가 "${INCIDENT_STATUS_LABELS[nextStatus] ?? nextStatus}"로 변경됐습니다`,
          ),
        onError: () => toast.error('상태 변경에 실패했습니다'),
      },
    )
  }

  const nextStatuses = ALL_STATUSES.filter((s) => s.value !== incident.status)

  return (
    <>
      {/* 헤더 */}
      <div className="border-border flex items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="text-text-disabled mb-1 font-mono text-xs">#{incident.id}</div>
          {isEditingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setTitleDraft(incident.title)
                    setIsEditingTitle(false)
                  }
                }}
                onBlur={handleTitleSave}
                className="bg-bg-base border-border text-text-primary focus:ring-accent shadow-neu-inset min-w-0 flex-1 rounded-sm border px-2 py-0.5 text-sm leading-snug font-semibold focus:ring-1 focus:outline-none"
                disabled={isPending}
              />
              <button
                type="button"
                onClick={handleTitleSave}
                disabled={isPending}
                className="text-accent hover:text-accent/80 shrink-0 transition-colors"
                aria-label="제목 저장"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-1">
              <h2 className="text-text-primary line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-semibold">
                {incident.title}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(incident.title)
                  setIsEditingTitle(true)
                }}
                className="text-text-secondary hover:text-accent focus:ring-accent mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm transition-colors focus:ring-1 focus:outline-none"
                aria-label="제목 수정"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
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
              INCIDENT_STATUS_STYLES[incident.status] ??
                'bg-surface text-text-secondary border-border',
            )}
          >
            {INCIDENT_STATUS_LABELS[incident.status] ?? incident.status}
          </span>
          <span className="text-text-disabled text-xs">
            {formatRelative(incident.detected_at)}
            <span aria-hidden="true"> · </span>
            {formatKST(incident.detected_at, 'datetime')}
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
          <span
            className={cn('font-medium uppercase', INCIDENT_SEVERITY_STYLES[incident.severity])}
          >
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

        {/* 상태 전환 버튼들 */}
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

        {/* 해결책 섹션 */}
        <div>
          <p className="text-text-disabled mb-2 text-[0.75rem] font-semibold tracking-wider uppercase">
            해결책
          </p>

          {!canRegister ? (
            <p className="text-text-secondary text-sm">
              사건 종료 후 등록 가능합니다 (현재:{' '}
              {INCIDENT_STATUS_LABELS[incident.status] ?? incident.status})
            </p>
          ) : isRegistering || isRevising ? (
            <FeedbackForm
              incidentId={incident.id}
              mode={isRevising ? 'revise' : 'create'}
              existingFeedback={isRevising ? (latestFeedback ?? undefined) : undefined}
              onClose={() => {
                setIsRegistering(false)
                setIsRevising(false)
              }}
            />
          ) : latestFeedback ? (
            <FeedbackDetailView feedback={latestFeedback} onResubmit={() => setIsRevising(true)} />
          ) : (
            <NeuButton size="sm" onClick={() => setIsRegistering(true)}>
              해결책 등록
            </NeuButton>
          )}
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
    </>
  )
}
