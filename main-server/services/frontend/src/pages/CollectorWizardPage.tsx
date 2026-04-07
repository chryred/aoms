import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { BookOpen, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { WizardProgress } from '@/components/collector/WizardProgress'
import { WizardStepLayout } from '@/components/collector/WizardStepLayout'
import { CollectorTypeCard } from '@/components/collector/CollectorTypeCard'
import { MetricGroupChecklist } from '@/components/collector/MetricGroupChecklist'
import { InstallGuideDrawer } from '@/components/collector/InstallGuideDrawer'
import { useWizardStore } from '@/store/wizardStore'
import { useCollectorTemplates } from '@/hooks/queries/useCollectorTemplates'
import { useCreateConfig } from '@/hooks/mutations/useCreateConfig'
import { useSystems } from '@/hooks/queries/useSystems'
import type { CollectorType, CollectorTypeOption } from '@/types/collectorConfig'

// 타입별 exporter 기본 포트
const DEFAULT_PORTS: Record<string, number> = {
  node_exporter: 9100,
  jmx_exporter: 9404,
  alloy: 12345,
  db_exporter: 9187,
}

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

  // 설치 관련 필드 (Step 3)
  const [instanceRole, setInstanceRole] = useState('was1')
  const [exporterPort, setExporterPort] = useState<string>('')
  const [javaVersion, setJavaVersion] = useState<8 | 11 | 17>(17)
  const [jeusLogBase, setJeusLogBase] = useState('/apps/logs')

  // 저장 성공 후 설치 가이드 표시
  const [savedConfigId, setSavedConfigId] = useState<number | null>(null)
  const [showPostSaveGuide, setShowPostSaveGuide] = useState(false)

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

    // install 필드를 custom_config JSON에 병합
    const autoConfig: Record<string, unknown> = {
      instance_role: instanceRole.trim() || 'was1',
      exporter_port: exporterPort ? Number(exporterPort) : (DEFAULT_PORTS[collectorType] ?? 9100),
    }
    if (collectorType === 'jmx_exporter') autoConfig.java_version = javaVersion
    if (collectorType === 'alloy') autoConfig.jeus_log_base = jeusLogBase.trim() || '/apps/logs'

    let userExtra: Record<string, unknown> = {}
    if (customConfig.trim()) {
      try {
        userExtra = JSON.parse(customConfig)
      } catch {
        // invalid JSON already blocked by step 4 validation
      }
    }
    const finalCustomConfig = JSON.stringify({ ...autoConfig, ...userExtra })

    let successCount = 0
    let firstSavedId: number | null = null
    const failedGroups: string[] = []

    for (const metricGroup of selectedMetricGroups) {
      try {
        const result = await new Promise<{ id: number }>((resolve, reject) => {
          createMutation.mutate(
            {
              system_id: systemId,
              collector_type: collectorType,
              metric_group: metricGroup,
              prometheus_job: prometheusJob.trim() || undefined,
              custom_config: finalCustomConfig,
            },
            {
              onSuccess: (data) => resolve(data),
              onError: (err) => reject(err),
            },
          )
        })
        if (firstSavedId === null) firstSavedId = result.id
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
      setSavedConfigId(firstSavedId)
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
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={`수집기 추가 — ${displayName}`}
        description={`시스템 관리 > ${displayName} 수정 > 수집기 추가`}
        action={
          <NeuButton variant="ghost" onClick={handleCancel} type="button">
            <X className="h-4 w-4" />
            취소
          </NeuButton>
        }
      />

      <WizardProgress currentStep={step} />

      <NeuCard>
        {/* Step 1 */}
        {step === 1 && (
          <WizardStepLayout onNext={handleNext} nextDisabled={collectorType === null}>
            <p className="mb-4 text-sm text-[#8B97AD]">수집기 타입을 선택하세요</p>
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
            <p className="mb-4 text-sm text-[#8B97AD]">
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
            <p className="mb-4 text-sm text-[#8B97AD]">
              설치 정보를 입력하면 설치 명령어가 자동으로 생성됩니다
            </p>
            <div className="flex flex-col gap-4">
              <NeuInput
                label="서버 역할 (instance_role)"
                placeholder="예: was1, db-primary"
                value={instanceRole}
                onChange={(e) => setInstanceRole(e.target.value)}
              />
              <NeuInput
                label={`Exporter 포트 (기본값: ${DEFAULT_PORTS[collectorType ?? ''] ?? 9100})`}
                placeholder={String(DEFAULT_PORTS[collectorType ?? ''] ?? 9100)}
                value={exporterPort}
                onChange={(e) => setExporterPort(e.target.value)}
                type="number"
              />
              {collectorType === 'jmx_exporter' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-[#E2E8F2]">Java 버전</label>
                  <select
                    value={javaVersion}
                    onChange={(e) => setJavaVersion(Number(e.target.value) as 8 | 11 | 17)}
                    className="w-full rounded-sm border border-[#2B2F37] bg-[#1E2127] px-4 py-2.5 text-sm text-[#E2E8F2] shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none"
                  >
                    <option value={17}>Java 17+</option>
                    <option value={11}>Java 11</option>
                    <option value={8}>Java 8</option>
                  </select>
                </div>
              )}
              {collectorType === 'alloy' && (
                <NeuInput
                  label="JEUS 로그 경로 (jeus_log_base)"
                  placeholder="예: /apps/logs"
                  value={jeusLogBase}
                  onChange={(e) => setJeusLogBase(e.target.value)}
                />
              )}
              <div className="border-t border-[#2B2F37] pt-4">
                <NeuInput
                  label="Prometheus Job (선택)"
                  placeholder="예: node_exporter_prod, was_jmx"
                  value={prometheusJob}
                  onChange={(e) => setPrometheusJob(e.target.value)}
                />
                <p className="mt-2 text-xs text-[#8B97AD]">비워두면 HTTP SD가 자동 등록합니다.</p>
              </div>
            </div>
          </WizardStepLayout>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <WizardStepLayout
            onPrev={handlePrev}
            onNext={handleNext}
            nextDisabled={jsonError !== null}
          >
            <p className="mb-3 text-sm text-[#8B97AD]">
              수집기 동작을 세부 조정할 JSON 설정을 입력합니다 (선택)
            </p>
            {/* Info banner */}
            <div className="mb-4 rounded-sm border border-[rgba(0,212,255,0.16)] bg-[rgba(0,212,255,0.06)] px-4 py-3 text-sm text-[#00D4FF]">
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
                className="w-full rounded-sm border border-[#2B2F37] bg-[#1E2127] px-4 py-2.5 font-mono text-sm text-[#E2E8F2] shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37] placeholder:text-[#5A6478] focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127] focus:outline-none"
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
            <p className="mb-4 text-sm text-[#8B97AD]">입력한 내용을 확인하고 저장하세요</p>
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
                        className="inline-flex items-center rounded-full bg-[rgba(0,212,255,0.10)] px-2.5 py-0.5 text-xs text-[#00D4FF]"
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
                        className={`overflow-hidden font-mono text-xs whitespace-pre-wrap text-[#E2E8F2] ${!showConfigExpanded ? 'line-clamp-[8]' : ''}`}
                      >
                        {JSON.stringify(JSON.parse(customConfig), null, 2)}
                      </pre>
                      <button
                        type="button"
                        onClick={() => setShowConfigExpanded(!showConfigExpanded)}
                        className="mt-1 text-xs text-[#00D4FF] hover:underline"
                      >
                        {showConfigExpanded ? '접기' : '더 보기'}
                      </button>
                    </div>
                  )}
                </SummaryRow>
              </div>
            </NeuCard>
            {savedConfigId === null ? (
              <NeuButton
                type="button"
                onClick={handleSave}
                disabled={createMutation.isPending}
                loading={createMutation.isPending}
                className="w-full"
              >
                수집기 등록
              </NeuButton>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="rounded-sm border border-[rgba(34,197,94,0.2)] bg-[rgba(34,197,94,0.06)] px-4 py-3 text-sm text-[#22C55E]">
                  수집기 설정이 등록되었습니다.
                </div>
                <div className="flex gap-2">
                  <NeuButton
                    type="button"
                    onClick={() => setShowPostSaveGuide(true)}
                    className="flex-1"
                  >
                    <BookOpen className="h-4 w-4" />
                    설치 가이드 바로 보기
                  </NeuButton>
                  <NeuButton
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      reset()
                      navigate(ROUTES.COLLECTOR_CONFIGS)
                    }}
                  >
                    완료
                  </NeuButton>
                </div>
              </div>
            )}
          </WizardStepLayout>
        )}
      </NeuCard>

      {showPostSaveGuide && savedConfigId !== null && (
        <InstallGuideDrawer configId={savedConfigId} onClose={() => setShowPostSaveGuide(false)} />
      )}

      {/* Cancel confirm dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowCancelDialog(false)}
          />
          <div className="relative mx-4 w-full max-w-sm rounded-sm border border-[#2B2F37] bg-[#1E2127] p-6 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
            <h3 className="mb-2 text-base font-semibold text-[#E2E8F2]">
              마법사를 취소하시겠습니까?
            </h3>
            <p className="mb-4 text-sm text-[#8B97AD]">입력 중인 내용이 초기화됩니다.</p>
            <div className="flex justify-end gap-2">
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
      <span className="w-32 flex-shrink-0 font-medium text-[#8B97AD]">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}
