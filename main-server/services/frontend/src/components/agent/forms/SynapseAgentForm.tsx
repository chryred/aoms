import { Plus, Trash2 } from 'lucide-react'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import type { AgentFormState, LogMonitorForm, WebServerForm } from '@/hooks/useAgentFormLogic'
import { COLLECTOR_KEYS, WEB_SERVER_LOG_FORMATS } from '@/hooks/useAgentFormLogic'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import type { WebServerLogFormat } from '@/types/agent'

interface SynapseAgentFormProps {
  form: Pick<
    AgentFormState,
    | 'sshUsername'
    | 'setSshUsername'
    | 'instanceRole'
    | 'setInstanceRole'
    | 'installPath'
    | 'setInstallPath'
    | 'configPath'
    | 'setConfigPath'
    | 'pidFile'
    | 'setPidFile'
    | 'collectors'
    | 'toggleCollector'
    | 'logMonitors'
    | 'addLogMonitor'
    | 'removeLogMonitor'
    | 'updateLogMonitor'
    | 'webServers'
    | 'addWebServer'
    | 'removeWebServer'
    | 'updateWebServer'
  >
}

export function SynapseAgentForm({ form }: SynapseAgentFormProps) {
  const {
    sshUsername,
    setSshUsername,
    instanceRole,
    setInstanceRole,
    installPath,
    setInstallPath,
    configPath,
    setConfigPath,
    pidFile,
    setPidFile,
    collectors,
    toggleCollector,
    logMonitors,
    addLogMonitor,
    removeLogMonitor,
    updateLogMonitor,
    webServers,
    addWebServer,
    removeWebServer,
    updateWebServer,
  } = form

  return (
    <>
      {/* SSH 계정 */}
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
          이 경로에 접근 가능한 OS 계정. 이후 에이전트 제어 시 동일 계정으로 로그인해야 합니다.
        </p>
      </div>

      {/* instance_role */}
      <div>
        <label className="text-text-secondary mb-1 block text-xs">
          instance_role{' '}
          <span className="text-text-secondary/60">(HA 구분: was1, was2, db-primary …)</span>
        </label>
        <NeuInput
          value={instanceRole}
          onChange={(e) => setInstanceRole(e.target.value)}
          placeholder="was1"
        />
      </div>

      {/* 바이너리/설정/PID 경로 */}
      <div>
        <label className="text-text-secondary mb-1 block text-xs">바이너리 경로</label>
        <NeuInput value={installPath} onChange={(e) => setInstallPath(e.target.value)} required />
      </div>
      <div>
        <label className="text-text-secondary mb-1 block text-xs">
          설정 파일 경로
          <span className="text-text-secondary/60"> (자동 생성)</span>
        </label>
        <NeuInput value={configPath} onChange={(e) => setConfigPath(e.target.value)} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-text-secondary mb-1 block text-xs">PID 파일 경로</label>
          <NeuInput value={pidFile} onChange={(e) => setPidFile(e.target.value)} />
        </div>
      </div>

      {/* 수집항목 */}
      <div>
        <label className="text-text-secondary mb-2 block text-xs">수집항목</label>
        <div className="grid grid-cols-2 gap-1">
          {COLLECTOR_KEYS.map((key) => (
            <label
              key={key}
              className="hover:bg-surface flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1"
            >
              <input
                type="checkbox"
                checked={collectors[key] ?? false}
                onChange={() => toggleCollector(key)}
                className="accent-[var(--color-accent)]"
              />
              <span className="text-text-tertiary text-xs">{key}</span>
            </label>
          ))}
        </div>
      </div>

      {/* log_monitor 목록 */}
      <div aria-disabled={!collectors.log_monitor}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-text-secondary text-xs">로그 수집 설정</label>
            {!collectors.log_monitor && (
              <span className="text-text-tertiary text-xs">log_monitor 체크 시 활성</span>
            )}
          </div>
          <button
            type="button"
            onClick={addLogMonitor}
            disabled={!collectors.log_monitor}
            className="text-accent hover:text-accent/80 flex items-center gap-1 text-xs disabled:cursor-not-allowed"
          >
            <Plus className="h-3 w-3" />
            추가
          </button>
        </div>
        <div
          className={`space-y-2 transition-opacity duration-[400ms] ease-in-out ${
            collectors.log_monitor ? 'opacity-100' : 'pointer-events-none opacity-40'
          }`}
        >
          {logMonitors.map((lm: LogMonitorForm, idx: number) => (
            <div
              key={`lm-${idx}`}
              className="border-border bg-bg-deep space-y-2 rounded-sm border p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-xs">로그 소스 #{idx + 1}</span>
                {logMonitors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLogMonitor(idx)}
                    disabled={!collectors.log_monitor}
                    className="text-text-secondary hover:text-critical disabled:cursor-not-allowed"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div>
                <label className="text-text-secondary/70 mb-1 block text-xs">
                  경로 (한 줄에 하나)
                </label>
                <textarea
                  value={lm.paths}
                  onChange={(e) => updateLogMonitor(idx, 'paths', e.target.value)}
                  placeholder={'/server1/JeusServer.log\n/batch/JeusServer.log'}
                  rows={2}
                  disabled={!collectors.log_monitor}
                  className="border-border bg-bg-base text-text-primary placeholder-text-secondary/50 focus:border-accent focus:ring-accent pointer-events-auto w-full resize-none rounded-sm border px-2 py-1 text-xs focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex gap-2">
                <div className="w-28">
                  <label className="text-text-secondary/70 mb-1 block text-xs">log_type</label>
                  <NeuInput
                    value={lm.log_type}
                    onChange={(e) => updateLogMonitor(idx, 'log_type', e.target.value)}
                    placeholder="app"
                    disabled={!collectors.log_monitor}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-text-secondary/70 mb-1 block text-xs">
                    keywords (쉼표 구분)
                  </label>
                  <NeuInput
                    value={lm.keywords}
                    onChange={(e) => updateLogMonitor(idx, 'keywords', e.target.value)}
                    placeholder="ERROR, CRITICAL"
                    disabled={!collectors.log_monitor}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* web_servers 아코디언 */}
      <div
        className={`overflow-hidden transition-all duration-[400ms] ease-in-out ${
          collectors.web_servers ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="mb-2 flex items-center justify-between">
          <label className="text-text-secondary text-xs">웹 서버 설정</label>
          <button
            type="button"
            onClick={addWebServer}
            className="text-accent hover:text-accent/80 flex items-center gap-1 text-xs"
          >
            <Plus className="h-3 w-3" />
            추가
          </button>
        </div>
        <div className="space-y-2">
          {webServers.map((ws: WebServerForm, idx: number) => (
            <div
              key={`ws-${idx}`}
              className="border-border bg-bg-deep space-y-2 rounded-sm border p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-xs">웹 서버 #{idx + 1}</span>
                {webServers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeWebServer(idx)}
                    className="text-text-secondary hover:text-critical"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-text-secondary/70 mb-1 block text-xs">
                    식별자 <span className="text-text-secondary/50">(영문, name)</span>
                  </label>
                  <NeuInput
                    value={ws.name}
                    onChange={(e) => updateWebServer(idx, 'name', e.target.value)}
                    placeholder="webtob-main"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-text-secondary/70 mb-1 block text-xs">
                    표시명 <span className="text-text-secondary/50">(display_name)</span>
                  </label>
                  <NeuInput
                    value={ws.display_name}
                    onChange={(e) => updateWebServer(idx, 'display_name', e.target.value)}
                    placeholder="메인 웹서버"
                  />
                </div>
              </div>
              <div>
                <label className="text-text-secondary/70 mb-1 block text-xs">
                  액세스 로그 경로 <span className="text-text-secondary/50">(log_path)</span>
                </label>
                <NeuInput
                  value={ws.log_path}
                  onChange={(e) => updateWebServer(idx, 'log_path', e.target.value)}
                  placeholder="/var/log/apache/access.log"
                />
              </div>
              <div className="flex gap-2">
                <div className="w-32">
                  <label className="text-text-secondary/70 mb-1 block text-xs">log_format</label>
                  <NeuSelect
                    value={ws.log_format}
                    onChange={(e) =>
                      updateWebServer(idx, 'log_format', e.target.value as WebServerLogFormat)
                    }
                  >
                    {WEB_SERVER_LOG_FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </NeuSelect>
                </div>
                <div className="w-32">
                  <label className="text-text-secondary/70 mb-1 block text-xs">slow_ms</label>
                  <NeuInput
                    type="number"
                    min={1}
                    value={ws.slow_threshold_ms}
                    onChange={(e) => updateWebServer(idx, 'slow_threshold_ms', e.target.value)}
                    placeholder="3000"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-text-secondary/70 mb-1 block text-xs">
                    was_services (쉼표 구분)
                  </label>
                  <NeuInput
                    value={ws.was_services}
                    onChange={(e) => updateWebServer(idx, 'was_services', e.target.value)}
                    placeholder="jeus1, jeus2"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
