import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, Plus } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { CollectorConfigCard } from '@/components/collector/CollectorConfigCard'
import { useCollectorConfigs } from '@/hooks/queries/useCollectorConfigs'
import { useSystems } from '@/hooks/queries/useSystems'
import { cn } from '@/lib/utils'
import type { CollectorType } from '@/types/collectorConfig'

const COLLECTOR_TYPE_OPTIONS: Array<{ value: CollectorType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'node_exporter', label: 'Node Exporter' },
  { value: 'jmx_exporter', label: 'JMX Exporter' },
  { value: 'db_exporter', label: 'DB Exporter' },
  { value: 'custom', label: 'Custom' },
]

const ENABLED_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '활성' },
  { value: 'inactive', label: '비활성' },
]

export default function CollectorConfigListPage() {
  const navigate = useNavigate()
  const [showAddHint, setShowAddHint] = useState(false)
  const [filterType, setFilterType] = useState<CollectorType | 'all'>('all')
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'active' | 'inactive'>('all')

  const {
    data: configs,
    isLoading: configsLoading,
    isError: configsError,
    refetch,
  } = useCollectorConfigs()
  const { data: systems, isLoading: systemsLoading } = useSystems()

  const isLoading = configsLoading || systemsLoading

  const groupedConfigs = useMemo(() => {
    if (!configs || !systems) return []
    return systems
      .map((system) => ({
        system,
        configs: configs.filter((c) => c.system_id === system.id),
      }))
      .filter((g) => g.configs.length > 0)
  }, [configs, systems])

  const filteredGroups = useMemo(() => {
    return groupedConfigs
      .map((g) => ({
        ...g,
        configs: g.configs.filter((c) => {
          if (filterType !== 'all' && c.collector_type !== filterType) return false
          if (filterEnabled === 'active' && !c.enabled) return false
          if (filterEnabled === 'inactive' && c.enabled) return false
          return true
        }),
      }))
      .filter((g) => g.configs.length > 0)
  }, [groupedConfigs, filterType, filterEnabled])

  return (
    <div>
      <PageHeader
        title="수집기 설정 현황"
        description="시스템별 수집기 설정 목록"
        action={
          <NeuButton onClick={() => setShowAddHint(true)}>
            <Plus className="h-4 w-4" />
            수집기 추가
          </NeuButton>
        }
      />

      {/* Filter bar */}
      <div className="mb-6 flex flex-wrap gap-4">
        {/* Type filter */}
        <div
          className="flex gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]"
          role="group"
          aria-label="수집기 타입 필터"
        >
          {COLLECTOR_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilterType(opt.value as CollectorType | 'all')}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-[#1E2127] focus:outline-none',
                filterType === opt.value
                  ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                  : 'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Enabled filter */}
        <div
          className="flex gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]"
          role="group"
          aria-label="활성 상태 필터"
        >
          {ENABLED_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilterEnabled(opt.value as 'all' | 'active' | 'inactive')}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-[#1E2127] focus:outline-none',
                filterEnabled === opt.value
                  ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                  : 'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingSkeleton shape="card" count={4} />}

      {configsError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !configsError && groupedConfigs.length === 0 && (
        <EmptyState
          icon={<Settings className="h-12 w-12 text-[#8B97AD]" />}
          title="등록된 수집기 설정이 없습니다"
          description="시스템 수정 페이지에서 수집기를 추가할 수 있습니다."
          cta={{ label: '시스템에서 수집기 추가', onClick: () => navigate('/systems') }}
        />
      )}

      {!isLoading && !configsError && filteredGroups.length === 0 && groupedConfigs.length > 0 && (
        <EmptyState
          icon={<Settings className="h-12 w-12 text-[#8B97AD]" />}
          title="필터 조건에 맞는 수집기 설정이 없습니다"
          description="필터를 변경해보세요."
        />
      )}

      {!isLoading && !configsError && filteredGroups.length > 0 && (
        <div className="flex flex-col gap-8">
          {filteredGroups.map(({ system, configs: systemConfigs }) => (
            <section key={system.id}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-base font-bold text-[#E2E8F2]">{system.display_name}</h2>
                <span className="text-sm text-[#8B97AD]">{system.system_name}</span>
                <span className="inline-flex items-center rounded-full bg-[rgba(0,212,255,0.10)] px-2 py-0.5 text-xs text-[#00D4FF]">
                  {systemConfigs.length}개
                </span>
              </div>
              <div className="flex flex-col gap-3">
                {systemConfigs.map((config) => (
                  <CollectorConfigCard key={config.id} config={config} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Add hint modal */}
      {showAddHint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddHint(false)} />
          <NeuCard className="relative mx-4 w-full max-w-sm">
            <h3 className="mb-2 text-base font-semibold text-[#E2E8F2]">수집기 추가 안내</h3>
            <p className="mb-4 text-sm text-[#8B97AD]">
              수집기는 시스템 수정 페이지에서 추가할 수 있습니다. 이동하려면 시스템을 선택하세요.
            </p>
            <div className="flex justify-end gap-2">
              <NeuButton variant="ghost" onClick={() => setShowAddHint(false)}>
                닫기
              </NeuButton>
              <NeuButton
                onClick={() => {
                  setShowAddHint(false)
                  navigate('/systems')
                }}
              >
                시스템 목록으로 이동
              </NeuButton>
            </div>
          </NeuCard>
        </div>
      )}
    </div>
  )
}
