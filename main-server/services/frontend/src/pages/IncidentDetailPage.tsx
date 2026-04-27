import { useState } from 'react'
import toast from 'react-hot-toast'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  ScanSearch,
  MessageSquare,
  FileSearch,
} from 'lucide-react'
import {
  useAiAnalyzeIncident,
  useAddIncidentComment,
  useIncident,
  useUpdateIncident,
} from '@/hooks/queries/useIncidents'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { ROUTES } from '@/constants/routes'
import { formatKST, formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { AlertDetailPanel } from '@/components/alert/AlertDetailPanel'
import { IncidentReportModal } from '@/components/incident/IncidentReportModal'
import type { IncidentTimelineItem } from '@/api/incidents'
import type { AlertHistory } from '@/types/alert'

const STATUS_LABELS: Record<string, string> = {
  open: '신규',
  acknowledged: '확인됨',
  investigating: '원인파악 중',
  resolved: '해결됨',
  closed: '종료',
}

const STATUS_NEXT: Record<string, { label: string; value: string }[]> = {
  open: [
    { label: '확인', value: 'acknowledged' },
    { label: '조사 시작', value: 'investigating' },
    { label: '해결 처리', value: 'resolved' },
  ],
  acknowledged: [
    { label: '조사 시작', value: 'investigating' },
    { label: '해결 처리', value: 'resolved' },
  ],
  investigating: [{ label: '해결 처리', value: 'resolved' }],
  resolved: [{ label: '종료 처리', value: 'closed' }],
  closed: [],
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  alert_added: <AlertTriangle className="text-critical h-3.5 w-3.5" />,
  analysis_added: <FileSearch className="text-warning h-3.5 w-3.5" />,
  status_changed: <CheckCircle2 className="text-normal h-3.5 w-3.5" />,
  comment: <MessageSquare className="text-text-secondary h-3.5 w-3.5" />,
}

function MttrLabel({
  label,
  title,
  minutes,
}: {
  label: string
  title: string
  minutes: number | null
}) {
  const formatted = (() => {
    if (minutes === null) return '—'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  })()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-secondary text-xs" title={title}>
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-medium tabular-nums',
          minutes === null ? 'text-text-disabled' : 'text-text-primary',
        )}
      >
        {formatted}
      </span>
    </div>
  )
}

export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const incidentId = Number(id)
  const navigate = useNavigate()

  const { data: incident, isLoading, isError } = useIncident(incidentId)
  const updateMut = useUpdateIncident(incidentId)
  const commentMut = useAddIncidentComment(incidentId)

  const [editMode, setEditMode] = useState(false)
  const [rootCause, setRootCause] = useState('')
  const [resolution, setResolution] = useState('')
  const [postmortem, setPostmortem] = useState('')
  const [comment, setComment] = useState('')
  const [selectedAlert, setSelectedAlert] = useState<AlertHistory | null>(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [confirmAnalyze, setConfirmAnalyze] = useState(false)

  const aiAnalyzeMut = useAiAnalyzeIncident()

  if (isLoading) return <LoadingSkeleton shape="card" count={3} />
  if (isError || !incident) return <ErrorCard message="인시던트 정보를 불러오지 못했습니다" />

  const handleStatusChange = (nextStatus: string) => {
    updateMut.mutate({ status: nextStatus })
  }

  const handleSaveDetail = () => {
    updateMut.mutate({
      root_cause: rootCause || incident.root_cause || undefined,
      resolution: resolution || incident.resolution || undefined,
      postmortem: postmortem || incident.postmortem || undefined,
    })
    setEditMode(false)
  }

  const handleComment = () => {
    if (!comment.trim()) return
    commentMut.mutate(comment.trim(), { onSuccess: () => setComment('') })
  }

  const runDevxAnalyze = () => {
    setConfirmAnalyze(false)
    aiAnalyzeMut.mutate(incidentId, {
      onSuccess: (data) => {
        setRootCause(data.root_cause)
        setResolution(data.resolution)
        setPostmortem(data.postmortem)
        toast.success('DevX 분석이 3개 필드에 자동 입력되었습니다')
      },
      onError: () => {
        toast.error('DevX 분석에 실패했습니다. 잠시 후 다시 시도해주세요.')
      },
    })
  }

  const handleDevxAnalyze = () => {
    const hasExisting =
      Boolean(rootCause.trim()) || Boolean(resolution.trim()) || Boolean(postmortem.trim())
    if (hasExisting && !confirmAnalyze) {
      setConfirmAnalyze(true)
      return
    }
    runDevxAnalyze()
  }

  const nextActions = STATUS_NEXT[incident.status] ?? []

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-start gap-3">
        <NeuButton
          size="sm"
          variant="ghost"
          onClick={() => navigate(ROUTES.INCIDENTS)}
          className="mt-0.5 shrink-0"
          aria-label="인시던트 목록으로 돌아가기"
        >
          <ArrowLeft className="h-4 w-4" />
        </NeuButton>
        <div className="min-w-0 flex-1">
          <PageHeader title={incident.title} description={`인시던트 #${incident.id}`} />
        </div>
      </div>

      {/* 상태 + 심각도 배지 */}
      <NeuCard>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'text-sm font-semibold whitespace-nowrap uppercase',
                SEVERITY_STYLES[incident.severity] ?? 'text-text-secondary',
              )}
            >
              {incident.severity}
            </span>
            <span className="text-text-disabled">·</span>
            <span className="text-text-primary text-sm font-medium whitespace-nowrap">
              {STATUS_LABELS[incident.status] ?? incident.status}
            </span>
            {incident.system_display_name && (
              <>
                <span className="text-text-disabled">·</span>
                <span className="text-text-secondary text-sm whitespace-nowrap">
                  {incident.system_display_name}
                </span>
              </>
            )}
            {incident.recurrence_of && (
              <span className="bg-warning/15 border-warning/30 text-warning rounded-full border px-2 py-0.5 text-xs whitespace-nowrap">
                재발 (#{incident.recurrence_of})
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {incident.status === 'closed' && (
              <span className="text-text-disabled border-border rounded-sm border px-2 py-1 text-xs">
                종료된 인시던트
              </span>
            )}
            {nextActions.map((action, idx) => (
              <NeuButton
                key={action.value}
                size="sm"
                variant={idx === 0 ? 'primary' : 'ghost'}
                onClick={() => handleStatusChange(action.value)}
                disabled={updateMut.isPending}
              >
                {updateMut.isPending && idx === 0 ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="whitespace-nowrap">{action.label}</span>
                )}
              </NeuButton>
            ))}
          </div>
        </div>
      </NeuCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 좌측: 상세 정보 */}
        <div className="space-y-4 lg:col-span-2">
          {/* 시각 정보 */}
          <NeuCard>
            <h3 className="text-text-secondary mb-3 text-xs font-semibold tracking-wider uppercase">
              타임라인 요약
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-text-secondary mb-0.5 text-xs">감지</p>
                <p className="text-text-primary text-sm">
                  {formatKST(incident.detected_at, 'datetime')}
                </p>
              </div>
              {incident.acknowledged_at && (
                <div>
                  <p className="text-text-secondary mb-0.5 text-xs">확인</p>
                  <p className="text-text-primary text-sm">
                    {formatKST(incident.acknowledged_at, 'datetime')}
                  </p>
                </div>
              )}
              {incident.resolved_at && (
                <div>
                  <p className="text-text-secondary mb-0.5 text-xs">해결</p>
                  <p className="text-text-primary text-sm">
                    {formatKST(incident.resolved_at, 'datetime')}
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <MttrLabel
                  label="MTTA"
                  title="감지 → 확인 처리까지 소요 시간"
                  minutes={incident.mtta_minutes}
                />
                <MttrLabel
                  label="MTTR"
                  title="감지 → 해결 완료까지 소요 시간"
                  minutes={incident.mttr_minutes}
                />
              </div>
            </div>
          </NeuCard>

          {/* 근본 원인 / 조치 / 사후 분석 */}
          <NeuCard>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-text-secondary text-xs font-semibold tracking-wider uppercase">
                분석 및 조치
              </h3>
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!editMode) {
                    setRootCause(incident.root_cause ?? '')
                    setResolution(incident.resolution ?? '')
                    setPostmortem(incident.postmortem ?? '')
                  }
                  setEditMode(!editMode)
                }}
              >
                {editMode ? '취소' : '편집'}
              </NeuButton>
            </div>

            {/* Read mode — editMode=true 시 grid-rows-[0fr]로 축소 애니메이션 */}
            <div
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]',
                editMode ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
              )}
            >
              <div className="overflow-hidden">
                {!incident.root_cause && !incident.resolution && !incident.postmortem ? (
                  <p className="text-text-disabled text-sm">
                    아직 분석 내용이 없습니다.{' '}
                    <button
                      type="button"
                      className="text-accent underline-offset-2 hover:underline"
                      onClick={() => {
                        setRootCause('')
                        setResolution('')
                        setPostmortem('')
                        setEditMode(true)
                      }}
                    >
                      편집하여 추가하세요
                    </button>
                  </p>
                ) : (
                  <div className="space-y-3">
                    {[
                      { label: '근본 원인', value: incident.root_cause },
                      { label: '조치 내용', value: incident.resolution },
                      { label: '사후 분석', value: incident.postmortem },
                    ]
                      .filter(({ value }) => value)
                      .map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-text-secondary mb-0.5 text-xs">{label}</p>
                          <p className="text-text-primary text-sm whitespace-pre-wrap">{value}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Edit mode — editMode=false 시 grid-rows-[0fr]로 축소 애니메이션 */}
            <div
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]',
                editMode ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
              aria-hidden={!editMode}
            >
              <div className="overflow-hidden">
                <div className="space-y-3">
                  {/* AI 도우미 액션 바 — 흐름: 분석 → 저장 → 요약 */}
                  <div className="bg-surface border-border flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2">
                    <span className="text-text-secondary mr-1 text-xs">AI 도우미:</span>
                    {confirmAnalyze ? (
                      <>
                        <span className="text-warning text-xs whitespace-nowrap">
                          기존 내용을 덮어씁니다
                        </span>
                        <NeuButton size="sm" variant="ghost" onClick={runDevxAnalyze}>
                          덮어쓰기
                        </NeuButton>
                        <NeuButton
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmAnalyze(false)}
                        >
                          취소
                        </NeuButton>
                      </>
                    ) : (
                      <NeuButton
                        size="sm"
                        variant="ghost"
                        onClick={handleDevxAnalyze}
                        disabled={aiAnalyzeMut.isPending}
                      >
                        {aiAnalyzeMut.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ScanSearch className="h-3.5 w-3.5" />
                        )}
                        DevX 분석
                      </NeuButton>
                    )}
                    {!confirmAnalyze && (
                      <NeuButton
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowReportModal(true)}
                        disabled={aiAnalyzeMut.isPending}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        요약 보고서
                      </NeuButton>
                    )}
                    <span className="text-text-disabled ml-auto text-[11px]">
                      분석 → 저장 → 요약 순으로 활용하세요
                    </span>
                  </div>

                  <div>
                    <label className="text-text-primary mb-1.5 block text-xs font-medium">
                      근본 원인
                    </label>
                    <textarea
                      className="bg-bg-base text-text-primary placeholder:text-text-secondary focus:border-accent focus:ring-accent shadow-neu-inset w-full resize-none rounded-sm border border-transparent p-2.5 text-sm focus:border focus:ring-1 focus:outline-none"
                      rows={8}
                      value={rootCause}
                      onChange={(e) => setRootCause(e.target.value)}
                      placeholder="어떤 원인으로 장애가 발생했는지 기록하세요 (예: 트래픽 급증, 잘못된 배포, 외부 의존성 장애)"
                    />
                  </div>
                  <div>
                    <label className="text-text-primary mb-1.5 block text-xs font-medium">
                      조치 내용
                    </label>
                    <textarea
                      className="bg-bg-base text-text-primary placeholder:text-text-secondary focus:border-accent focus:ring-accent shadow-neu-inset w-full resize-none rounded-sm border border-transparent p-2.5 text-sm focus:border focus:ring-1 focus:outline-none"
                      rows={8}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      placeholder="서비스 복구를 위해 취한 조치와 변경 사항을 기록하세요"
                    />
                  </div>
                  <div>
                    <label className="text-text-primary mb-1.5 block text-xs font-medium">
                      사후 분석
                    </label>
                    <textarea
                      className="bg-bg-base text-text-primary placeholder:text-text-secondary focus:border-accent focus:ring-accent shadow-neu-inset w-full resize-none rounded-sm border border-transparent p-2.5 text-sm focus:border focus:ring-1 focus:outline-none"
                      rows={8}
                      value={postmortem}
                      onChange={(e) => setPostmortem(e.target.value)}
                      placeholder="이 장애에서 얻은 교훈과 재발 방지를 위한 개선 액션을 기록하세요"
                    />
                  </div>
                  <NeuButton
                    size="sm"
                    variant="primary"
                    onClick={handleSaveDetail}
                    disabled={updateMut.isPending}
                  >
                    저장
                  </NeuButton>
                </div>
              </div>
            </div>
          </NeuCard>

          {/* 연결된 알림 이력 */}
          {incident.alert_history.length > 0 && (
            <NeuCard className="p-0">
              <div className="border-border border-b px-4 py-3">
                <h3 className="text-text-secondary text-xs font-semibold tracking-wider uppercase">
                  연결된 알림 ({incident.alert_history.length}건)
                </h3>
              </div>
              <div className="divide-border/50 divide-y">
                {incident.alert_history.map((alert) => (
                  <button
                    type="button"
                    key={alert.id}
                    onClick={() => setSelectedAlert(alert)}
                    className="hover:bg-surface focus:ring-accent focus:bg-surface flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors focus:ring-1 focus:outline-none"
                    aria-label={`알림 ${alert.id} 상세 열기`}
                  >
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 text-xs font-semibold uppercase',
                        alert.severity === 'critical' ? 'text-critical' : 'text-warning',
                      )}
                    >
                      {alert.severity}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-text-primary line-clamp-1 text-sm">{alert.title}</p>
                      {alert.instance_role && (
                        <p className="text-text-secondary text-xs">{alert.instance_role}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {alert.resolved_at ? (
                        <CheckCircle2 className="text-normal h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="text-critical h-3.5 w-3.5" />
                      )}
                      <p className="text-text-disabled mt-0.5 text-xs">
                        {formatRelative(alert.created_at)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </NeuCard>
          )}
        </div>

        {/* 우측: 타임라인 + 댓글 */}
        <div className="space-y-4">
          <NeuCard>
            <h3 className="text-text-secondary mb-3 text-xs font-semibold tracking-wider uppercase">
              타임라인
            </h3>

            {incident.timeline.length === 0 ? (
              <p className="text-text-disabled text-xs">아직 기록된 이벤트가 없습니다</p>
            ) : (
              <div className="relative space-y-0">
                <div className="bg-border absolute top-2 bottom-2 left-[11px] w-px" />
                {incident.timeline.map((item: IncidentTimelineItem) => (
                  <div key={item.id} className="relative flex gap-3 pb-3 last:pb-0">
                    <div className="bg-surface border-border relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border">
                      {EVENT_ICONS[item.event_type] ?? (
                        <Clock className="text-text-disabled h-3 w-3" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-text-primary text-xs leading-snug break-words">
                        {item.description}
                      </p>
                      <p className="text-text-disabled mt-0.5 text-xs">
                        {item.actor_name} · {formatRelative(item.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 댓글 입력 */}
            <div className="border-border mt-4 space-y-2 border-t pt-3">
              <label htmlFor="incident-comment" className="sr-only">
                활동 메모
              </label>
              <textarea
                id="incident-comment"
                className="border-border bg-bg-base text-text-primary placeholder:text-text-disabled focus:border-accent focus:ring-accent w-full resize-none rounded-sm border p-2 text-xs focus:ring-1 focus:outline-none"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="경과 메모, 확인 사항, 참고 링크 등을 기록하세요"
              />
              <NeuButton
                size="sm"
                variant="secondary"
                onClick={handleComment}
                disabled={!comment.trim() || commentMut.isPending}
                className="w-full"
              >
                {commentMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  '메모 추가'
                )}
              </NeuButton>
            </div>
          </NeuCard>
        </div>
      </div>

      <AlertDetailPanel alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      <IncidentReportModal
        incidentId={showReportModal ? incidentId : null}
        title={incident.title}
        onClose={() => setShowReportModal(false)}
      />
    </div>
  )
}
