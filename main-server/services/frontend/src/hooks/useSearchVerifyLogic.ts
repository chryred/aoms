import { useState } from 'react'
import toast from 'react-hot-toast'
import { useSearchVerifyChatbot, useSearchVerifyCollections } from '@/hooks/queries/useSearchVerify'
import { knowledgeApi } from '@/api/knowledge'
import type { SearchVerifyMode, RagCollection, SearchVerifyResult } from '@/types/knowledge-verify'

interface SearchVerifyLogicParams {
  mode: SearchVerifyMode
  query: string
  selectedSystems: number[]
  selectedCollections: RagCollection[]
  rerankerEnabled: boolean
  useReranker: boolean
}

interface SearchVerifyLogicReturn {
  results: SearchVerifyResult[]
  hasSearched: boolean
  isPending: boolean
  isError: boolean
  scoreKind: 'sim' | 'rrf'
  resyncingIds: Set<string>
  handleSearch: () => void
  handleResultsRefresh: () => void
  handleResync: (result: SearchVerifyResult) => Promise<void>
}

export function useSearchVerifyLogic({
  mode,
  query,
  selectedSystems,
  selectedCollections,
  rerankerEnabled,
  useReranker,
}: SearchVerifyLogicParams): SearchVerifyLogicReturn {
  const [results, setResults] = useState<SearchVerifyResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [resyncingIds, setResyncingIds] = useState<Set<string>>(new Set())

  const searchChatbot = useSearchVerifyChatbot()
  const searchCollections = useSearchVerifyCollections()

  const isPending = searchChatbot.isPending || searchCollections.isPending
  const isError = searchChatbot.isError || searchCollections.isError
  const scoreKind: 'sim' | 'rrf' = mode === 'chatbot' ? 'sim' : 'rrf'

  const handleSearch = () => {
    if (!query.trim()) return

    if (mode === 'chatbot') {
      searchChatbot.mutate(
        { query: query.trim(), system_ids: selectedSystems },
        {
          onSuccess: (data) => {
            setResults(data.results)
            setHasSearched(true)
          },
        },
      )
    } else {
      searchCollections.mutate(
        {
          query: query.trim(),
          system_ids: selectedSystems,
          collections: selectedCollections,
          use_reranker: rerankerEnabled && useReranker,
        },
        {
          onSuccess: (data) => {
            setResults(data.results)
            setHasSearched(true)
          },
        },
      )
    }
  }

  const handleResultsRefresh = () => {
    if (!hasSearched || !query.trim()) return
    handleSearch()
  }

  const handleResync = async (result: SearchVerifyResult) => {
    const id = result.point_id
    if (!id) return

    setResyncingIds((prev) => new Set(prev).add(id))
    try {
      if (result.collection === 'knowledge_jira_issues') {
        const issueKey = (result.jira_key ?? result.issue_key) as string | undefined
        if (!issueKey) {
          toast.error('이슈 키를 찾을 수 없습니다')
          return
        }
        await knowledgeApi.forceSyncJiraIssue(issueKey)
        toast.success(`Jira 이슈 재동기화 완료: ${issueKey}`)
      } else if (result.collection === 'knowledge_confluence_pages') {
        const pageId = (result.confluence_id ?? result.page_id) as string | undefined
        if (!pageId) {
          toast.error('페이지 ID를 찾을 수 없습니다')
          return
        }
        const res = await knowledgeApi.forceSyncConfluencePage(pageId)
        toast.success(`Confluence 페이지 재동기화 완료 (${res.synced_chunks}청크)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '재동기화 실패')
    } finally {
      setResyncingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return {
    results,
    hasSearched,
    isPending,
    isError,
    scoreKind,
    resyncingIds,
    handleSearch,
    handleResultsRefresh,
    handleResync,
  }
}
