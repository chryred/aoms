import { useState } from 'react'
import toast from 'react-hot-toast'
import { useSearchVerifyChatbot, useSearchVerifyCollections } from '@/hooks/queries/useSearchVerify'
import { knowledgeApi } from '@/api/knowledge'
import type {
  SearchVerifyMode,
  RagCollection,
  SearchVerifyResult,
  CollectionGroup,
  ToolError,
} from '@/types/knowledge-verify'

interface SearchVerifyLogicParams {
  mode: SearchVerifyMode
  query: string
  selectedSystems: number[]
  selectedCollections: RagCollection[]
  useReranker: boolean
}

interface SearchVerifyLogicReturn {
  groups: CollectionGroup[]
  errors: ToolError[]
  hasSearched: boolean
  isPending: boolean
  isError: boolean
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
  useReranker,
}: SearchVerifyLogicParams): SearchVerifyLogicReturn {
  const [groups, setGroups] = useState<CollectionGroup[]>([])
  const [errors, setErrors] = useState<ToolError[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [resyncingIds, setResyncingIds] = useState<Set<string>>(new Set())

  const searchChatbot = useSearchVerifyChatbot()
  const searchCollections = useSearchVerifyCollections()

  const isPending = searchChatbot.isPending || searchCollections.isPending
  const isError = searchChatbot.isError || searchCollections.isError

  const handleSearch = () => {
    if (!query.trim()) return

    if (mode === 'chatbot') {
      searchChatbot.mutate(
        { query: query.trim(), system_ids: selectedSystems },
        {
          onSuccess: (data) => {
            setGroups(data.groups ?? [])
            setErrors(data.errors ?? [])
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
          use_reranker: useReranker,
        },
        {
          onSuccess: (data) => {
            setGroups(data.groups ?? [])
            setErrors(data.errors ?? [])
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
    groups,
    errors,
    hasSearched,
    isPending,
    isError,
    resyncingIds,
    handleSearch,
    handleResultsRefresh,
    handleResync,
  }
}
