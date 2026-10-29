import { Link } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { ROUTES } from '@/constants/routes'
import { useApmSystemSummary } from '@/hooks/queries/useApmSystemSummary'

interface ApmSummaryCardProps {
  systemId: number
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-text-secondary text-xs">{label}</p>
      <p className="text-text-primary text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const LINK_CLASS = 'text-accent hover:text-accent/80 font-medium underline-offset-2 hover:underline'

/** 시스템 상세 "성능 분석" 영역 — 최근 1시간 요약 + 실시간 모니터링 진입 링크 */
export function ApmSummaryCard({ systemId }: ApmSummaryCardProps) {
  const { data, isLoading } = useApmSystemSummary(systemId)

  if (isLoading) {
    return (
      <NeuCard className="text-text-secondary animate-pulse py-6 text-center text-sm">
        불러오는 중...
      </NeuCard>
    )
  }

  if (!data?.has_agent_t) {
    return (
      <NeuCard className="text-text-secondary py-6 text-center text-sm">
        Agent-T 가 설치되지 않았습니다.
        <Link to={ROUTES.AGENTS} className={`${LINK_CLASS} ml-2`}>
          에이전트 관리에서 설치하기 →
        </Link>
      </NeuCard>
    )
  }

  return (
    <NeuCard>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-8">
          <Stat label="TPS (1시간)" value={data.tps_1h.toFixed(1)} />
          <Stat
            label="평균 응답 (1시간)"
            value={`${Math.round(data.avg_ms_1h).toLocaleString()}ms`}
          />
          <Stat
            label={`느린 건수 (≥ ${(data.slow_threshold_ms / 1000).toString()}초)`}
            value={`${data.slow_count_1h.toLocaleString()}건`}
          />
        </div>
        <Link to={`${ROUTES.APM_LIVE}?system=${systemId}`} className={LINK_CLASS}>
          실시간 모니터링 열기
        </Link>
      </div>
    </NeuCard>
  )
}
