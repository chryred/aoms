import { useState } from 'react'
import { Terminal, X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { agentsApi } from '@/api/agents'
import type { System } from '@/types/system'

interface CliServerFormModalProps {
  systems: System[]
  onSuccess: () => void
  onClose: () => void
}

export function CliServerFormModal({ systems, onSuccess, onClose }: CliServerFormModalProps) {
  const [host, setHost] = useState('')
  const [installPath, setInstallPath] = useState('~/bin/synapse')
  const [selectedSystemId, setSelectedSystemId] = useState<number | ''>(
    systems.length === 1 ? systems[0].id : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSystemId) {
      setError('서비스를 선택하세요.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await agentsApi.createAgent({
        system_id: selectedSystemId,
        host,
        agent_type: 'cli',
        install_path: installPath,
      })
      onSuccess()
    } catch {
      setError('서버 등록에 실패했습니다. 입력 정보를 확인하세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-overlay absolute inset-0" onClick={onClose} />
      <NeuCard className="relative mx-4 w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="text-accent h-4 w-4" />
            <h3 className="text-text-primary text-base font-semibold">CLI 배포 서버 등록</h3>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm focus:ring-1 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-text-secondary mb-1 block text-xs">시스템</label>
            <select
              value={selectedSystemId}
              onChange={(e) => setSelectedSystemId(e.target.value ? Number(e.target.value) : '')}
              required
              className="bg-bg-base border-border text-text-primary focus:ring-accent w-full rounded-sm border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            >
              <option value="">시스템 선택...</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name} ({s.system_name})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-text-secondary mb-1 block text-xs">서버 IP</label>
            <NeuInput
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.10"
              required
            />
          </div>
          <div>
            <label className="text-text-secondary mb-1 block text-xs">설치 경로</label>
            <NeuInput
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="~/bin/synapse"
              required
            />
          </div>

          {error && (
            <p className="bg-critical-card-bg text-critical rounded-sm px-3 py-2 text-xs">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" loading={loading} disabled={!selectedSystemId}>
              등록
            </NeuButton>
          </div>
        </form>
      </NeuCard>
    </div>
  )
}
