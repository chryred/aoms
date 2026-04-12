import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useSystems } from '@/hooks/queries/useSystems'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { SystemTable } from '@/components/system/SystemTable'
import { SystemFormDrawer } from '@/components/system/SystemFormDrawer'
import type { System } from '@/types/system'

export function SystemListPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<System | undefined>()
  const [searchQuery, setSearchQuery] = useState('')

  const { data: systems, isLoading, error, refetch } = useSystems()

  const openCreate = () => {
    setEditTarget(undefined)
    setDrawerOpen(true)
  }

  const openEdit = (system: System) => {
    setEditTarget(system)
    setDrawerOpen(true)
  }

  const handleCreated = (newSystem: System) => {
    // 등록 직후 수정 모드로 전환 → 담당자 연결 패널 바로 노출
    setEditTarget(newSystem)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditTarget(undefined)
  }

  return (
    <>
      <PageHeader
        title="시스템 관리"
        description="모니터링 대상 시스템을 관리합니다"
        action={
          <NeuButton onClick={openCreate}>
            <Plus className="h-4 w-4" />
            시스템 등록
          </NeuButton>
        }
      />

      {/* 검색 */}
      <div className="mb-4 max-w-sm">
        <NeuInput
          placeholder="시스템명, 호스트 검색..."
          leftIcon={<Search className="h-4 w-4" />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <LoadingSkeleton shape="table" count={5} />
      ) : error ? (
        <ErrorCard onRetry={refetch} />
      ) : (
        <NeuCard className="overflow-hidden p-0">
          <SystemTable systems={systems ?? []} onEdit={openEdit} searchQuery={searchQuery} />
        </NeuCard>
      )}

      <SystemFormDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        onCreated={handleCreated}
        editTarget={editTarget}
      />
    </>
  )
}
