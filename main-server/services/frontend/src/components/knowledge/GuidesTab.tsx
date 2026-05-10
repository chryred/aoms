import { useState, useMemo } from 'react'
import { Plus, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useGuides } from '@/hooks/queries/useGuides'
import {
  useDeleteGuide,
  usePublishGuide,
  useUnpublishGuide,
} from '@/hooks/mutations/useGuideMutations'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { ConfirmDialog } from '@/components/user/ConfirmDialog'
import { GuideListView } from '@/components/admin/KnowledgeGuides/GuideListView'
import { GuideEditModal } from '@/components/admin/KnowledgeGuides/GuideEditModal'
import type { GuideSummary, GuideCategory, GuideListParams, GuideStatus } from '@/types/guide'

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '전체 카테고리' },
  { value: 'howto', label: 'How-to (사용 방법)' },
  { value: 'error', label: '오류 해결' },
  { value: 'navigation', label: '화면 안내' },
]

type StatusTab = '' | 'published' | 'draft'

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: '', label: '전체' },
  { value: 'published', label: '게시됨' },
  { value: 'draft', label: '검토 대기' },
]

export function GuidesTab() {
  const user = useAuthStore((s) => s.user)
  const userRole = user?.role ?? 'operator'

  // ── 시스템 목록 ────────────────────────────────────────────────
  const { data: allSystems = [] } = useSystems()
  const { data: mySystems = [] } = useMyPrimarySystems()

  const mySystemIds = useMemo(() => mySystems.map((s) => s.system_id), [mySystems])

  const systemOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [{ value: '', label: '전체 시스템' }]
    options.push({ value: 'null', label: '공통 (시스템 무관)' })
    if (userRole === 'admin') {
      allSystems.forEach((s) => options.push({ value: String(s.id), label: s.display_name }))
    } else {
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
  const [statusTab, setStatusTab] = useState<StatusTab>('')

  const queryParams: GuideListParams = useMemo(() => {
    const p: GuideListParams = { limit: 100, offset: 0 }
    if (systemFilter === 'null') p.system_id = null
    else if (systemFilter) p.system_id = Number(systemFilter)
    if (categoryFilter) p.category = categoryFilter as GuideCategory
    if (searchText.trim()) p.search = searchText.trim()
    if (statusTab) p.status = statusTab as GuideStatus
    return p
  }, [systemFilter, categoryFilter, searchText, statusTab])

  const { data: guidesResult, isLoading } = useGuides(queryParams)
  const guides = guidesResult?.items ?? []

  // ── 모달 상태 ──────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<GuideSummary | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalReadOnly, setModalReadOnly] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GuideSummary | null>(null)

  const deleteMutation = useDeleteGuide()
  const publishMutation = usePublishGuide()
  const unpublishMutation = useUnpublishGuide()

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

  const handlePublish = (guide: GuideSummary) => {
    publishMutation.mutate(guide.id, {
      onSuccess: () => {
        toast.success(`"${guide.title}" 가이드가 게시되었습니다.`)
      },
      onError: () => {
        toast.error('게시에 실패했습니다.')
      },
    })
  }

  const handleUnpublish = (guide: GuideSummary) => {
    unpublishMutation.mutate(guide.id, {
      onSuccess: () => {
        toast.success(`"${guide.title}" 가이드를 초안으로 되돌렸습니다.`)
      },
      onError: () => {
        toast.error('게시취소에 실패했습니다.')
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* 탭 헤더 — 설명 + 새 가이드 버튼 */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-text-secondary text-sm">
          챗봇 응답에 포함될 이미지+텍스트 가이드 문서를 관리합니다.
          <br />
          <span className="text-warning text-xs">
            ⚠️ LLM이 자동 저장한 가이드는 <strong>검토 대기</strong> 상태로 표시됩니다. 게시 전에
            내용을 검토하고 게시(Publish) 버튼을 눌러야 RAG 검색에 노출됩니다.
          </span>
        </p>
        <NeuButton size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />새 가이드
        </NeuButton>
      </div>

      {/* 상태 필터 탭 */}
      <div
        className="bg-bg-base shadow-neu-pressed relative flex rounded-sm p-1"
        role="tablist"
        aria-label="가이드 상태 필터"
      >
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={statusTab === tab.value}
            onClick={() => setStatusTab(tab.value)}
            className={
              statusTab === tab.value
                ? 'bg-accent shadow-neu-flat text-accent-contrast rounded-sm px-4 py-1.5 text-sm font-semibold transition-all'
                : 'text-text-secondary hover:text-text-primary rounded-sm px-4 py-1.5 text-sm transition-all'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 필터 영역 */}
      <div className="flex flex-wrap items-end gap-3">
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
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
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
