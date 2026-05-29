import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, ChevronLeft, ChevronDown, ChevronUp, X } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useSslDeployments, useSslServers } from '@/hooks/queries/useSslServers'
import { ROUTES } from '@/constants/routes'
import { formatKST, cn } from '@/lib/utils'
import type { SslDeployment } from '@/types/ssl'

const WS_BASE = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'success'
      ? 'bg-normal/10 text-normal'
      : status === 'failed'
        ? 'bg-critical/10 text-critical'
        : status === 'running'
          ? 'bg-accent/10 text-accent'
          : 'bg-warning/10 text-warning'
  return <span className={cn('rounded-sm px-2 py-0.5 text-xs font-medium', cls)}>{status}</span>
}

// ── WebSocket 로그 뷰어 ────────────────────────────────────────────────────────
function DeployLogViewer({ deployId, onClose }: { deployId: number; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/ssl-deploy/${deployId}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onmessage = (e) => {
      setLines((prev) => [...prev, e.data as string])
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    ws.onclose = () => setConnected(false)

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 20_000)

    return () => {
      clearInterval(ping)
      ws.close()
    }
  }, [deployId])

  return (
    <div className="bg-surface border-border shadow-neu-flat fixed right-4 bottom-4 z-50 w-[480px] rounded-sm border">
      <div className="border-border flex items-center justify-between border-b px-4 py-2">
        <span className="text-text-primary text-sm font-medium">
          배포 로그{' '}
          <span className={cn('text-xs', connected ? 'text-normal' : 'text-text-disabled')}>
            {connected ? '● 연결됨' : '○ 종료'}
          </span>
        </span>
        <NeuButton size="sm" variant="ghost" onClick={onClose} aria-label="로그 뷰어 닫기">
          <X className="h-4 w-4" />
        </NeuButton>
      </div>
      <div className="h-48 overflow-y-auto p-3 font-mono text-xs">
        {lines.length === 0 ? (
          <p className="text-text-disabled">로그 대기 중…</p>
        ) : (
          lines.map((l, i) => (
            <p key={i} className="text-text-secondary leading-5">
              {l}
            </p>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── 배포 이력 행 ──────────────────────────────────────────────────────────────
function DeployRow({
  dep,
  serverName,
  onViewLog,
}: {
  dep: SslDeployment
  serverName: string
  onViewLog: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <tr className="border-border border-b last:border-0">
        <td className="py-3 pr-4">
          <p className="text-text-primary text-sm font-medium">{serverName}</p>
          <p className="text-text-secondary text-xs">{formatKST(dep.deployed_at, 'datetime')}</p>
        </td>
        <td className="py-3 pr-4">
          <StatusBadge status={dep.status} />
        </td>
        <td className="py-3 pr-4 text-sm">
          <span className="text-text-secondary">
            {dep.trigger_type === 'auto_batch' ? '자동 배치' : '수동'}
          </span>
        </td>
        <td className="py-3 pr-4 text-sm">
          <span className="text-text-secondary">
            {dep.duration_sec != null ? `${dep.duration_sec}s` : '—'}
          </span>
        </td>
        <td className="py-3 text-right">
          <div className="flex justify-end gap-1">
            <NeuButton
              size="sm"
              variant="ghost"
              onClick={() => onViewLog(dep.id)}
              title="로그 뷰어"
            >
              <Play className="h-3 w-3" />
            </NeuButton>
            {dep.deploy_log && (
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={() => setExpanded((v) => !v)}
                title="로그 펼치기"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </NeuButton>
            )}
          </div>
        </td>
      </tr>
      {expanded && dep.deploy_log && (
        <tr>
          <td colSpan={5} className="pb-3 pl-4">
            <pre className="bg-bg-deep text-text-secondary rounded-sm p-3 text-xs leading-5 whitespace-pre-wrap">
              {dep.deploy_log}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export function SslDeploymentHistoryPage() {
  const navigate = useNavigate()
  const [selectedDeploy, setSelectedDeploy] = useState<number | null>(null)

  const { data: deployments, isLoading, isError, refetch } = useSslDeployments({ limit: 100 })
  const { data: servers } = useSslServers()

  const serverMap = Object.fromEntries((servers ?? []).map((s) => [s.id, s.host]))

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="SSL 배포 이력"
        description="인증서 배포 실행 결과 및 로그"
        action={
          <NeuButton size="sm" variant="ghost" onClick={() => navigate(ROUTES.SSL_DASHBOARD)}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            현황
          </NeuButton>
        }
      />

      {isLoading && <LoadingSkeleton count={5} />}
      {isError && <ErrorCard message="배포 이력을 불러오지 못했습니다." onRetry={refetch} />}

      {deployments && deployments.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-text-secondary">배포 이력이 없습니다</p>
        </div>
      )}

      {deployments && deployments.length > 0 && (
        <div className="bg-surface border-border overflow-x-auto rounded-sm border">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-border border-b">
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  서버 / 시각
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  상태
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  트리거
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  소요
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="px-4">
              {deployments.map((dep) => (
                <DeployRow
                  key={dep.id}
                  dep={dep}
                  serverName={
                    dep.server_id != null ? (serverMap[dep.server_id] ?? `#${dep.server_id}`) : '—'
                  }
                  onViewLog={setSelectedDeploy}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedDeploy !== null && (
        <DeployLogViewer deployId={selectedDeploy} onClose={() => setSelectedDeploy(null)} />
      )}
    </div>
  )
}
