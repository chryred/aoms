import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, AlertTriangle, RefreshCw } from 'lucide-react'
import { adminApi } from '@/lib/ky-client'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { useBannerVisible } from '@/hooks/useBannerVisible'
import { cn } from '@/lib/utils'
import { reclassifyApi, type TemplateChange } from '@/api/reclassify'
import type { AlertHistory } from '@/types/alert'
import { useAuthStore } from '@/store/authStore'

interface TemplateClassification {
  template: string
  is_notification: boolean
  reason?: string
}

interface AlertReclassifyPanelProps {
  alert: AlertHistory | null
  onClose: () => void
  onSuccess?: () => void
}

function fetchLogAnalysis(analysisId: number) {
  return adminApi.get(`api/v1/analysis/${analysisId}`).json<{
    id: number
    template_classifications_json: string | null
    templates_json: string[] | null
    severity: string
    anomaly_type: string | null
  }>()
}

const SEVERITY_BUTTONS: {
  value: 'info' | 'warning' | 'critical'
  label: string
  activeClass: string
  idleClass: string
}[] = [
  {
    value: 'info',
    label: '정보',
    activeClass: 'border-accent bg-accent/10 text-accent',
    idleClass: 'border-border/50 text-text-secondary hover:border-accent/40 hover:text-accent',
  },
  {
    value: 'warning',
    label: '경고',
    activeClass: 'border-warning bg-warning/10 text-warning',
    idleClass: 'border-border/50 text-text-secondary hover:border-warning/40 hover:text-warning',
  },
  {
    value: 'critical',
    label: '위험',
    activeClass: 'border-critical bg-critical/10 text-critical',
    idleClass: 'border-border/50 text-text-secondary hover:border-critical/40 hover:text-critical',
  },
]

export function AlertReclassifyPanel({ alert, onClose, onSuccess }: AlertReclassifyPanelProps) {
  const open = !!alert && alert.alert_type === 'log_analysis'
  const bannerVisible = useBannerVisible()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()

  const [severityMap, setSeverityMap] = useState<Record<string, 'info' | 'warning' | 'critical'>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const analysisId = alert?.log_analysis_id ?? null

  const { data: analysisRec, isLoading } = useQuery({
    queryKey: ['log-analysis', analysisId],
    queryFn: () => fetchLogAnalysis(analysisId!),
    enabled: open && analysisId !== null,
    staleTime: 120_000,
  })

  const classifications: TemplateClassification[] = (() => {
    if (!analysisRec) return []
    if (analysisRec.template_classifications_json) {
      try {
        return JSON.parse(analysisRec.template_classifications_json) as TemplateClassification[]
      } catch { /* fall through */ }
    }
    if (analysisRec.templates_json) {
      const isNotification = analysisRec.anomaly_type === 'notification'
      return analysisRec.templates_json.map((t) => ({ template: t, is_notification: isNotification }))
    }
    return []
  })()

  // 패널 열릴 때마다 상태 초기화
  useEffect(() => {
    if (!open) {
      setSeverityMap({})
      setSelected(new Set())
      setError(null)
      setDone(false)
    }
  }, [open])

  const allChecked = classifications.length > 0 && selected.size === classifications.length
  const someChecked = selected.size > 0 && selected.size < classifications.length

  const toggleAll = () => {
    if (allChecked) setSelected(new Set())
    else setSelected(new Set(classifications.map((c) => c.template)))
  }

  const toggleOne = (template: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(template)) next.delete(template)
      else next.add(template)
      return next
    })
  }

  const applyBulk = (severity: 'info' | 'warning' | 'critical') => {
    if (selected.size === 0) return
    setSeverityMap((prev) => {
      const next = { ...prev }
      for (const t of selected) next[t] = severity
      return next
    })
  }

  const handleSubmit = async () => {
    if (!alert) return
    // severityMap에 명시 지정된 템플릿만 제출 (체크+심각도 선택 완료된 것)
    const changes: TemplateChange[] = classifications
      .filter((c) => severityMap[c.template] !== undefined)
      .map((c) => ({ template: c.template, new_severity: severityMap[c.template]! }))
    if (changes.length === 0) return

    setSubmitting(true)
    setError(null)
    try {
      await reclassifyApi.reclassify(alert.id, {
        template_changes: changes,
        reclassified_by: user?.name ?? 'operator',
      })
      setDone(true)
      await queryClient.invalidateQueries({ queryKey: ['alerts'] })
      onSuccess?.()
      setTimeout(() => {
        setDone(false)
        setSeverityMap({})
        setSelected(new Set())
        onClose()
      }, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : '재분류 요청 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setSeverityMap({})
    setSelected(new Set())
    setError(null)
    setDone(false)
    onClose()
  }

  return (
    <>
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="알림 재분류"
        className={cn(
          'border-border bg-bg-base fixed right-0 bottom-0 z-50 flex w-full max-w-[480px] flex-col border-l transition-[translate,top] duration-200',
          bannerVisible ? 'top-12' : 'top-0',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 헤더 */}
        <div className="border-border flex flex-shrink-0 items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-text-primary font-semibold">알림 재분류</h2>
            <p className="text-text-secondary mt-0.5 text-xs">
              템플릿을 선택하고 하단에서 심각도를 일괄 변경하세요
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary rounded-sm p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            '[&::-webkit-scrollbar]:w-1.5',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-sm',
          )}
        >
          {open && isLoading && (
            <div className="text-text-secondary py-8 text-center text-sm">분석 데이터 로딩 중...</div>
          )}

          {open && !isLoading && classifications.length === 0 && (
            <div className="text-text-secondary py-8 text-center text-sm">
              템플릿 분류 정보가 없습니다.
              <br />
              <span className="text-xs">LLM 분류가 포함된 알림만 재분류할 수 있습니다.</span>
            </div>
          )}

          {open && !isLoading && classifications.length > 0 && (
            <>
              {/* 전체 선택 행 */}
              <div className="border-border flex items-center gap-3 border-b px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked }}
                  onChange={toggleAll}
                  className="accent-accent h-4 w-4 cursor-pointer rounded-sm"
                />
                <span className="text-text-secondary text-xs">
                  전체 선택 ({selected.size}/{classifications.length})
                </span>
              </div>

              {/* 템플릿 목록 */}
              <div className="divide-border divide-y">
                {classifications.map((c) => {
                  // severityMap에 명시 지정된 값 우선, 없으면 LLM 초기 분류 표시
                  const assignedSev = severityMap[c.template]
                  const currentSev = assignedSev ?? (c.is_notification ? 'info' : 'warning')
                  const isSelected = selected.has(c.template)
                  return (
                    <div
                      key={c.template}
                      onClick={() => toggleOne(c.template)}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors',
                        isSelected ? 'bg-accent/5' : 'hover:bg-hover-subtle',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(c.template)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-accent mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer rounded-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-text-primary break-all font-mono text-xs leading-relaxed">
                          {c.template}
                        </p>
                        {c.reason && (
                          <p className="text-text-secondary mt-1 text-[10px]">{c.reason}</p>
                        )}
                      </div>
                      <div className={cn('flex-shrink-0', !assignedSev && 'opacity-40')}>
                        <SeverityBadge severity={currentSev} size="sm" />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* 푸터 */}
        {open && classifications.length > 0 && (
          <div className="border-border flex-shrink-0 space-y-2.5 border-t px-4 py-3">
            {/* 일괄 변경 바 */}
            <div className="flex items-center gap-2">
              <span className="text-text-secondary shrink-0 text-xs">재분류:</span>
              <div className="flex gap-1.5">
                {SEVERITY_BUTTONS.map((btn) => (
                  <button
                    key={btn.value}
                    type="button"
                    disabled={selected.size === 0 || submitting}
                    onClick={() => applyBulk(btn.value)}
                    className={cn(
                      'rounded-sm border px-3 py-1 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40',
                      btn.idleClass,
                    )}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              {selected.size === 0 && (
                <span className="text-text-disabled text-[10px]">항목을 선택하세요</span>
              )}
            </div>

            {error && (
              <div className="text-critical flex items-center gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}
            {done && (
              <div className="text-normal text-center text-sm font-medium">
                재분류 완료! 새 알림이 생성되었습니다.
              </div>
            )}
            <NeuButton
              variant="primary"
              className="w-full"
              onClick={handleSubmit}
              disabled={submitting || done || Object.keys(severityMap).length === 0}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  재분류 중...
                </span>
              ) : (
                '재분류 저장'
              )}
            </NeuButton>
            <p className="text-text-disabled text-center text-[10px]">
              저장 시 원본 알림은 재분류됨으로 표시되고 심각도별 새 알림이 생성됩니다
            </p>
          </div>
        )}
      </div>
    </>
  )
}
