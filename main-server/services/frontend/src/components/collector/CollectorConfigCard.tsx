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
  node_exporter: 'text-[#2563EB] bg-[rgba(37,99,235,0.1)]',
  jmx_exporter: 'text-[#7C3AED] bg-[rgba(124,58,237,0.1)]',
  db_exporter: 'text-[#059669] bg-[rgba(5,150,105,0.1)]',
  custom: 'text-[#4A5568] bg-[rgba(74,85,104,0.1)]',
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
            <span className="font-medium text-sm text-[#1A1F2E] truncate">
              {config.metric_group}
            </span>
          </div>
          {config.prometheus_job && (
            <p className="text-sm text-[#4A5568]">Job: {config.prometheus_job}</p>
          )}
          {/* Center: custom_config preview */}
          {customConfigPreview && (
            <p className="text-xs text-[#4A5568] font-mono mt-1 truncate">{customConfigPreview}</p>
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
            className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#6366F1] hover:bg-[rgba(99,102,241,0.1)]
                       focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2"
            aria-label="수정"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#DC2626] hover:bg-[rgba(220,38,38,0.1)]
                       focus:outline-none focus:ring-2 focus:ring-[#DC2626] focus:ring-offset-2"
            aria-label="삭제"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </NeuCard>

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowEdit(false)} />
          <div className="relative bg-[#E8EBF0] rounded-2xl p-6 shadow-xl max-w-md w-full mx-4">
            <h3 className="text-base font-semibold text-[#1A1F2E] mb-4">수집기 설정 수정</h3>
            <div className="flex flex-col gap-4 mb-4">
              <NeuInput
                label="Prometheus Job (선택)"
                placeholder="예: node_exporter_prod"
                value={editPrometheusJob}
                onChange={(e) => setEditPrometheusJob(e.target.value)}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-[#1A1F2E]">고급 설정 JSON (선택)</label>
                <textarea
                  rows={5}
                  value={editCustomConfig}
                  onChange={(e) => setEditCustomConfig(e.target.value)}
                  placeholder='{"threshold": 80}'
                  className="w-full rounded-xl bg-[#E8EBF0] border border-[#C0C4CF]
                             shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF]
                             px-4 py-2.5 text-sm text-[#1A1F2E] font-mono
                             focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2"
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
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowDelete(false)} />
          <div className="relative bg-[#E8EBF0] rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-[#1A1F2E] mb-2">
              수집기 설정을 삭제하시겠습니까?
            </h3>
            <p className="text-sm text-[#4A5568] mb-4">
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
