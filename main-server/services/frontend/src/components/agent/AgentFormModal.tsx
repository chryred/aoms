import { useState } from 'react'
import { X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { agentsApi } from '@/api/agents'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/constants/queryKeys'
import type { AgentType, AgentInstance } from '@/types/agent'
import type { System } from '@/types/system'

const AGENT_TYPES: { value: AgentType; label: string }[] = [
  { value: 'alloy', label: 'Alloy (로그 수집기)' },
  { value: 'node_exporter', label: 'Node Exporter (시스템 자원)' },
  { value: 'jmx_exporter', label: 'JMX Exporter (JVM 지표)' },
]

const DEFAULT_PATHS: Record<AgentType, { install: string; config: string; pid: string; port: number }> = {
  alloy: {
    install: '/opt/alloy/alloy',
    config: '/opt/alloy/config.alloy',
    pid: '/opt/alloy/alloy.pid',
    port: 12345,
  },
  node_exporter: {
    install: '/opt/node_exporter/node_exporter',
    config: '',
    pid: '/opt/node_exporter/node_exporter.pid',
    port: 9100,
  },
  jmx_exporter: {
    install: '/opt/jmx_exporter/jmx_prometheus_standalone.jar',
    config: '/opt/jmx_exporter/config.yaml',
    pid: '/opt/jmx_exporter/jmx_exporter.pid',
    port: 9404,
  },
}

interface AgentFormModalProps {
  systems: System[]
  onClose: () => void
  onCreated: (agent: AgentInstance) => void
}

export function AgentFormModal({ systems, onClose, onCreated }: AgentFormModalProps) {
  const qc = useQueryClient()
  const [selectedSystemId, setSelectedSystemId] = useState<number>(systems[0]?.id ?? 0)
  const [agentType, setAgentType] = useState<AgentType>('alloy')
  const [host, setHost] = useState('')
  const [sshUsername, setSshUsername] = useState('')
  const [installPath, setInstallPath] = useState(DEFAULT_PATHS.alloy.install)
  const [configPath, setConfigPath] = useState(DEFAULT_PATHS.alloy.config)
  const [pidFile, setPidFile] = useState(DEFAULT_PATHS.alloy.pid)
  const [port, setPort] = useState<string>(String(DEFAULT_PATHS.alloy.port))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleTypeChange(val: string) {
    const t = val as AgentType
    setAgentType(t)
    setInstallPath(DEFAULT_PATHS[t].install)
    setConfigPath(DEFAULT_PATHS[t].config)
    setPidFile(DEFAULT_PATHS[t].pid)
    setPort(String(DEFAULT_PATHS[t].port))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const agent = await agentsApi.createAgent({
        system_id: selectedSystemId,
        host,
        ssh_username: sshUsername,
        agent_type: agentType,
        install_path: installPath,
        config_path: configPath,
        pid_file: pidFile || undefined,
        port: port ? Number(port) : undefined,
      })
      await qc.invalidateQueries({ queryKey: qk.agents() })
      onCreated(agent)
    } catch {
      setError('에이전트 등록에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <NeuCard className="relative mx-4 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#E2E8F2]">에이전트 등록</h3>
          <button
            onClick={onClose}
            className="text-[#8B97AD] hover:text-[#E2E8F2] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none rounded-sm"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">시스템</label>
            <NeuSelect
              value={selectedSystemId}
              onChange={(e) => setSelectedSystemId(Number(e.target.value))}
            >
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name} ({s.host})
                </option>
              ))}
            </NeuSelect>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">에이전트 타입</label>
            <NeuSelect value={agentType} onChange={(e) => handleTypeChange(e.target.value)}>
              {AGENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NeuSelect>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">서버 IP</label>
            <NeuInput
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="10.0.0.1"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">SSH 계정 (저장됨)</label>
            <NeuInput
              value={sshUsername}
              onChange={(e) => setSshUsername(e.target.value)}
              placeholder="jeus_user"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">바이너리 경로</label>
            <NeuInput
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              required
            />
          </div>
          {agentType !== 'node_exporter' && (
            <div>
              <label className="mb-1 block text-xs text-[#8B97AD]">설정 파일 경로</label>
              <NeuInput
                value={configPath}
                onChange={(e) => setConfigPath(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-[#8B97AD]">PID 파일 경로</label>
              <NeuInput
                value={pidFile}
                onChange={(e) => setPidFile(e.target.value)}
              />
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs text-[#8B97AD]">포트</label>
              <NeuInput
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-sm bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#EF4444]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" loading={loading}>
              등록
            </NeuButton>
          </div>
        </form>
      </NeuCard>
    </div>
  )
}
