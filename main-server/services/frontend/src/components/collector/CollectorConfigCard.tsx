import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { EnabledToggle } from './EnabledToggle'
import { cn } from '@/lib/utils'
import { useUpdateConfig } from '@/hooks/mutations/useUpdateConfig'
import { useDeleteConfig } from '@/hooks/mutations/useDeleteConfig'
import type { CollectorConfig, CollectorType } from '@/types/collectorConfig'

const BADGE_COLORS: Record<CollectorType, string> = {
  node_exporter: 'text-[#38BDF8] bg-[rgba(56,189,248,0.12)]',
  jmx_exporter:  'text-[#A78BFA] bg-[rgba(167,139,250,0.12)]',
  db_exporter:   'text-[#34D399] bg-[rgba(52,211,153,0.12)]',
  custom:        'text-[#8B97AD] bg-[rgba(139,151,173,0.12)]',
}

interface CollectorConfigCardProps {
  config: CollectorConfig
}

export function CollectorConfigCard({ config }: CollectorConfigCardProps) {
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [editPrometheusJob, setEditPrometheusJob] = useState(config.prometheus_job ?? '')
  const [editCustomConfig, setEditCustomConfig] = useState(config.custom_config ?? '')

  const updateMutation = useUpdateConfig()
  const deleteMutation = useDeleteConfig()

  const customConfigPreview = config.custom_config
    ? config.custom_config.slice(0, 60) + (config.custom_config.length > 60 ? '...' : '')
    : null

  function handleSaveEdit() {
    updateMutation.mutate(
      {
        id: config.id,
        body: {
          prometheus_job: editPrometheusJob.trim() || undefined,
          custom_config: editCustomConfig.trim() || undefined,
        },
      },
      { onSuccess: () => setShowEdit(false) }
    )
  }

  function handleDelete() {
    deleteMutation.mutate(config.id, { onSuccess: () => setShowDelete(false) })
  }

  return (
    <>
      <NeuCard className="flex items-start justify-between gap-4">
        {/* Left */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                BADGE_COLORS[config.collector_type]
              )}
            >
              {config.collector_type}
            </span>
            <span className="font-medium text-sm text-[#E2E8F2] truncate">
              {config.metric_group}
            </span>
          </div>
          {config.prometheus_job && (
            <p className="text-sm text-[#8B97AD]">Job: {config.prometheus_job}</p>
          )}
          {/* Center: custom_config preview */}
          {customConfigPreview && (
            <p className="text-xs text-[#8B97AD] font-mono mt-1 truncate">{customConfigPreview}</p>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <EnabledToggle configId={config.id} enabled={config.enabled} />
          <button
            type="button"
            onClick={() => {
              setEditPrometheusJob(config.prometheus_job ?? '')
              setEditCustomConfig(config.custom_config ?? '')
              setShowEdit(true)
            }}
            className="p-1.5 rounded-lg text-[#8B97AD] hover:text-[#00D4FF] hover:bg-[rgba(0,212,255,0.06)]
                       focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]"
            aria-label="수정"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="p-1.5 rounded-lg text-[#8B97AD] hover:text-[#EF4444] hover:bg-[rgba(239,68,68,0.08)]
                       focus:outline-none focus:ring-2 focus:ring-[#EF4444] focus:ring-offset-2 focus:ring-offset-[#1E2127]"
            aria-label="삭제"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </NeuCard>

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEdit(false)} />
          <div className="relative bg-[#1E2127] rounded-2xl p-6 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37] border border-[#2B2F37] max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-[#E2E8F2] mb-4">수집기 설정 수정</h3>
            <div className="flex flex-col gap-4 mb-4">
              <NeuInput
                label="Prometheus Job (선택)"
                placeholder="예: node_exporter_prod"
                value={editPrometheusJob}
                onChange={(e) => setEditPrometheusJob(e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#E2E8F2]">고급 설정 JSON (선택)</label>
                <textarea
                  rows={5}
                  value={editCustomConfig}
                  onChange={(e) => setEditCustomConfig(e.target.value)}
                  placeholder='{"threshold": 80}'
                  className="w-full rounded-xl bg-[#1E2127] border border-[#2B2F37]
                             shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]
                             px-4 py-2.5 text-sm text-[#E2E8F2] font-mono
                             placeholder:text-[#5A6478]
                             focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127]"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <NeuButton variant="ghost" onClick={() => setShowEdit(false)}>
                취소
              </NeuButton>
              <NeuButton
                loading={updateMutation.isPending}
                onClick={handleSaveEdit}
              >
                저장
              </NeuButton>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowDelete(false)} />
          <div className="relative bg-[#1E2127] rounded-2xl p-6 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37] border border-[#2B2F37] max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[#E2E8F2] mb-2">
              수집기 설정을 삭제하시겠습니까?
            </h3>
            <p className="text-sm text-[#8B97AD] mb-4">
              수집기 설정을 삭제하면 해당 집계 데이터에 영향을 줄 수 있습니다.
              <br />
              ({config.collector_type} / {config.metric_group})
              <br />
              이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="flex gap-2 justify-end">
              <NeuButton variant="ghost" onClick={() => setShowDelete(false)}>
                취소
              </NeuButton>
              <NeuButton
                variant="danger"
                loading={deleteMutation.isPending}
                onClick={handleDelete}
              >
                <Trash2 className="w-4 h-4" />
                삭제
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
