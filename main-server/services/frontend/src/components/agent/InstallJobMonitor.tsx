import { useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { useInstallJob } from '@/hooks/queries/useAgents'
import type { InstallJobStatus } from '@/types/agent'

interface InstallJobMonitorProps {
  jobId: string
  onDone?: () => void
}

const STATUS_ICON: Record<InstallJobStatus, React.ReactNode> = {
  pending: <Loader2 className="text-text-secondary h-4 w-4 animate-spin" />,
  running: <Loader2 className="text-accent h-4 w-4 animate-spin" />,
  done: <CheckCircle className="text-normal h-4 w-4" />,
  failed: <XCircle className="text-critical h-4 w-4" />,
}

export function InstallJobMonitor({ jobId, onDone }: InstallJobMonitorProps) {
  const isActive = true
  const { data: job } = useInstallJob(jobId, isActive)
  const logRef = useRef<HTMLPreElement>(null)
  const doneFired = useRef(false)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [job?.logs])

  useEffect(() => {
    if ((job?.status === 'done' || job?.status === 'failed') && !doneFired.current) {
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
    </div>
  )
}
