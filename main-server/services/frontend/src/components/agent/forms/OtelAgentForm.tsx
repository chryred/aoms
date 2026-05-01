import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import type { AgentFormState } from '@/hooks/useAgentFormLogic'
import { OTEL_SERVICE_TYPES } from '@/hooks/useAgentFormLogic'
import type { OtelServiceType } from '@/types/agent'
import type { System } from '@/types/system'

interface OtelAgentFormProps {
  form: Pick<
    AgentFormState,
    | 'installPath'
    | 'setInstallPath'
    | 'otelServiceName'
    | 'setOtelServiceName'
    | 'otelServiceType'
    | 'setOtelServiceType'
    | 'otelJdkVersion'
    | 'setOtelJdkVersion'
    | 'otelServicePath'
    | 'setOtelServicePath'
    | 'selectedSystemId'
  >
  systems: System[]
}

export function OtelAgentForm({ form, systems }: OtelAgentFormProps) {
  const {
    installPath,
    setInstallPath,
    otelServiceName,
    setOtelServiceName,
    otelServiceType,
    setOtelServiceType,
    otelJdkVersion,
    setOtelJdkVersion,
    otelServicePath,
    setOtelServicePath,
    selectedSystemId,
  } = form

  return (
    <div className="border-border bg-bg-deep space-y-3 rounded-sm border p-3">
      <p className="text-text-secondary text-xs font-medium">OTel Java 수집기 설정</p>
      <p className="text-text-secondary/70 text-[11px] leading-relaxed">
        WAS 기동 계정으로 SSH 접속하여 사용자 홈 디렉토리에 설치합니다. systemd 시스템 모드만 root가
        필요합니다.
      </p>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">설치 경로</label>
        <NeuInput
          value={installPath}
          onChange={(e) => setInstallPath(e.target.value)}
          placeholder="~/otel"
          required
        />
      </div>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">
          Tempo 서비스명 <span className="text-text-secondary/60">(비워두면 system_name 사용)</span>
        </label>
        <NeuInput
          value={otelServiceName}
          onChange={(e) => setOtelServiceName(e.target.value)}
          placeholder={
            systems.find((s) => s.id === selectedSystemId)?.system_name ?? 'service-name'
          }
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-text-secondary mb-1 block text-xs">서비스 유형</label>
          <NeuSelect
            value={otelServiceType}
            onChange={(e) => setOtelServiceType(e.target.value as OtelServiceType)}
          >
            {OTEL_SERVICE_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NeuSelect>
        </div>
        <div className="w-36">
          <label className="text-text-secondary mb-1 block text-xs">JDK 버전</label>
          <NeuSelect value={otelJdkVersion} onChange={(e) => setOtelJdkVersion(e.target.value)}>
            <option value="8">JDK 8 (v1.33.x)</option>
            <option value="11">JDK 11+ (v2.x)</option>
            <option value="17">JDK 17+ (v2.x)</option>
            <option value="21">JDK 21+ (v2.x)</option>
          </NeuSelect>
        </div>
      </div>
      {(otelServiceType === 'tomcat' ||
        otelServiceType === 'jboss' ||
        otelServiceType === 'jeus') && (
        <div>
          <label className="text-text-secondary mb-1 block text-xs">
            WAS 설치 경로{' '}
            <span className="text-text-secondary/60">(env 주입 대상 서비스 경로)</span>
          </label>
          <NeuInput
            value={otelServicePath}
            onChange={(e) => setOtelServicePath(e.target.value)}
            placeholder={
              otelServiceType === 'tomcat'
                ? '~/tomcat'
                : otelServiceType === 'jboss'
                  ? '~/jboss'
                  : '~/jeus'
            }
            required
          />
        </div>
      )}
    </div>
  )
}
