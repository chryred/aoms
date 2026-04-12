import { useEffect, useRef } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { useInstallJob } from '@/hooks/queries/useAgents'
import type { InstallJobStatus } from '@/types/agent'

interface InstallJobMonitorProps {
  jobId: string
  onDone?: () => void
}

const STATUS_ICON: Record<InstallJobStatus, React.ReactNode> = {
  pending: <Loader2 className="h-4 w-4 animate-spin text-[#8B97AD]" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-[#00D4FF]" />,
  done: <CheckCircle className="h-4 w-4 text-[#22C55E]" />,
  failed: <XCircle className="h-4 w-4 text-[#EF4444]" />,
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
    if (job?.status === 'done' && !doneFired.current) {
      doneFired.current = true
      onDone?.()
    }
  }, [job?.status, onDone])

  if (!job) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {STATUS_ICON[job.status]}
        <span className="text-sm font-medium text-[#E2E8F2]">
          {job.status === 'pending' && '설치 대기 중...'}
          {job.status === 'running' && '설치 진행 중...'}
          {job.status === 'done' && '설치 완료'}
          {job.status === 'failed' && '설치 실패'}
        </span>
      </div>

      <pre
        ref={logRef}
        className="h-48 overflow-y-auto rounded-sm bg-[#13151A] p-3 font-mono text-xs whitespace-pre-wrap text-[#8B97AD]"
      >
        {job.logs || '로그 대기 중...'}
        {job.error && (
          <span className="text-[#EF4444]">
            {'\n'}오류: {job.error}
          </span>
        )}
      </pre>
    </div>
  )
}
