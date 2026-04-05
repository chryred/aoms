import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { WizardProgress } from '@/components/collector/WizardProgress'
import { WizardStepLayout } from '@/components/collector/WizardStepLayout'
import { CollectorTypeCard } from '@/components/collector/CollectorTypeCard'
import { MetricGroupChecklist } from '@/components/collector/MetricGroupChecklist'
import { useWizardStore } from '@/store/wizardStore'
import { useCollectorTemplates } from '@/hooks/queries/useCollectorTemplates'
import { useCreateConfig } from '@/hooks/mutations/useCreateConfig'
import { useSystems } from '@/hooks/queries/useSystems'
import type { CollectorType, CollectorTypeOption } from '@/types/collectorConfig'

const COLLECTOR_TYPE_OPTIONS: CollectorTypeOption[] = [
  {
    value: 'node_exporter',
    label: 'Node Exporter',
    description: 'Linux/Windows 서버 CPU, 메모리, 디스크, 네트워크 메트릭 수집',
    iconName: 'Server',
  },
  {
    value: 'jmx_exporter',
    label: 'JMX Exporter',
    description: 'JEUS, Tomcat 등 JVM 기반 WAS의 Heap, GC, Thread Pool, TPS 수집',
    iconName: 'Cpu',
  },
  {
    value: 'db_exporter',
    label: 'DB Exporter',
    description: 'PostgreSQL, Oracle 등 DB의 Connection, Query, Cache 메트릭 수집',
    iconName: 'Database',
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'custom_config JSON으로 직접 수집 대상과 메트릭을 정의하는 커스텀 수집기',
    iconName: 'Settings2',
  },
]

function validateCustomConfig(value: string): string | null {
  if (value.trim() === '') return null
  try {
    JSON.parse(value)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export default function CollectorWizardPage() {
  const { id } = useParams<{ id: string }>()
  const systemId = Number(id)
  const navigate = useNavigate()

  const {
    step,
    collectorType,
    selectedMetricGroups,
    customMetricGroup,
    prometheusJob,
    customConfig,
    setStep,
    setCollectorType,
    toggleMetricGroup,
    addCustomMetricGroup,
    removeMetricGroup,
    setPrometheusJob,
    setCustomConfig,
    reset,
  } = useWizardStore()

  // Reset store on mount
  useEffect(() => {
    reset(systemId)
  }, [systemId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: systems } = useSystems()
  const system = systems?.find((s) => s.id === systemId)

  const { data: template, isLoading: templateLoading } = useCollectorTemplates(collectorType)
  const createMutation = useCreateConfig()

  const [step2Error, setStep2Error] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const [showConfigExpanded, setShowConfigExpanded] = useState(false)

  // beforeunload warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (step > 1 || collectorType !== null) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [step, collectorType])

  // Validate JSON on customConfig change
  useEffect(() => {
    setJsonError(validateCustomConfig(customConfig))
  }, [customConfig])

  function handleNext() {
    if (step === 2 && selectedMetricGroups.length === 0) {
      setStep2Error('최소 1개의 메트릭 그룹을 선택해야 합니다')
      return
    }
    setStep2Error(null)
    setStep((step + 1) as 1 | 2 | 3 | 4 | 5)
  }

  function handlePrev() {
    setStep((step - 1) as 1 | 2 | 3 | 4 | 5)
  }

  async function handleSave() {
    if (!collectorType || selectedMetricGroups.length === 0) return

    let successCount = 0
    const failedGroups: string[] = []

    for (const metricGroup of selectedMetricGroups) {
      try {
        await new Promise<void>((resolve, reject) => {
          createMutation.mutate(
            {
              system_id: systemId,
              collector_type: collectorType,
              metric_group: metricGroup,
              prometheus_job: prometheusJob.trim() || undefined,
              custom_config: customConfig.trim() || undefined,
            },
            {
              onSuccess: () => resolve(),
              onError: (err) => reject(err),
            }
          )
        })
        successCount++
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : ''
        if (message.toLowerCase().includes('unique') || message.includes('409')) {
          toast.error(`이미 동일한 수집기 설정이 존재합니다: ${metricGroup}`)
        }
        failedGroups.push(metricGroup)
      }
    }

    if (successCount > 0) {
      toast.success(`수집기 설정 ${successCount}개가 등록되었습니다`)
      reset()
      navigate('/collector-configs')
    }
  }

  function handleCancel() {
    setShowCancelDialog(true)
  }

  function handleConfirmCancel() {
    reset()
    navigate(-1)
  }

  const displayName = system?.display_name ?? `시스템 #${systemId}`

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title={`수집기 추가 — ${displayName}`}
        description={`시스템 관리 > ${displayName} 수정 > 수집기 추가`}
        action={
          <NeuButton variant="ghost" onClick={handleCancel} type="button">
            <X className="w-4 h-4" />
            취소
          </NeuButton>
        }
      />

      <WizardProgress currentStep={step} />

      <NeuCard>
        {/* Step 1 */}
        {step === 1 && (
          <WizardStepLayout
            onNext={handleNext}
            nextDisabled={collectorType === null}
          >
            <p className="text-sm text-[#8B97AD] mb-4">수집기 타입을 선택하세요</p>
            <div className="grid grid-cols-2 gap-4">
              {COLLECTOR_TYPE_OPTIONS.map((opt) => (
                <CollectorTypeCard
                  key={opt.value}
                  option={opt}
                  selected={collectorType === opt.value}
                  onSelect={() => setCollectorType(opt.value as CollectorType)}
                />
              ))}
            </div>
          </WizardStepLayout>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <WizardStepLayout
            onPrev={handlePrev}
            onNext={handleNext}
            nextDisabled={selectedMetricGroups.length === 0}
          >
            <p className="text-sm text-[#8B97AD] mb-4">
              수집할 메트릭 그룹을 선택하세요 (최소 1개)
            </p>
            <MetricGroupChecklist
              items={template?.metric_groups ?? []}
              isLoading={templateLoading}
              selected={selectedMetricGroups}
              customMetricGroup={customMetricGroup}
              onToggle={(g) => {
                toggleMetricGroup(g)
                setStep2Error(null)
              }}
              onAddCustom={addCustomMetricGroup}
              onRemove={removeMetricGroup}
              onCustomChange={() => {}}
              error={step2Error}
            />
          </WizardStepLayout>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <WizardStepLayout onPrev={handlePrev} onNext={handleNext}>
            <p className="text-sm text-[#8B97AD] mb-4">
              Prometheus job label을 입력하면 해당 job 범위 내에서만 메트릭을 조회합니다
            </p>
            <NeuInput
              label="Prometheus Job (선택)"
              placeholder="예: node_exporter_prod, was_jmx"
              value={prometheusJob}
              onChange={(e) => setPrometheusJob(e.target.value)}
            />
            <p className="text-sm text-[#8B97AD] mt-3">
              비워두면 시스템의 모든 Prometheus job에서 메트릭을 수집합니다.
              <br />
              Prometheus job 이름은 prometheus.yml의 job_name 값과 일치해야 합니다.
            </p>
          </WizardStepLayout>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <WizardStepLayout
            onPrev={handlePrev}
            onNext={handleNext}
            nextDisabled={jsonError !== null}
          >
            <p className="text-sm text-[#8B97AD] mb-3">
              수집기 동작을 세부 조정할 JSON 설정을 입력합니다 (선택)
            </p>
            {/* Info banner */}
            <div className="rounded-sm bg-[rgba(0,212,255,0.06)] border border-[rgba(0,212,255,0.16)]
                            px-4 py-3 text-sm text-[#00D4FF] mb-4">
              Monaco Editor CDN 접근 불가 환경으로 텍스트 에디터를 사용합니다.
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#E2E8F2]">
                custom_config (JSON, 선택)
              </label>
              <textarea
                rows={10}
                value={customConfig}
                onChange={(e) => setCustomConfig(e.target.value)}
                placeholder={'{\n  "threshold": 80,\n  "interval": "5m"\n}'}
                className="w-full rounded-sm bg-[#1E2127] border border-[#2B2F37]
                           shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]
                           px-4 py-2.5 text-sm text-[#E2E8F2] font-mono
                           placeholder:text-[#5A6478]
                           focus:outline-none focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]"
                style={{ fontFamily: "'Courier New', monospace" }}
              />
              {customConfig.trim() === '' && (
                <p className="text-xs text-[#8B97AD]">설정이 필요 없으면 비워두세요</p>
              )}
              {jsonError && (
                <p className="text-xs text-[#EF4444]">올바른 JSON 형식이 아닙니다: {jsonError}</p>
              )}
              {customConfig.trim() !== '' && !jsonError && (
                <p className="text-xs text-[#22C55E]">유효한 JSON입니다</p>
              )}
            </div>
          </WizardStepLayout>
        )}

        {/* Step 5 */}
        {step === 5 && (
          <WizardStepLayout onPrev={handlePrev}>
            <p className="text-sm text-[#8B97AD] mb-4">입력한 내용을 확인하고 저장하세요</p>
            <NeuCard className="mb-4">
              <div className="flex flex-col gap-3 text-sm">
                <SummaryRow label="수집기 타입">
                  <span className="font-medium text-[#00D4FF]">{collectorType}</span>
                </SummaryRow>
                <SummaryRow label="Metric Groups">
                  <div className="flex flex-wrap gap-1">
                    {selectedMetricGroups.map((g) => (
                      <span
                        key={g}
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs
                                   bg-[rgba(0,212,255,0.10)] text-[#00D4FF]"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </SummaryRow>
                <SummaryRow label="Prometheus Job">
                  <span className={prometheusJob ? 'text-[#E2E8F2]' : 'text-[#5A6478]'}>
                    {prometheusJob || '미설정'}
                  </span>
                </SummaryRow>
                <SummaryRow label="고급 설정">
                  {!customConfig.trim() ? (
                    <span className="text-[#5A6478]">없음</span>
                  ) : (
                    <div>
                      <pre
                        className={`text-xs font-mono text-[#E2E8F2] whitespace-pre-wrap overflow-hidden
                                    ${!showConfigExpanded ? 'line-clamp-[8]' : ''}`}
                      >
                        {JSON.stringify(JSON.parse(customConfig), null, 2)}
                      </pre>
                      <button
                        type="button"
                        onClick={() => setShowConfigExpanded(!showConfigExpanded)}
                        className="text-xs text-[#00D4FF] hover:underline mt-1"
                      >
                        {showConfigExpanded ? '접기' : '더 보기'}
                      </button>
                    </div>
                  )}
                </SummaryRow>
              </div>
            </NeuCard>
            <NeuButton
              type="button"
              onClick={handleSave}
              disabled={createMutation.isPending}
              loading={createMutation.isPending}
              className="w-full"
            >
              수집기 등록
            </NeuButton>
          </WizardStepLayout>
        )}
      </NeuCard>

      {/* Cancel confirm dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCancelDialog(false)} />
          <div className="relative bg-[#1E2127] rounded-sm p-6 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37] border border-[#2B2F37] max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[#E2E8F2] mb-2">
              마법사를 취소하시겠습니까?
            </h3>
            <p className="text-sm text-[#8B97AD] mb-4">입력 중인 내용이 초기화됩니다.</p>
            <div className="flex gap-2 justify-end">
              <NeuButton variant="ghost" onClick={() => setShowCancelDialog(false)}>
                계속 입력
              </NeuButton>
              <NeuButton variant="danger" onClick={handleConfirmCancel}>
                취소하기
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper component
function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="w-32 flex-shrink-0 text-[#8B97AD] font-medium">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
