import { useState, useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useGuides } from '@/hooks/queries/useGuides'
import { useDeleteGuide } from '@/hooks/mutations/useGuideMutations'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { ConfirmDialog } from '@/components/user/ConfirmDialog'
import { GuideListView } from '@/components/admin/KnowledgeGuides/GuideListView'
import { GuideEditModal } from '@/components/admin/KnowledgeGuides/GuideEditModal'
import type { GuideSummary, GuideCategory, GuideListParams } from '@/types/guide'

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '전체 카테고리' },
  { value: 'howto', label: 'How-to (사용 방법)' },
  { value: 'error', label: '오류 해결' },
  { value: 'navigation', label: '화면 안내' },
]

export function KnowledgeGuidesPage() {
  const user = useAuthStore((s) => s.user)
  const userRole = user?.role ?? 'operator'

  // ── 시스템 목록 ────────────────────────────────────────────────
  const { data: allSystems = [] } = useSystems()
  const { data: mySystems = [] } = useMyPrimarySystems()

  // operator가 담당하는 system_id 목록
  const mySystemIds = useMemo(() => mySystems.map((s) => s.system_id), [mySystems])

  // 시스템 필터 드롭다운 옵션
  const systemOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [{ value: '', label: '전체 시스템' }]
    // "공통(시스템 무관)" 필터는 모든 역할에서 사용 가능 — 읽기 권한은 누구나 있음
    options.push({ value: 'null', label: '공통 (시스템 무관)' })
    if (userRole === 'admin') {
      allSystems.forEach((s) => options.push({ value: String(s.id), label: s.display_name }))
    } else {
      // operator: 자신 담당 시스템만 표시
      allSystems
        .filter((s) => mySystemIds.includes(s.id))
        .forEach((s) => options.push({ value: String(s.id), label: s.display_name }))
    }
    return options
  }, [userRole, allSystems, mySystemIds])

  // ── 필터 상태 ──────────────────────────────────────────────────
  const [systemFilter, setSystemFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [searchText, setSearchText] = useState('')

  // API 파라미터 구성
  const queryParams: GuideListParams = useMemo(() => {
    const p: GuideListParams = { limit: 100, offset: 0 }
    if (systemFilter === 'null') p.system_id = null
    else if (systemFilter) p.system_id = Number(systemFilter)
    if (categoryFilter) p.category = categoryFilter as GuideCategory
    if (searchText.trim()) p.search = searchText.trim()
    return p
  }, [systemFilter, categoryFilter, searchText])

  const { data: guidesResult, isLoading } = useGuides(queryParams)
  const guides = guidesResult?.items ?? []

  // ── 모달 상태 ──────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<GuideSummary | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalReadOnly, setModalReadOnly] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GuideSummary | null>(null)

  const deleteMutation = useDeleteGuide()

  const openCreate = () => {
    setEditTarget(null)
    setModalReadOnly(false)
    setModalOpen(true)
  }

  const openEdit = (guide: GuideSummary) => {
    setEditTarget(guide)
    setModalReadOnly(false)
    setModalOpen(true)
  }

  const openView = (guide: GuideSummary) => {
    setEditTarget(guide)
    setModalReadOnly(true)
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTarget(null)
    setModalReadOnly(false)
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success('가이드가 삭제되었습니다.')
        setDeleteTarget(null)
      },
      onError: () => {
        toast.error('가이드 삭제에 실패했습니다.')
        setDeleteTarget(null)
      },
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="지식 가이드 관리"
        description="챗봇 응답에 포함될 이미지+텍스트 가이드 문서를 관리합니다."
        action={
          <NeuButton size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />새 가이드
          </NeuButton>
        }
      />

      {/* 필터 영역 */}
      <div className="flex flex-wrap items-end gap-3">
        {/* 시스템 필터 */}
        <div className="min-w-[180px]">
          <NeuSelect
            id="filter-system"
            label="시스템"
            value={systemFilter}
            onChange={(e) => setSystemFilter(e.target.value)}
          >
            {systemOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NeuSelect>
        </div>

        {/* 카테고리 필터 */}
        <div className="min-w-[160px]">
          <NeuSelect
            id="filter-category"
            label="카테고리"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NeuSelect>
        </div>

        {/* 검색 */}
        <div className="min-w-[200px] flex-1">
          <NeuInput
            id="filter-search"
            label="검색"
            placeholder="제목 또는 태그 검색"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        </div>
      </div>

      {/* 결과 카운트 */}
      {!isLoading && (
        <p className="text-text-secondary text-sm">
          총 <strong className="text-text-primary">{guidesResult?.total ?? 0}</strong>개의 가이드
        </p>
      )}

      {/* 리스트 */}
      <GuideListView
        guides={guides}
        isLoading={isLoading}
        userRole={userRole}
        mySystemIds={mySystemIds}
        currentUserId={user?.id ?? 0}
        onEdit={openEdit}
        onDelete={(guide) => setDeleteTarget(guide)}
        onView={openView}
      />

      {/* 편집/생성/보기 모달 */}
      <GuideEditModal
        open={modalOpen}
        onClose={closeModal}
        editTarget={editTarget}
        userRole={userRole}
        mySystemIds={mySystemIds}
        readOnly={modalReadOnly}
      />

      {/* 삭제 확인 다이얼로그 */}
      {deleteTarget && (
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          title="가이드 삭제"
          description={`"${deleteTarget.title}" 가이드를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          confirmVariant="destructive"
          onConfirm={handleDeleteConfirm}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  )
}
