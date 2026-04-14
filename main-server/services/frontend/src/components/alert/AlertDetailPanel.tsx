import { useEffect, useMemo, useRef, useState } from 'react'
import { X, CheckCircle, ChevronDown, Pencil } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { AnomalyTypeBadge } from './AnomalyTypeBadge'
import { useAcknowledgeAlert } from '@/hooks/mutations/useAcknowledgeAlert'
import { useCreateFeedback } from '@/hooks/mutations/useCreateFeedback'
import { useUpdateFeedback } from '@/hooks/mutations/useUpdateFeedback'
import { useFeedbacks } from '@/hooks/queries/useFeedbacks'
import { useAuthStore } from '@/store/authStore'
import { cn, formatKST } from '@/lib/utils'
import type { AlertHistory, Severity } from '@/types/alert'

const SEVERITY_VARIANT: Record<Severity, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  metric: '메트릭 알림',
  metric_resolved: '메트릭 복구',
  log_analysis: '로그 분석',
}

const ERROR_TYPES = [
  'DB 연결 오류',
  '메모리 부족',
  '디스크 부족',
  '네트워크 오류',
  '타임아웃',
  '애플리케이션 오류',
  '기타',
] as const

const PANEL_TITLE_ID = 'alert-detail-panel-title'

interface AlertDetailPanelProps {
  alert: AlertHistory | null
  onClose: () => void
}

interface ParsedDescription {
  severity?: string
  root_cause?: string
  recommendation?: string
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
    if (obj && typeof obj === 'object' && (obj.root_cause || obj.recommendation)) {
      return {
        ...obj,
        root_cause: normalizeMultiline(obj.root_cause),
        recommendation: normalizeMultiline(obj.recommendation),
      } as ParsedDescription
    }
  } catch {
    // not JSON — caller falls back to raw display
  }
  return null
}

export function AlertDetailPanel({ alert, onClose }: AlertDetailPanelProps) {
  const user = useAuthStore((s) => s.user)
  const { mutate: acknowledge, isPending } = useAcknowledgeAlert()
  const { mutate: createFeedback, isPending: isFeedbackPending } = useCreateFeedback()
  const { mutate: updateFeedback, isPending: isUpdatePending } = useUpdateFeedback()
  const panelRef = useRef<HTMLDivElement>(null)

  const [showSolution, setShowSolution] = useState(false)
  const [errorType, setErrorType] = useState('기타')
  const [solution, setSolution] = useState('')

  // 기등록 피드백 수정 상태
  const [isEditing, setIsEditing] = useState(false)
  const [editErrorType, setEditErrorType] = useState('기타')
  const [editSolution, setEditSolution] = useState('')

  const parsedDesc = useMemo(() => parseDescription(alert?.description), [alert?.description])

  // 확인된 알림일 때만 피드백 조회
  const { data: feedbacks } = useFeedbacks(
    alert?.acknowledged && alert.id ? alert.id : null,
  )
  const existingFeedback = feedbacks?.[0] ?? null

  // Reset all transient state when alert changes
  useEffect(() => {
    setShowSolution(false)
    setErrorType('기타')
    setSolution('')
    setIsEditing(false)
  }, [alert?.id])

  // 수정 모드 진입 시 기존 피드백 값으로 폼 초기화
  useEffect(() => {
    if (isEditing && existingFeedback) {
      setEditErrorType(existingFeedback.error_type)
      setEditSolution(existingFeedback.solution)
    }
  }, [isEditing, existingFeedback])

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

  if (!alert) return null

  const handleAck = () => {
    acknowledge(
      { id: alert.id, by: user?.name ?? 'unknown' },
      {
        onSuccess: () => {
          if (showSolution && solution.trim()) {
            createFeedback(
              {
                alert_history_id: alert.id,
                error_type: errorType,
                solution: solution.trim(),
                resolver: user?.name ?? 'unknown',
              },
              { onSuccess: onClose, onError: onClose },
            )
          } else {
            onClose()
          }
        },
      },
    )
  }

  const handleUpdateFeedback = () => {
    if (!existingFeedback || !editSolution.trim()) return
    updateFeedback(
      {
        id: existingFeedback.id,
        body: {
          error_type: editErrorType,
          solution: editSolution.trim(),
          resolver: existingFeedback.resolver,
        },
      },
      { onSuccess: () => setIsEditing(false) },
    )
  }

  return (
    <>
      <div className="bg-overlay fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={PANEL_TITLE_ID}
        className="border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[460px] flex-col border-l shadow-[-8px_0_32px_rgba(0,0,0,0.4)]"
      >
        {/* 헤더 */}
        <div className="border-border flex items-start justify-between border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</NeuBadge>
            <span className="text-text-secondary text-sm">
              {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
            </span>
            {alert.acknowledged && (
              <NeuBadge variant="normal">
                <CheckCircle className="mr-0.5 h-3 w-3" />
                확인됨
              </NeuBadge>
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
              {alert.title}
            </h3>
          </div>

          {/* 메타 정보 */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="type-label">발생 시각</p>
              <p className="text-text-primary mt-0.5">{formatKST(alert.created_at)}</p>
            </div>
            {alert.resolved_at && (
              <div>
                <p className="type-label">복구 시각</p>
                <p className="text-normal mt-0.5">{formatKST(alert.resolved_at)}</p>
              </div>
            )}
            {alert.alertname && (
              <div>
                <p className="type-label">Alert Name</p>
                <p className="text-text-primary mt-0.5 font-mono text-xs break-all">
                  {alert.alertname}
                </p>
              </div>
            )}
            {alert.instance_role && (
              <div>
                <p className="type-label">인스턴스 역할</p>
                <p className="text-text-primary mt-0.5">{alert.instance_role}</p>
              </div>
            )}
            {alert.host && (
              <div>
                <p className="type-label">호스트</p>
                <p className="text-text-primary mt-0.5 font-mono text-xs break-all">{alert.host}</p>
              </div>
            )}
          </div>

          {/* 유사도 분석 */}
          {alert.anomaly_type && (
            <div>
              <p className="type-label mb-1.5">이상 유형</p>
              <AnomalyTypeBadge type={alert.anomaly_type} score={alert.similarity_score} />
            </div>
          )}

          {/* 설명 — JSON 파싱 성공 시 원인/해결방안 분리 표시, 실패 시 원문 표시 */}
          {parsedDesc ? (
            <div className="space-y-3">
              {parsedDesc.root_cause && (
                <NeuTextarea
                  label="원인"
                  rows={5}
                  readOnly
                  value={parsedDesc.root_cause}
                />
              )}
              {parsedDesc.recommendation && (
                <NeuTextarea
                  label="해결방안"
                  rows={6}
                  readOnly
                  value={parsedDesc.recommendation}
                />
              )}
            </div>
          ) : (
            alert.description && (
              <div>
                <p className="type-label mb-1.5">상세 내용</p>
                <div className="bg-bg-base shadow-neu-inset rounded-sm p-4">
                  <p className="text-text-primary text-sm leading-relaxed break-words whitespace-pre-wrap">
                    {alert.description}
                  </p>
                </div>
              </div>
            )
          )}

          {/* 확인 처리 이력 */}
          {alert.acknowledged && alert.acknowledged_by && (
            <div>
              <p className="type-label mb-1.5">처리 정보</p>
              <p className="text-text-secondary text-sm">
                {alert.acknowledged_by}
                {alert.acknowledged_at && ` · ${formatKST(alert.acknowledged_at)}`}
              </p>
            </div>
          )}

          {/* 피드백 미등록 상태 — 확인 완료 후 신규 등록 */}
          {alert.acknowledged && !existingFeedback && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="type-label">피드백 등록</p>
                {!showSolution && (
                  <button
                    type="button"
                    onClick={() => setShowSolution(true)}
                    className="text-accent hover:text-accent/80 focus:ring-accent inline-flex items-center gap-1 rounded-sm text-xs focus:ring-1 focus:outline-none"
                  >
                    <Pencil className="h-3 w-3" />
                    해결책 등록
                  </button>
                )}
              </div>
              {!showSolution ? (
                <p className="text-text-secondary text-sm">
                  아직 등록된 피드백이 없습니다. 해결책을 등록하면 벡터 DB에 반영되어 향후 유사 장애 대응에 활용됩니다.
                </p>
              ) : (
                <>
                  <NeuSelect
                    id="post-ack-error-type"
                    label="장애 유형"
                    value={errorType}
                    onChange={(e) => setErrorType(e.target.value)}
                  >
                    {ERROR_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </NeuSelect>
                  <NeuTextarea
                    id="post-ack-solution"
                    label="해결 내용"
                    rows={5}
                    placeholder="수행한 조치 내용을 기술해 주세요..."
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <NeuButton
                      size="sm"
                      loading={isFeedbackPending}
                      disabled={!solution.trim()}
                      onClick={() =>
                        createFeedback(
                          {
                            alert_history_id: alert.id,
                            error_type: errorType,
                            solution: solution.trim(),
                            resolver: user?.name ?? 'unknown',
                          },
                          {
                            onSuccess: () => {
                              setShowSolution(false)
                              setSolution('')
                              setErrorType('기타')
                            },
                          },
                        )
                      }
                    >
                      등록
                    </NeuButton>
                    <NeuButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowSolution(false)
                        setSolution('')
                      }}
                    >
                      취소
                    </NeuButton>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 등록된 피드백 — 확인된 알림에서만 표시 */}
          {alert.acknowledged && existingFeedback && !isEditing && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="type-label">등록된 피드백</p>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-accent hover:text-accent/80 focus:ring-accent inline-flex items-center gap-1 rounded-sm text-xs focus:ring-1 focus:outline-none"
                >
                  <Pencil className="h-3 w-3" />
                  수정
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <NeuBadge variant="info">{existingFeedback.error_type}</NeuBadge>
                  <span className="text-text-secondary text-xs">
                    {existingFeedback.resolver} · {formatKST(existingFeedback.created_at)}
                  </span>
                </div>
                <div className="bg-bg-base shadow-neu-inset rounded-sm p-4">
                  <p className="text-text-primary leading-relaxed break-words whitespace-pre-wrap">
                    {existingFeedback.solution}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 등록된 피드백 수정 모드 */}
          {alert.acknowledged && existingFeedback && isEditing && (
            <div className="space-y-3">
              <p className="type-label">피드백 수정</p>
              <NeuSelect
                id="edit-error-type"
                label="장애 유형"
                value={editErrorType}
                onChange={(e) => setEditErrorType(e.target.value)}
              >
                {ERROR_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </NeuSelect>
              <NeuTextarea
                id="edit-solution"
                label="해결 내용"
                rows={5}
                value={editSolution}
                onChange={(e) => setEditSolution(e.target.value)}
              />
              <div className="flex gap-2">
                <NeuButton
                  size="sm"
                  loading={isUpdatePending}
                  disabled={!editSolution.trim()}
                  onClick={handleUpdateFeedback}
                >
                  저장
                </NeuButton>
                <NeuButton variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                  취소
                </NeuButton>
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        {!alert.acknowledged && (
          <div className="border-border space-y-3 border-t px-6 py-4">
            <button
              type="button"
              onClick={() => setShowSolution((v) => !v)}
              className="text-text-secondary hover:text-text-primary flex w-full items-center gap-2 text-sm focus:outline-none"
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', showSolution && 'rotate-180')}
              />
              해결책 함께 등록
            </button>

            {showSolution && (
              <div className="space-y-3">
                <NeuSelect
                  id="error-type"
                  label="장애 유형"
                  value={errorType}
                  onChange={(e) => setErrorType(e.target.value)}
                >
                  {ERROR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NeuSelect>
                <NeuTextarea
                  id="solution"
                  label="해결 내용"
                  rows={4}
                  placeholder="수행한 조치 내용을 기술해 주세요..."
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                />
              </div>
            )}

            <NeuButton
              className="w-full"
              loading={isPending || isFeedbackPending}
              onClick={handleAck}
            >
              <CheckCircle className="h-4 w-4" />
              {showSolution && solution.trim() ? '확인 처리 + 해결책 등록' : '확인 처리'}
            </NeuButton>
          </div>
        )}
      </div>
    </>
  )
}
