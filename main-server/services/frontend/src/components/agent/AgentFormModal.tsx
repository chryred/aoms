import { X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import { useAgentFormLogic, AGENT_TYPES } from '@/hooks/useAgentFormLogic'
import { SynapseAgentForm } from './forms/SynapseAgentForm'
import { DbAgentForm } from './forms/DbAgentForm'
import { OtelAgentForm } from './forms/OtelAgentForm'
import type { AgentInstance, OsType, ServerType } from '@/types/agent'
import type { System } from '@/types/system'

interface AgentFormModalProps {
  systems: System[]
  onClose: () => void
  onCreated: (agent: AgentInstance) => void
}

export function AgentFormModal({ systems, onClose, onCreated }: AgentFormModalProps) {
  const sshSession = useSSHSessionStore()
  const sessionActive = sshSession.isValid()
  const form = useAgentFormLogic(systems, onCreated)

  const isSynapse = form.agentType === 'synapse_agent'
  const isDb = form.agentType === 'db'
  const isOtel = form.agentType === 'otel_javaagent'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-overlay absolute inset-0 z-0" aria-hidden="true" onClick={onClose} />
      <NeuCard className="relative z-10 mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-text-primary text-base font-semibold">에이전트 등록</h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm focus:ring-1 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit} className="space-y-3">
          {/* 시스템 선택 */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs">시스템</label>
            <NeuSelect
              value={form.selectedSystemId}
              onChange={(e) => form.setSelectedSystemId(Number(e.target.value))}
              required
            >
              <option value={0} disabled>
                선택
              </option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name} ({s.system_name})
                </option>
              ))}
            </NeuSelect>
          </div>

          {/* 에이전트 타입 */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs">에이전트 타입</label>
            <NeuSelect
              value={form.agentType}
              onChange={(e) => form.handleTypeChange(e.target.value)}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NeuSelect>
          </div>

          {/* 서버 IP / SCAN 주소 */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs">
              {isDb ? 'SCAN 주소 / 호스트명' : '서버 IP'}
            </label>
            <NeuInput
              value={form.host}
              onChange={(e) => form.setHost(e.target.value)}
              placeholder={isDb ? 'scan.example.com' : '10.0.0.1'}
              required
            />
            {!isDb &&
              sessionActive &&
              sshSession.host &&
              form.host &&
              form.host !== sshSession.host && (
                <p className="text-warning mt-1 text-xs">
                  SSH 세션 호스트({sshSession.host})와 다릅니다. 에이전트 제어 시 오류가 발생할 수
                  있습니다.
                </p>
              )}
          </div>

          {/* OS / 서버 역할 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-text-secondary mb-1 block text-xs">OS</label>
              <NeuSelect
                value={form.osType}
                onChange={(e) => form.setOsType(e.target.value as OsType)}
              >
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
              </NeuSelect>
            </div>
            <div className="flex-1">
              <label className="text-text-secondary mb-1 block text-xs">서버 역할</label>
              <NeuSelect
                value={form.serverType}
                onChange={(e) => form.setServerType(e.target.value as ServerType)}
              >
                <option value="web">Web</option>
                <option value="was">WAS</option>
                <option value="db">DB</option>
                <option value="middleware">Middleware</option>
                <option value="other">기타</option>
              </NeuSelect>
            </div>
          </div>

          {/* 타입별 폼 */}
          {isDb && <DbAgentForm form={form} />}
          {isSynapse && <SynapseAgentForm form={form} />}
          {isOtel && <OtelAgentForm form={form} systems={systems} />}

          {form.error && (
            <p className="bg-critical-card-bg text-critical rounded-sm px-3 py-2 text-xs">
              {form.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" loading={form.loading}>
              등록
            </NeuButton>
          </div>
        </form>
      </NeuCard>
    </div>
  )
}
