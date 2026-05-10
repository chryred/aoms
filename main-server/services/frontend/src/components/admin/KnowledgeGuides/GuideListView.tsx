import { Eye, Pencil, Trash2, ImageIcon, BookCheck, BookX } from 'lucide-react'
import { cn, formatKST } from '@/lib/utils'
import type { GuideSummary, GuideCategory } from '@/types/guide'
import { GuideStatusBadge } from './GuideStatusBadge'

const CATEGORY_LABELS: Record<GuideCategory, string> = {
  howto: 'How-to',
  error: '오류 해결',
  navigation: '화면 안내',
}

const CATEGORY_COLORS: Record<GuideCategory, string> = {
  howto: 'text-normal bg-normal/10',
  error: 'text-critical bg-critical/10',
  navigation: 'text-accent bg-accent/10',
}

interface GuideListViewProps {
  guides: GuideSummary[]
  isLoading: boolean
  /** 현재 사용자 역할 */
  userRole: 'admin' | 'operator'
  /** operator가 수정/삭제 가능한 시스템 ID 목록 */
  mySystemIds: number[]
  /** 현재 사용자 ID */
  currentUserId: number
  onEdit: (guide: GuideSummary) => void
  onDelete: (guide: GuideSummary) => void
  onView: (guide: GuideSummary) => void
  onPublish?: (guide: GuideSummary) => void
  onUnpublish?: (guide: GuideSummary) => void
}

export function GuideListView({
  guides,
  isLoading,
  userRole,
  mySystemIds,
  currentUserId,
  onEdit,
  onDelete,
  onView,
  onPublish,
  onUnpublish,
}: GuideListViewProps) {
  const canEdit = (guide: GuideSummary) => {
    if (userRole === 'admin') return true
    // operator: 자신이 담당하는 시스템이고 자신이 등록한 것만
    return (
      guide.system_id !== null &&
      mySystemIds.includes(guide.system_id) &&
      guide.created_by === currentUserId
    )
  }

  const canPublish = (guide: GuideSummary) => {
    if (userRole === 'admin') return true
    // operator: 자신 담당 시스템만 (created_by 무관), 공통(null) 불가
    return guide.system_id !== null && mySystemIds.includes(guide.system_id)
  }

  if (isLoading) {
    return (
      <div
        className="bg-bg-base shadow-neu-flat rounded-sm"
        aria-busy="true"
        aria-label="가이드 목록 로딩 중"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-border border-b">
                {['상태', '제목', '시스템', '카테고리', '태그', '이미지', '등록일', '작성자', '액션'].map(
                  (h) => (
                    <th key={h} className="type-label px-4 py-3 text-left whitespace-nowrap">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-border border-b">
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="bg-bg-deep h-4 animate-pulse rounded-sm" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  if (guides.length === 0) {
    return (
      <div className="bg-bg-base shadow-neu-flat flex flex-col items-center justify-center rounded-sm px-4 py-12">
        <p className="text-text-secondary text-sm">등록된 가이드가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="bg-bg-base shadow-neu-flat overflow-hidden rounded-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="type-label px-4 py-3 text-left whitespace-nowrap">상태</th>
              <th className="type-label px-4 py-3 text-left whitespace-nowrap">제목</th>
              <th className="type-label hidden px-4 py-3 text-left whitespace-nowrap md:table-cell">
                시스템
              </th>
              <th className="type-label hidden px-4 py-3 text-left whitespace-nowrap sm:table-cell">
                카테고리
              </th>
              <th className="type-label hidden px-4 py-3 text-left whitespace-nowrap lg:table-cell">
                태그
              </th>
              <th className="type-label px-4 py-3 text-left whitespace-nowrap">
                <span className="flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" />
                </span>
              </th>
              <th className="type-label hidden px-4 py-3 text-left whitespace-nowrap md:table-cell">
                등록일
              </th>
              <th className="type-label hidden px-4 py-3 text-left whitespace-nowrap md:table-cell">
                작성자
              </th>
              <th className="type-label px-4 py-3 text-left whitespace-nowrap">액션</th>
            </tr>
          </thead>
          <tbody>
            {guides.map((guide) => {
              const editable = canEdit(guide)
              const publishable = canPublish(guide)
              return (
                <tr
                  key={guide.id}
                  className={cn(
                    'border-border hover:bg-hover-subtle border-b last:border-0',
                    guide.status === 'draft' && 'bg-warning/5',
                  )}
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <GuideStatusBadge status={guide.status} />
                  </td>
                  <td className="text-text-primary max-w-[240px] px-4 py-3 whitespace-nowrap">
                    <span className="truncate font-medium" title={guide.title}>
                      {guide.title}
                    </span>
                  </td>
                  <td className="text-text-secondary hidden px-4 py-3 whitespace-nowrap md:table-cell">
                    {guide.system_name ?? <span className="text-text-disabled italic">공통</span>}
                  </td>
                  <td className="hidden px-4 py-3 whitespace-nowrap sm:table-cell">
                    {guide.category ? (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          CATEGORY_COLORS[guide.category],
                        )}
                      >
                        {CATEGORY_LABELS[guide.category]}
                      </span>
                    ) : (
                      <span className="text-text-disabled text-xs">—</span>
                    )}
                  </td>
                  <td className="hidden max-w-[180px] px-4 py-3 lg:table-cell">
                    {guide.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {guide.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="border-border bg-bg-deep rounded-sm border px-1.5 py-0.5 text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                        {guide.tags.length > 3 && (
                          <span className="text-text-disabled text-xs">
                            +{guide.tags.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-text-disabled text-xs">—</span>
                    )}
                  </td>
                  <td className="text-text-secondary px-4 py-3 whitespace-nowrap">
                    <span className="flex items-center gap-1 text-xs">
                      <ImageIcon className="h-3 w-3" />
                      {guide.image_count}
                    </span>
                  </td>
                  <td className="text-text-secondary hidden px-4 py-3 whitespace-nowrap md:table-cell">
                    {formatKST(guide.created_at, 'date')}
                  </td>
                  <td className="text-text-secondary hidden px-4 py-3 whitespace-nowrap md:table-cell">
                    {guide.created_by_name ?? (
                      <span className="text-text-disabled italic text-xs">챗봇</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {/* 게시/게시취소 버튼 */}
                      {publishable && guide.status === 'draft' && onPublish && (
                        <button
                          onClick={() => onPublish(guide)}
                          title="게시 (Qdrant 인덱싱)"
                          aria-label={`${guide.title} 게시`}
                          className="focus:ring-accent rounded-sm p-1.5 text-xs text-normal hover:text-normal/80 focus:ring-1 focus:outline-none"
                        >
                          <BookCheck className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {publishable && guide.status === 'published' && onUnpublish && (
                        <button
                          onClick={() => onUnpublish(guide)}
                          title="게시취소 (Qdrant 삭제)"
                          aria-label={`${guide.title} 게시취소`}
                          className="focus:ring-warning rounded-sm p-1.5 text-xs text-warning hover:text-warning/80 focus:ring-1 focus:outline-none"
                        >
                          <BookX className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* 수정/삭제/보기 버튼 */}
                      {editable ? (
                        <>
                          <button
                            onClick={() => onEdit(guide)}
                            title="수정"
                            aria-label={`${guide.title} 수정`}
                            className="focus:ring-accent text-text-secondary hover:text-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => onDelete(guide)}
                            title="삭제"
                            aria-label={`${guide.title} 삭제`}
                            className="focus:ring-critical text-text-secondary hover:text-critical rounded-sm p-1.5 focus:ring-1 focus:outline-none"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => onView(guide)}
                          title="보기"
                          aria-label={`${guide.title} 보기`}
                          className="focus:ring-accent text-text-secondary hover:text-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
