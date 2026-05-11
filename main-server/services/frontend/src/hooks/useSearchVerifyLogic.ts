import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useSearchVerifyChatbot, useSearchVerifyCollections } from '@/hooks/queries/useSearchVerify'
import { useSyncJob } from '@/hooks/queries/useKnowledgeQueries'
import { useForceSync } from '@/hooks/mutations/useKnowledgeMutations'
import { qk } from '@/constants/queryKeys'
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

/** 진행 중인 단건 강제 재동기화 Job 상태 */
interface ActiveSyncJob {
  jobId: string
  pointId: string
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
  handleResync: (result: SearchVerifyResult) => void
}

export function useSearchVerifyLogic({
  mode,
  query,
  selectedSystems,
  selectedCollections,
  useReranker,
}: SearchVerifyLogicParams): SearchVerifyLogicReturn {
  const qc = useQueryClient()
  const [groups, setGroups] = useState<CollectionGroup[]>([])
  const [errors, setErrors] = useState<ToolError[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  /** POST가 완료되기 전(~300ms) 스피너 깜빡임 방지용 — 클릭 즉시 spinner */
  const [pendingPointId, setPendingPointId] = useState<string | null>(null)
  /** POST 완료 후 실제 폴링 중인 job */
  const [activeSyncJob, setActiveSyncJob] = useState<ActiveSyncJob | null>(null)

  const searchChatbot = useSearchVerifyChatbot()
  const searchCollections = useSearchVerifyCollections()
  const forceSync = useForceSync()

  // 단건 Job 폴링 — done/failed 에서 자동 중지 (useSyncJob 내부 refetchInterval 로직)
  const syncJobQuery = useSyncJob(activeSyncJob?.jobId ?? null)

  const isPending = searchChatbot.isPending || searchCollections.isPending
  const isError = searchChatbot.isError || searchCollections.isError

  const handleSearch = useCallback(() => {
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
    // searchChatbot.mutate / searchCollections.mutate are stable mutation functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query, selectedSystems, selectedCollections, useReranker])

  const handleResultsRefresh = useCallback(() => {
    if (!hasSearched || !query.trim()) return
    handleSearch()
  }, [hasSearched, query, handleSearch])

  // Job 상태 감시 — done/failed 시 토스트 + 결과 갱신 + 상태 초기화
  const syncJobStatus = syncJobQuery.data?.status
  const syncJobErrorMsg = syncJobQuery.data?.error_message
  const activeJobId = activeSyncJob?.jobId

  useEffect(() => {
    if (!activeSyncJob) return
    if (syncJobStatus === 'done') {
      toast.success('재동기화 완료')
      if (activeJobId) {
        qc.invalidateQueries({ queryKey: qk.knowledge.syncJob(activeJobId) })
      }
      handleResultsRefresh()
      setActiveSyncJob(null)
    } else if (syncJobStatus === 'failed') {
      const errMsg = syncJobErrorMsg ?? '알 수 없는 오류'
      toast.error(`재동기화 실패: ${errMsg}`)
      setActiveSyncJob(null)
    }
  }, [syncJobStatus, syncJobErrorMsg, activeJobId, activeSyncJob, handleResultsRefresh, qc])

  // resyncingIds 파생 — 소비자(ResultCard.isResyncing) API 유지
  const resyncingIds = new Set<string>(
    [pendingPointId, activeSyncJob?.pointId].filter((v): v is string => Boolean(v)),
  )

  const handleResync = useCallback(
    (result: SearchVerifyResult) => {
      const id = result.point_id
      if (!id) return

      // 단일 Job 모드 — 진행 중이면 추가 요청 차단 (버튼은 isResyncing으로 disabled)
      if (pendingPointId || activeSyncJob) return

      let source: 'jira' | 'confluence'
      let refId: string

      if (result.collection === 'knowledge_jira_issues') {
        const issueKey = (result.jira_key ?? result.issue_key) as string | undefined
        if (!issueKey) {
          toast.error('이슈 키를 찾을 수 없습니다')
          return
        }
        source = 'jira'
        refId = issueKey
      } else if (result.collection === 'knowledge_confluence_pages') {
        const pageId = (result.confluence_id ?? result.page_id) as string | undefined
        if (!pageId) {
          toast.error('페이지 ID를 찾을 수 없습니다')
          return
        }
        source = 'confluence'
        refId = pageId
      } else {
        return
      }

      // 즉시 spinner 시작 (POST 완료 전 깜빡임 방지)
      setPendingPointId(id)

      forceSync.mutate(
        { source, refId },
        {
          onSuccess: (job) => {
            if (job.duplicate) {
              toast(`이미 진행 중인 재동기화입니다 (${refId})`, { icon: 'ℹ️' })
            } else {
              toast.success(`재동기화 요청됨: ${refId}`)
            }
            // job_id 확보 후 폴링 시작
            setActiveSyncJob({ jobId: job.job_id, pointId: id })
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : '재동기화 요청 실패')
          },
          onSettled: () => {
            // POST 완료 — pendingPointId 역할 종료 (activeSyncJob이 이어받음)
            setPendingPointId(null)
          },
        },
      )
    },
    // forceSync.mutate is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingPointId, activeSyncJob],
  )

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
