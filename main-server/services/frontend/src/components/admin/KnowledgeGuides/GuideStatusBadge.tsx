import type { GuideStatus } from '@/types/guide'

interface GuideStatusBadgeProps {
  status: GuideStatus
}

/**
 * 가이드 상태 배지 (draft / published).
 *
 * 디자인 시스템 규칙:
 * - CSS 변수 기반 색상 토큰만 사용 (하드코딩 hex 금지)
 * - rounded-full (pill 배지 예외)
 * - semantic 색상: draft=text-warning(amber), published=text-normal(green)
 */
export function GuideStatusBadge({ status }: GuideStatusBadgeProps) {
  if (status === 'draft') {
    return (
      <span className="bg-warning/10 text-warning inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
        <span className="bg-warning h-1.5 w-1.5 rounded-full" aria-hidden="true" />
        검토 대기
      </span>
    )
  }

  return (
    <span className="bg-normal/10 text-normal inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
      <span className="bg-normal h-1.5 w-1.5 rounded-full" aria-hidden="true" />
      게시됨
    </span>
  )
}
