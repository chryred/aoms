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
            <Plus className="w-4 h-4" />
            시스템 등록
          </NeuButton>
        }
      />

      {/* 검색 */}
      <div className="mb-4 max-w-sm">
        <NeuInput
          placeholder="시스템명, 호스트 검색..."
          leftIcon={<Search className="w-4 h-4" />}
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
        <NeuCard className="p-0 overflow-hidden">
          <SystemTable
            systems={systems ?? []}
            onEdit={openEdit}
            searchQuery={searchQuery}
          />
        </NeuCard>
      )}

      <SystemFormDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        editTarget={editTarget}
      />
    </>
  )
}
