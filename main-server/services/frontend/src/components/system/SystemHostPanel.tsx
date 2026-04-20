import { useState, useEffect, useRef } from 'react'
import { Server, X } from 'lucide-react'
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { systemHostsApi } from '@/api/system-hosts'
import type { SystemHostCreate } from '@/types/system'

interface SystemHostPanelProps {
  systemId: number
}

export function SystemHostPanel({ systemId }: SystemHostPanelProps) {
  const qc = useQueryClient()
  const qKey = ['systems', systemId, 'hosts']

  const { data: hosts = [], isLoading } = useQuery({
    queryKey: qKey,
    queryFn: () => systemHostsApi.getSystemHosts(systemId),
  })

  const addMutation = useMutation({
    mutationFn: (body: SystemHostCreate) => systemHostsApi.addSystemHost(systemId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qKey }),
  })

  const removeMutation = useMutation({
    mutationFn: (hostId: number) => systemHostsApi.removeSystemHost(systemId, hostId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qKey }),
  })

  const [sheetOpen, setSheetOpen] = useState(false)
  const [hostIp, setHostIp] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [ipError, setIpError] = useState('')
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sheetOpen) return
    const sheet = sheetRef.current
    if (!sheet) return
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSheetOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [sheetOpen])

  function handleAdd() {
    const trimmed = hostIp.trim()
    if (!trimmed) {
      setIpError('IP를 입력하세요.')
      return
    }
    setIpError('')
    addMutation.mutate(
      { host_ip: trimmed, role_label: roleLabel.trim() || undefined },
      {
        onSuccess: () => {
          setSheetOpen(false)
          setHostIp('')
          setRoleLabel('')
        },
        onError: () => setIpError('이미 등록된 IP이거나 저장에 실패했습니다.'),
      },
    )
  }

  if (isLoading) return <div className="text-text-secondary text-sm">로딩 중...</div>

  return (
    <div>
      {hosts.length === 0 ? (
        <EmptyState
          icon={<Server className="h-10 w-10" />}
          title="등록된 서버 IP가 없습니다"
          cta={{ label: 'IP 추가', onClick: () => setSheetOpen(true) }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {hosts.map((h) => (
            <div
              key={h.id}
              className="bg-bg-base shadow-neu-flat flex items-center justify-between rounded-sm px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="text-text-primary font-mono text-sm">{h.host_ip}</span>
                {h.role_label && <NeuBadge variant="muted">{h.role_label}</NeuBadge>}
              </div>
              <button
                onClick={() => removeMutation.mutate(h.id)}
                className="text-text-secondary hover:text-critical transition-colors"
                aria-label="IP 삭제"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <NeuButton
            variant="glass"
            size="sm"
            className="mt-2 self-start"
            onClick={() => setSheetOpen(true)}
          >
            IP 추가
          </NeuButton>
        </div>
      )}

      {sheetOpen && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div
            className="bg-overlay absolute inset-0"
            onClick={() => setSheetOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="서버 IP 추가"
            className="border-border bg-bg-base relative flex h-full w-full flex-col gap-4 overflow-y-auto border-l p-6 shadow-[-8px_0_32px_rgba(0,0,0,0.4)] sm:w-80"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-text-primary text-base font-semibold">서버 IP 추가</h3>
              <button
                onClick={() => setSheetOpen(false)}
                className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <NeuInput
              id="host_ip"
              label="서버 IP *"
              placeholder="10.0.0.1"
              value={hostIp}
              onChange={(e) => setHostIp(e.target.value)}
              error={ipError}
            />

            <NeuInput
              id="role_label"
              label="역할 구분 (선택)"
              placeholder="WAS1, DB1 등"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
            />

            <NeuButton
              onClick={handleAdd}
              loading={addMutation.isPending}
              disabled={!hostIp.trim()}
              className="mt-auto"
            >
              추가
            </NeuButton>
          </div>
        </div>
      )}
    </div>
  )
}
