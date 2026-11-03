import { useEffect, useRef, useState } from 'react'
import { CheckCircle, XCircle, Loader2, ListChecks } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useInstallJob } from '@/hooks/queries/useAgents'
import type { InstallJobStatus } from '@/types/agent'

interface InstallJobMonitorProps {
  jobId: string
  onDone?: () => void
  /** 후보 JVM 이 2개 이상일 때 선택한 PID 로 설치를 다시 실행 (미지정이면 선택 UI 를 표시하지 않음) */
  onSelectTarget?: (pid: number) => void
}

const STATUS_ICON: Record<InstallJobStatus, React.ReactNode> = {
  pending: <Loader2 className="text-text-secondary h-4 w-4 animate-spin" />,
  running: <Loader2 className="text-accent h-4 w-4 animate-spin" />,
  done: <CheckCircle className="text-normal h-4 w-4" />,
  failed: <XCircle className="text-critical h-4 w-4" />,
  needs_target: <ListChecks className="text-accent h-4 w-4" />,
}

export function InstallJobMonitor({ jobId, onDone, onSelectTarget }: InstallJobMonitorProps) {
  const [selectedPid, setSelectedPid] = useState<number | null>(null)
  // 종료 상태(done/failed/needs_target)가 되면 폴링을 멈춘다. jobId 가 바뀌면 다시 폴링한다.
  const [settledJobId, setSettledJobId] = useState<string | null>(null)
  const isActive = settledJobId !== jobId
  const { data: job } = useInstallJob(jobId, isActive)
  const logRef = useRef<HTMLPreElement>(null)
  const doneFired = useRef(false)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [job?.logs])

  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed' || job?.status === 'needs_target') {
      setSettledJobId(jobId)
    }
  }, [job?.status, jobId])

  useEffect(() => {
    if ((job?.status === 'done' || job?.status === 'failed' || job?.status === 'needs_target') && !doneFired.current) {
      doneFired.current = true
      onDone?.()
    }
  }, [job?.status, onDone])

  if (!job) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {STATUS_ICON[job.status]}
        <span className="text-text-primary text-sm font-medium">
          {job.status === 'pending' && '설치 대기 중...'}
          {job.status === 'running' && '설치 진행 중...'}
          {job.status === 'done' && '설치 완료'}
          {job.status === 'failed' && '설치 실패'}
          {job.status === 'needs_target' && '설치할 JVM 선택 필요'}
        </span>
      </div>

      <pre
        ref={logRef}
        className="bg-bg-deep text-text-secondary h-48 overflow-y-auto rounded-sm p-3 font-mono text-xs whitespace-pre-wrap"
      >
        {job.logs || '로그 대기 중...'}
        {job.error && (
          <span className="text-critical">
            {'\n'}오류: {job.error}
          </span>
        )}
      </pre>

      {job.status === 'needs_target' && onSelectTarget && !!job.candidates?.length && (
        <div className="space-y-2">
          <p className="text-text-secondary text-xs">
            jvm_match 에 일치하는 JVM 이 {job.candidates.length}개입니다. 설치할 JVM 을 선택하세요.
            (선택은 이번 설치에만 적용됩니다)
          </p>
          <ul className="bg-bg-deep space-y-1 rounded-sm p-2" role="radiogroup" aria-label="설치 대상 JVM">
            {job.candidates.map((c) => (
              <li key={c.pid}>
                <label className="hover:bg-hover-subtle flex cursor-pointer items-start gap-2 rounded-sm p-2">
                  <input
                    type="radio"
                    name={`jvm-target-${jobId}`}
                    className="accent-accent mt-0.5"
                    checked={selectedPid === c.pid}
                    onChange={() => setSelectedPid(c.pid)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-text-primary block text-xs font-medium">
                      PID {c.pid} · {c.user}
                      {c.server_name ? ` · ${c.server_name}` : ''}
                    </span>
                    <span
                      className="text-text-secondary block truncate font-mono text-[11px]"
                      title={c.command}
                    >
                      {c.command}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <NeuButton
            size="sm"
            variant="primary"
            disabled={selectedPid === null}
            onClick={() => selectedPid !== null && onSelectTarget(selectedPid)}
          >
            선택한 JVM 으로 설치
          </NeuButton>
        </div>
      )}
    </div>
  )
}
