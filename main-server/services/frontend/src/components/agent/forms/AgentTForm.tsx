import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import type { AgentFormState } from '@/hooks/useAgentFormLogic'
import { AGENT_T_SERVICE_TYPES } from '@/hooks/useAgentFormLogic'
import type { AgentTServiceType } from '@/types/agent'

interface AgentTFormProps {
  form: Pick<
    AgentFormState,
    | 'sshUsername'
    | 'setSshUsername'
    | 'installPath'
    | 'setInstallPath'
    | 'instanceRole'
    | 'setInstanceRole'
    | 'jvmMatch'
    | 'setJvmMatch'
    | 'agentTServiceType'
    | 'setAgentTServiceType'
    | 'agentTServicePath'
    | 'setAgentTServicePath'
    | 'immediate'
    | 'setImmediate'
    | 'permanent'
    | 'setPermanent'
    | 'jeusConfirm'
    | 'setJeusConfirm'
  >
}

const SERVICE_PATH_TYPES: AgentTServiceType[] = ['tomcat', 'jboss', 'jeus']

export function AgentTForm({ form }: AgentTFormProps) {
  const {
    sshUsername,
    setSshUsername,
    installPath,
    setInstallPath,
    instanceRole,
    setInstanceRole,
    jvmMatch,
    setJvmMatch,
    agentTServiceType,
    setAgentTServiceType,
    agentTServicePath,
    setAgentTServicePath,
    immediate,
    setImmediate,
    permanent,
    setPermanent,
    jeusConfirm,
    setJeusConfirm,
  } = form

  return (
    <div className="border-border bg-bg-deep space-y-3 rounded-sm border p-3">
      <p className="text-text-secondary text-xs font-medium">Agent-T 설정</p>
      <p className="text-text-secondary/70 text-[11px] leading-relaxed">
        WAS 기동 계정으로 SSH 접속하여 사용자 홈 디렉토리에 설치합니다. systemd 시스템 모드만 root가
        필요합니다.
      </p>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">
          SSH 계정 (OS 사용자명) <span className="text-critical">*</span>
        </label>
        <NeuInput
          value={sshUsername}
          onChange={(e) => setSshUsername(e.target.value)}
          placeholder="예: jeussic"
          required
        />
        <p className="text-text-disabled mt-1 text-[11px]">
          대상 WAS 프로세스와 같은 OS 계정이어야 즉시 적용(attach)이 가능합니다.
        </p>
      </div>
      <div>
        <label htmlFor="agent-t-jvm-match" className="text-text-secondary mb-1 block text-xs">
          대상 JVM 식별 문자열 (jvm_match) <span className="text-critical">*</span>
        </label>
        <NeuInput
          id="agent-t-jvm-match"
          value={jvmMatch}
          onChange={(e) => setJvmMatch(e.target.value)}
          placeholder="예: sic_server1"
          required
        />
        <p className="text-text-disabled mt-1 text-[11px]">
          프로세스 명령행에 포함된 문자열(서버명 등). 같은 호스트의 여러 WAS 중 대상을 구분합니다. 일치하는 JVM 이 2개 이상이면 설치 시 대상을 선택할 수 있습니다.
        </p>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="agent-t-role" className="text-text-secondary mb-1 block text-xs">
            instance_role
          </label>
          <NeuInput
            id="agent-t-role"
            value={instanceRole}
            onChange={(e) => setInstanceRole(e.target.value)}
            placeholder="예: was-1"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="agent-t-service-type" className="text-text-secondary mb-1 block text-xs">
            서비스 유형
          </label>
          <NeuSelect
            id="agent-t-service-type"
            value={agentTServiceType}
            onChange={(e) => setAgentTServiceType(e.target.value as AgentTServiceType)}
          >
            {AGENT_T_SERVICE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NeuSelect>
        </div>
      </div>
      {SERVICE_PATH_TYPES.includes(agentTServiceType) && (
        <div>
          <label htmlFor="agent-t-service-path" className="text-text-secondary mb-1 block text-xs">
            WAS 설치 경로 <span className="text-text-secondary/60">(기동 설정 주입 대상)</span>
          </label>
          <NeuInput
            id="agent-t-service-path"
            value={agentTServicePath}
            onChange={(e) => setAgentTServicePath(e.target.value)}
            placeholder={`~/${agentTServiceType}`}
          />
        </div>
      )}
      <div>
        <label htmlFor="agent-t-install-dir" className="text-text-secondary mb-1 block text-xs">
          설치 경로
        </label>
        <NeuInput
          id="agent-t-install-dir"
          value={installPath}
          onChange={(e) => setInstallPath(e.target.value)}
          placeholder="~/agent-t"
          required
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="text-text-primary flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={immediate}
            onChange={(e) => setImmediate(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          즉시 적용 (실행 중인 WAS 에 attach)
        </label>
        <label className="text-text-primary flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          영구 적용 (기동 설정 등록)
        </label>
      </div>
      {agentTServiceType === 'jeus' && (
        <div className="border-warning/40 bg-warning/10 rounded-sm border p-2">
          <label className="text-text-primary flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={jeusConfirm}
              onChange={(e) => setJeusConfirm(e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              JEUS <code>domain.xml</code> 의 해당 서버 jvm-option 에 -javaagent 1줄을 추가하는 데
              동의합니다. 원본은 백업되며 변경 내용은 반영 전에 미리보기로 확인합니다.
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
