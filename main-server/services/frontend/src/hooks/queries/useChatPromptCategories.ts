import {
  type LucideIcon,
  Server,
  AlertTriangle,
  BookOpen,
  FileSearch,
  TrendingUp,
  History,
} from 'lucide-react'
import { useMyPrimarySystems } from './useMyPrimarySystems'

export interface PromptCategory {
  category: string
  prompt: string
  icon: LucideIcon
}

export interface PromptGroup {
  label: string
  items: PromptCategory[]
}

// Fallback names used when the user has no primary systems assigned
const FALLBACK_STATUS_SYSTEM = 'CRM 서버'
const FALLBACK_METRIC_SYSTEM = '고객경험 시스템'

/**
 * 추천 카드 6개를 의미 그룹 2개로 묶어 반환:
 * - 시스템 상태 (실시간/현재): 시스템 상태, 메트릭 추이, 로그 분석
 * - 지식·이력 (정적/과거): 장애 이력, 운영 정책, 유사 사례
 *
 * 각 그룹은 3개씩, cognitive load 4개 권장 한계 안에 들어옴.
 * 카드 prompt는 사용자 첫 담당 시스템 이름으로 치환 (없으면 fallback).
 */
export function useChatPromptCategories(): PromptGroup[] {
  const { data: primarySystems, isLoading } = useMyPrimarySystems()

  const firstSystem =
    !isLoading && primarySystems && primarySystems.length > 0
      ? primarySystems[0].display_name
      : null

  const statusSystem = firstSystem ?? FALLBACK_STATUS_SYSTEM
  const metricSystem = firstSystem ?? FALLBACK_METRIC_SYSTEM

  return [
    {
      label: '시스템 상태',
      items: [
        {
          icon: Server,
          category: '시스템 상태',
          prompt: `${statusSystem} 오늘 CPU 사용률 알려줘`,
        },
        {
          icon: TrendingUp,
          category: '메트릭 추이',
          prompt: `${metricSystem} 메모리 사용률 추이`,
        },
        {
          icon: FileSearch,
          category: '로그 분석',
          prompt: '방금 발생한 알림 관련 에러 로그 보여줘',
        },
      ],
    },
    {
      label: '지식·이력',
      items: [
        {
          icon: AlertTriangle,
          category: '장애 이력',
          prompt: '지난주 결제 시스템 장애 원인 정리해줘',
        },
        {
          icon: BookOpen,
          category: '운영 정책',
          prompt: 'VIP 등급 기준이 뭐야?',
        },
        {
          icon: History,
          category: '유사 사례',
          prompt: '비슷한 장애 이력 검색해줘',
        },
      ],
    },
  ]
}
