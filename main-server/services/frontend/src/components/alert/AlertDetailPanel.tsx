import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, CheckCircle, Lightbulb, Siren, ChevronDown, RefreshCw } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { AnomalyTypeBadge } from './AnomalyTypeBadge'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { formatAlertTitle } from './alertTitle'
import { useAcknowledgeAlert } from '@/hooks/mutations/useAcknowledgeAlert'
import { useIncidentFeedback } from '@/hooks/queries/useIncidentFeedback'
import { useAuthStore } from '@/store/authStore'
import { useBannerVisible } from '@/hooks/useBannerVisible'
import { cn, formatKST } from '@/lib/utils'
import { FeedbackDetailView } from '@/components/incident/FeedbackDetailView'
import { AlertReclassifyPanel } from './AlertReclassifyPanel'
import type { AlertHistory } from '@/types/alert'

const ALERT_TYPE_LABELS: Record<string, string> = {
  metric: '메트릭 알림',
  metric_resolved: '메트릭 복구',
  log_analysis: '로그 분석',
}

const PANEL_TITLE_ID = 'alert-detail-panel-title'

interface AlertDetailPanelProps {
  alert: AlertHistory | null
  onClose: () => void
}

interface ParsedDescription {
  severity?: string
  anomaly_item?: string
  root_cause?: string
  recommendation?: string
  log_content?: string
}

// LLM이 JSON 값 안에 literal "\n" 문자열(두 글자)을 그대로 흘리는 경우도 있어
// 실제 개행문자로 정규화. 번호 목록 사이 공백만 있는 경우에도 개행을 강제 삽입.
function normalizeMultiline(text: string | undefined): string | undefined {
  if (!text) return text
  let out = text.replace(/\\n/g, '\n')
  // "1) ... 2) ... 3) ..." 처럼 한 줄에 번호가 이어진 경우 앞에 개행 삽입
  out = out.replace(/\s+(\d+\))\s/g, '\n$1 ')
  return out.trim()
}

function parseDescription(desc: string | null | undefined): ParsedDescription | null {
  if (!desc) return null
  try {
    const obj = JSON.parse(desc)
    // 분석 결과 JSON 스키마로 인식할 수 있는 키가 하나라도 있으면 "파싱 성공"으로 본다.
    if (
      obj &&
      typeof obj === 'object' &&
      ('root_cause' in obj ||
        'recommendation' in obj ||
        'anomaly_type' in obj ||
        'severity' in obj ||
        'log_content' in obj ||
        'immediate_action' in obj ||
        'reclassified_templates' in obj)
    ) {
      return {
        ...obj,
        root_cause: normalizeMultiline(obj.root_cause),
        // 기존 데이터 호환: immediate_action → recommendation 폴백
        recommendation: normalizeMultiline(obj.recommendation ?? obj.immediate_action),
      } as ParsedDescription
    }
  } catch {
    // not JSON — caller falls back to raw display
  }
  return null
}

export function AlertDetailPanel({ alert, onClose }: AlertDetailPanelProps) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const bannerVisible = useBannerVisible()
  const { mutate: acknowledge, isPending } = useAcknowledgeAlert()
  const panelRef = useRef<HTMLDivElement>(null)
  const [reclassifyOpen, setReclassifyOpen] = useState(false)

  // 닫힘 애니메이션 중에도 컨텐츠가 보이도록 마지막 alert를 유지
  const lastAlertRef = useRef<AlertHistory | null>(null)
  if (alert) lastAlertRef.current = alert
  const displayAlert = alert ?? lastAlertRef.current
  const open = !!alert

  const parsedDesc = useMemo(
    () => parseDescription(displayAlert?.description),
    [displayAlert?.description],
  )

  const [isLogExpanded, setIsLogExpanded] = useState(false)

  useEffect(() => {
    setIsLogExpanded(false)
  }, [displayAlert?.id])

  const logAccordion = parsedDesc?.log_content ? (
    <div>
      <button
        type="button"
        onClick={() => setIsLogExpanded((v) => !v)}
        className="type-label flex w-full items-center gap-1 text-left"
      >
        원본 로그
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform duration-200', isLogExpanded && 'rotate-180')}
        />
      </button>
      {isLogExpanded && (
        <div className="bg-bg-base shadow-neu-inset mt-1.5 max-h-96 overflow-y-auto rounded-sm p-4">
          <pre className="text-text-primary font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {parsedDesc.log_content}
          </pre>
        </div>
      )}
    </div>
  ) : null

  // 인시던트 단위 피드백 조회 (incident_id가 있을 때만)
  const { data: feedbacks } = useIncidentFeedback(displayAlert?.incident_id ?? null, 'all')
  const latestFeedback =
    feedbacks?.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0] ?? null

  // When panel closes, blur focused element inside to avoid aria-hidden-on-focus warning
  useEffect(() => {
    if (!open && panelRef.current) {
      const focused = panelRef.current.contains(document.activeElement)
      if (focused && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }
  }, [open])

  // Focus trap + ESC close
  useEffect(() => {
    if (!alert) return

    const panel = panelRef.current
    if (!panel) return

    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))

    const focusables = getFocusable()
    focusables[0]?.focus()

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
  }, [alert, onClose])

  const handleAck = () => {
    if (!alert || !displayAlert) return
    acknowledge({ id: displayAlert.id, by: user?.name ?? 'unknown' }, { onSuccess: onClose })
  }

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={PANEL_TITLE_ID}
        aria-hidden={!open}
        className={cn(
          'border-border bg-bg-base fixed right-0 bottom-0 z-50 flex w-full max-w-[460px] flex-col border-l transition-[translate,top] duration-300',
          bannerVisible ? 'top-12' : 'top-0',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {displayAlert && (
          <>
            {/* 헤더 */}
            <div className="border-border flex items-start justify-between border-b px-6 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={displayAlert.severity} size="md" />
                <span className="text-text-secondary text-sm">
                  {ALERT_TYPE_LABELS[displayAlert.alert_type] ?? displayAlert.alert_type}
                </span>
                {displayAlert.error_message && (
                  <NeuBadge variant="critical">LLM 분석 실패</NeuBadge>
                )}
                {displayAlert.acknowledged && (
                  <NeuBadge variant="normal">
                    <CheckCircle className="mr-0.5 h-3 w-3" />
                    확인됨
                  </NeuBadge>
                )}
                {displayAlert.incident_id && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      navigate(ROUTES.incidentDetail(displayAlert.incident_id!))
                    }}
                    className="text-critical bg-critical/10 border-critical/30 hover:bg-critical/15 focus:ring-critical inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs focus:ring-1 focus:outline-none"
                  >
                    <Siren className="h-3 w-3" />
                    인시던트 #{displayAlert.incident_id}
                  </button>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="알림 상세 닫기"
                className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 내용 */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <h3 id={PANEL_TITLE_ID} className="text-text-primary text-base font-semibold">
                  {formatAlertTitle(displayAlert.title)}
                </h3>
              </div>

              {/* 메타 정보 */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="type-label">발생 시각</p>
                  <p className="text-text-primary mt-0.5">{formatKST(displayAlert.created_at)}</p>
                </div>
                {displayAlert.resolved_at && (
                  <div>
                    <p className="type-label">복구 시각</p>
                    <p className="text-normal mt-0.5">{formatKST(displayAlert.resolved_at)}</p>
                  </div>
                )}
                {displayAlert.alertname && (
                  <div>
                    <p className="type-label">Alert Name</p>
                    <p className="text-text-primary mt-0.5 font-mono text-xs break-all">
                      {displayAlert.alertname}
                    </p>
                  </div>
                )}
                {displayAlert.instance_role && (
                  <div>
                    <p className="type-label">인스턴스 역할</p>
                    <p className="text-text-primary mt-0.5">{displayAlert.instance_role}</p>
                  </div>
                )}
                {displayAlert.host && (
                  <div>
                    <p className="type-label">호스트</p>
                    <p className="text-text-primary mt-0.5 font-mono text-xs break-all">
                      {displayAlert.host}
                    </p>
                  </div>
                )}
              </div>

              {/* 유사도 분석 */}
              {displayAlert.anomaly_type && (
                <div>
                  <p className="type-label mb-1.5">이상 유형</p>
                  <AnomalyTypeBadge
                    type={displayAlert.anomaly_type}
                    score={displayAlert.similarity_score}
                  />
                </div>
              )}

              {/* 연관 Trace ID */}
              {displayAlert.related_trace_ids && displayAlert.related_trace_ids.length > 0 && (
                <div>
                  <p className="type-label mb-1.5">연관 Trace ID</p>
                  <div className="flex flex-wrap gap-1.5">
                    {displayAlert.related_trace_ids.map((tid) => (
                      <span
                        key={tid}
                        className="border-border bg-bg-base rounded-sm border px-2 py-0.5 font-mono text-xs"
                      >
                        {tid}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 원본 로그 + 분석 결과 */}
              {displayAlert.error_message ? (
                <>
                  {logAccordion ?? (
                    displayAlert.description && (
                      <div>
                        <p className="type-label mb-1.5">상세 내용</p>
                        <div className="bg-bg-base shadow-neu-inset rounded-sm p-4">
                          <p className="text-text-primary text-sm leading-relaxed break-words whitespace-pre-wrap">
                            {displayAlert.description}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                  <div>
                    <p className="type-label mb-1">분석 실패 사유</p>
                    <p className="text-text-secondary font-mono text-xs break-all">
                      {displayAlert.error_message}
                    </p>
                  </div>
                </>
              ) : parsedDesc ? (
                <>
                  {logAccordion}
                  {parsedDesc.root_cause && (
                    <div>
                      <p className="type-label mb-1.5">근본 원인</p>
                      <div className="bg-bg-base shadow-neu-inset rounded-sm p-4">
                        <p className="text-text-primary text-sm leading-relaxed break-words whitespace-pre-wrap">
                          {parsedDesc.root_cause}
                        </p>
                      </div>
                    </div>
                  )}
                  {parsedDesc.recommendation && (
                    <div className="border-accent rounded-sm border p-4">
                      <div className="mb-2.5 flex items-center gap-2">
                        <Lightbulb className="text-accent h-5 w-5" aria-hidden="true" />
                        <p className="text-accent text-lg font-bold tracking-tight">해결방안</p>
                      </div>
                      <p className="text-text-primary text-base leading-relaxed font-medium break-words whitespace-pre-wrap">
                        {parsedDesc.recommendation}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                displayAlert.description && (
                  <div>
                    <p className="type-label mb-1.5">상세 내용</p>
                    <div className="bg-bg-base shadow-neu-inset rounded-sm p-4">
                      <p className="text-text-primary text-sm leading-relaxed break-words whitespace-pre-wrap">
                        {displayAlert.description}
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* 확인 처리 이력 */}
              {displayAlert.acknowledged && displayAlert.acknowledged_by && (
                <div>
                  <p className="type-label mb-1.5">처리 정보</p>
                  <p className="text-text-secondary text-sm">
                    {displayAlert.acknowledged_by}
                    {displayAlert.acknowledged_at &&
                      ` · ${formatKST(displayAlert.acknowledged_at)}`}
                  </p>
                </div>
              )}

              {/* 등록된 피드백 (read-only) — 인시던트 단위 */}
              {displayAlert.acknowledged && (
                <div>
                  <p className="type-label mb-2">등록된 피드백</p>
                  {!displayAlert.incident_id ? (
                    <p className="text-text-secondary text-sm">
                      이 알림은 인시던트와 연결되어 있지 않습니다.
                    </p>
                  ) : latestFeedback ? (
                    <FeedbackDetailView
                      feedback={latestFeedback}
                      onResubmit={() => navigate(ROUTES.incidentDetail(displayAlert.incident_id!))}
                    />
                  ) : (
                    <p className="text-text-secondary text-sm">아직 등록된 피드백이 없습니다.</p>
                  )}
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="border-border space-y-2 border-t px-6 py-4">
              {!displayAlert.acknowledged && (
                <NeuButton className="w-full" loading={isPending} onClick={handleAck}>
                  <CheckCircle className="h-4 w-4" />
                  확인 처리
                </NeuButton>
              )}
              {displayAlert.incident_id && (
                <NeuButton
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    onClose()
                    navigate(ROUTES.incidentDetail(displayAlert.incident_id!))
                  }}
                >
                  인시던트에서 해결책 관리
                </NeuButton>
              )}
              {displayAlert.alert_type === 'log_analysis' &&
                displayAlert.log_analysis_id && (
                  <NeuButton
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setReclassifyOpen(true)}
                  >
                    <RefreshCw className="h-4 w-4" />
                    알림성/실에러 재분류
                  </NeuButton>
                )}
            </div>
          </>
        )}
      </div>

      <AlertReclassifyPanel
        alert={reclassifyOpen ? displayAlert : null}
        onClose={() => setReclassifyOpen(false)}
        onSuccess={() => setReclassifyOpen(false)}
      />
    </>
  )
}
