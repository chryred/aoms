import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, Upload, RefreshCw, TrendingUp, Tag, ThumbsDown } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { DocumentUploadTab } from '@/components/knowledge/DocumentUploadTab'
import { SyncStatusTab } from '@/components/knowledge/SyncStatusTab'
import { FrequentQuestionsTab } from '@/components/knowledge/FrequentQuestionsTab'
import { OperatorNotesTab } from '@/components/knowledge/OperatorNotesTab'
import { FeedbackTab } from '@/components/knowledge/FeedbackTab'
import { cn } from '@/lib/utils'

type KnowledgeTab = 'documents' | 'sync' | 'frequent' | 'notes' | 'feedback'

const TABS: Array<{ key: KnowledgeTab; label: string; icon: React.ReactNode }> = [
  { key: 'documents', label: '문서', icon: <Upload className="h-4 w-4" /> },
  { key: 'sync', label: '동기화', icon: <RefreshCw className="h-4 w-4" /> },
  { key: 'frequent', label: '질문 분석', icon: <TrendingUp className="h-4 w-4" /> },
  { key: 'notes', label: '운영자 노트', icon: <Tag className="h-4 w-4" /> },
  { key: 'feedback', label: '피드백', icon: <ThumbsDown className="h-4 w-4" /> },
]

const isValidTab = (v: string | null): v is KnowledgeTab =>
  ['documents', 'sync', 'frequent', 'notes', 'feedback'].includes(v ?? '')

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: KnowledgeTab = isValidTab(tabParam) ? tabParam : 'documents'

  // 자주 묻는 질문 → 운영자 노트 추가 크로스탭 흐름 상태
  const [addNoteFromQuestion, setAddNoteFromQuestion] = useState<string | undefined>()

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
        action={
          <div className="flex items-center gap-1.5 rounded-sm px-2 py-1">
            <BookOpen className="text-accent h-4 w-4" aria-hidden="true" />
            <span className="text-text-secondary text-xs">Synapse-V Knowledge</span>
          </div>
        }
      />

      {/* 탭 내비게이션 */}
      <div className="border-border mb-6 border-b">
        <nav className="flex gap-0.5 overflow-x-auto" role="tablist" aria-label="지식 관리 탭">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              aria-controls={`tabpanel-${tab.key}`}
              id={`tab-${tab.key}`}
              type="button"
              onClick={() => setTab(tab.key)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
                'transition-[color,border-color] duration-150',
                'focus:ring-accent focus:ring-1 focus:outline-none',
                activeTab === tab.key
                  ? 'border-accent text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:border-border border-transparent',
              )}
            >
              <span aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* 탭 컨텐츠 */}
      <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'documents' && <DocumentUploadTab />}
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
      </div>
    </div>
  )
}
