import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Upload, BookMarked, RefreshCw, TrendingUp, Tag, ThumbsDown, Search } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { DocumentUploadTab } from '@/components/knowledge/DocumentUploadTab'
import { GuidesTab } from '@/components/knowledge/GuidesTab'
import { SyncStatusTab } from '@/components/knowledge/SyncStatusTab'
import { FrequentQuestionsTab } from '@/components/knowledge/FrequentQuestionsTab'
import { OperatorNotesTab } from '@/components/knowledge/OperatorNotesTab'
import { FeedbackTab } from '@/components/knowledge/FeedbackTab'
import { SearchVerifyTab } from '@/components/knowledge/SearchVerifyTab'
import { cn } from '@/lib/utils'

type KnowledgeTab = 'documents' | 'guides' | 'sync' | 'frequent' | 'notes' | 'feedback' | 'verify'

const TABS: Array<{ key: KnowledgeTab; label: string; icon: React.ReactNode }> = [
  { key: 'documents', label: '문서', icon: <Upload className="h-4 w-4" /> },
  { key: 'guides', label: '가이드 관리', icon: <BookMarked className="h-4 w-4" /> },
  { key: 'sync', label: '동기화', icon: <RefreshCw className="h-4 w-4" /> },
  { key: 'frequent', label: '질문 분석', icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'notes', label: '운영자 노트', icon: <Tag className="h-4 w-4" /> },
  { key: 'feedback', label: '피드백', icon: <ThumbsDown className="h-4 w-4" /> },
  { key: 'verify', label: '검색 검증', icon: <Search className="h-4 w-4" /> },
]

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as KnowledgeTab | null
  const activeTab: KnowledgeTab = TABS.some((t) => t.key === tabParam) ? tabParam! : 'documents'

  // 자주 묻는 질문 → 운영자 노트 추가 크로스탭 흐름 상태
  const [addNoteFromQuestion, setAddNoteFromQuestion] = useState<string | undefined>()

  // 슬라이딩 탭 인디케이터
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === activeTab)
    const btn = tabRefs.current[idx]
    if (!btn) return
    const { offsetLeft: left, offsetWidth: width } = btn
    setIndicator((prev) => ({ left, width, ready: prev.ready }))
    if (!indicator.ready) {
      requestAnimationFrame(() => setIndicator({ left, width, ready: true }))
    }
  }, [activeTab, indicator.ready])

  const setTab = (tab: KnowledgeTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    setSearchParams(params, { replace: true })
  }

  const handleAddNoteFromFrequent = (question?: string) => {
    setAddNoteFromQuestion(question)
    setTab('notes')
  }

  const handleNoteModalClosed = () => {
    setAddNoteFromQuestion(undefined)
  }

  return (
    <div>
      <PageHeader
        title="지식 관리"
        description="운영자 노트, 문서, 동기화 소스를 관리하고 챗봇 RAG 품질을 개선합니다"
      />

      {/* 탭 내비게이션 */}
      <div className="relative mb-4 w-fit max-w-full">
        <div
          role="tablist"
          aria-label="지식 관리 탭"
          className="bg-bg-base shadow-neu-pressed relative flex w-fit max-w-full gap-1 overflow-x-auto rounded-sm p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <span
            aria-hidden="true"
            className="shadow-neu-flat bg-accent pointer-events-none absolute rounded-sm"
            style={{
              top: 4,
              bottom: 4,
              left: indicator.left,
              width: indicator.width,
              opacity: indicator.ready ? 1 : 0,
              transition: indicator.ready
                ? 'left 0.22s cubic-bezier(0.25, 1, 0.5, 1), width 0.22s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.12s ease'
                : 'none',
            }}
          />
          {TABS.map((tab, i) => (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              type="button"
              onClick={() => setTab(tab.key)}
              className={cn(
                'relative z-10 flex items-center gap-2 rounded-sm px-4 py-3 text-sm font-medium whitespace-nowrap',
                'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
                'transition-colors duration-150',
                activeTab === tab.key
                  ? 'text-accent-contrast font-semibold'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8"
          style={{ background: 'linear-gradient(to left, var(--color-bg-base), transparent)' }}
        />
      </div>

      {/* 탭 컨텐츠 */}
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'documents' && <DocumentUploadTab />}
        {activeTab === 'guides' && <GuidesTab />}
        {activeTab === 'sync' && <SyncStatusTab />}
        {activeTab === 'frequent' && <FrequentQuestionsTab onAddNote={handleAddNoteFromFrequent} />}
        {activeTab === 'notes' && (
          <OperatorNotesTab
            openCreateModal={!!addNoteFromQuestion}
            prefillQuestion={addNoteFromQuestion}
            onModalClosed={handleNoteModalClosed}
          />
        )}
        {activeTab === 'feedback' && <FeedbackTab />}
        {activeTab === 'verify' && <SearchVerifyTab />}
      </div>
    </div>
  )
}
