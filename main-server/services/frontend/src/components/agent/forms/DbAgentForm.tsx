import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import type { AgentFormState } from '@/hooks/useAgentFormLogic'
import { DB_TYPE_OPTIONS } from '@/hooks/useAgentFormLogic'

interface DbAgentFormProps {
  form: Pick<
    AgentFormState,
    | 'dbType'
    | 'handleDbTypeChange'
    | 'dbInstanceRole'
    | 'setDbInstanceRole'
    | 'dbIdentifier'
    | 'setDbIdentifier'
    | 'port'
    | 'setPort'
    | 'currentDbTypeOption'
    | 'dbUsername'
    | 'setDbUsername'
    | 'dbPassword'
    | 'setDbPassword'
    | 'dbInterval'
    | 'setDbInterval'
  >
}

export function DbAgentForm({ form }: DbAgentFormProps) {
  const {
    dbType,
    handleDbTypeChange,
    dbInstanceRole,
    setDbInstanceRole,
    dbIdentifier,
    setDbIdentifier,
    port,
    setPort,
    currentDbTypeOption,
    dbUsername,
    setDbUsername,
    dbPassword,
    setDbPassword,
    dbInterval,
    setDbInterval,
  } = form

  return (
    <div className="border-border bg-bg-deep space-y-3 rounded-sm border p-3">
      <p className="text-text-secondary text-xs font-medium">DB 연결 설정</p>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">DB 타입</label>
        <NeuSelect value={dbType} onChange={(e) => handleDbTypeChange(e.target.value)}>
          {DB_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NeuSelect>
      </div>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">
          instance_role{' '}
          <span className="text-text-secondary/60">(HA 구분: db-primary, db-standby …)</span>
        </label>
        <NeuInput
          value={dbInstanceRole}
          onChange={(e) => setDbInstanceRole(e.target.value)}
          placeholder="db-primary"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-text-secondary mb-1 block text-xs">
            {currentDbTypeOption.idLabel}
          </label>
          <NeuInput
            value={dbIdentifier}
            onChange={(e) => setDbIdentifier(e.target.value)}
            placeholder={currentDbTypeOption.idPlaceholder}
            required
          />
        </div>
        <div className="w-24">
          <label className="text-text-secondary mb-1 block text-xs">포트</label>
          <NeuInput
            type="number"
            value={port || String(currentDbTypeOption.defaultPort)}
            onChange={(e) => setPort(e.target.value)}
            placeholder={String(currentDbTypeOption.defaultPort)}
          />
        </div>
      </div>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">DB 계정</label>
        <NeuInput
          value={dbUsername}
          onChange={(e) => setDbUsername(e.target.value)}
          placeholder="monitor"
          required
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-text-secondary mb-1 block text-xs">DB 패스워드</label>
          <NeuInput
            type="password"
            value={dbPassword}
            onChange={(e) => setDbPassword(e.target.value)}
            required
          />
        </div>
        <div className="w-28">
          <label className="text-text-secondary mb-1 block text-xs">수집 주기(초)</label>
          <NeuInput
            type="number"
            value={dbInterval}
            onChange={(e) => setDbInterval(e.target.value)}
            placeholder="60"
            min="10"
          />
        </div>
      </div>
    </div>
  )
}
