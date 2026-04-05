import { useState, useEffect, useRef } from 'react'
import { Users, X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { useSystemContacts, useContacts } from '@/hooks/queries/useContacts'
import { useAddSystemContact } from '@/hooks/mutations/useAddSystemContact'
import { useRemoveSystemContact } from '@/hooks/mutations/useRemoveSystemContact'
import type { ContactRole, NotifyChannel, SystemContactCreate } from '@/types/contact'

interface SystemContactPanelProps {
  systemId: number
}

const ROLE_LABELS: Record<ContactRole, string> = {
  primary: '주담당',
  secondary: '부담당',
  escalation: '에스컬',
}

const ROLE_BADGE: Record<ContactRole, 'info' | 'muted' | 'warning'> = {
  primary: 'info',
  secondary: 'muted',
  escalation: 'warning',
}

function ChannelBadge({ channel }: { channel: NotifyChannel }) {
  return (
    <NeuBadge variant={channel === 'teams' ? 'info' : 'normal'}>
      {channel === 'teams' ? 'Teams' : 'Webhook'}
    </NeuBadge>
  )
}

export function SystemContactPanel({ systemId }: SystemContactPanelProps) {
  const { data: systemContacts = [], isLoading } = useSystemContacts(systemId)
  const { data: allContacts = [] } = useContacts()
  const addMutation = useAddSystemContact(systemId)
  const removeMutation = useRemoveSystemContact(systemId)

  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Focus trap + ESC for sheet
  useEffect(() => {
    if (!sheetOpen) return
    const sheet = sheetRef.current
    if (!sheet) return
    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSheetOpen(false); return }
      if (e.key !== 'Tab') return
      const focusables = getFocusable()
      const first = focusables[0]; const last = focusables[focusables.length - 1]
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last?.focus() } }
      else { if (document.activeElement === last) { e.preventDefault(); first?.focus() } }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [sheetOpen])
  const [selectedContactId, setSelectedContactId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<ContactRole>('primary')
  const [selectedChannels, setSelectedChannels] = useState<NotifyChannel[]>(['teams'])

  const connectedIds = new Set(systemContacts.map(sc => sc.contact_id))
  const availableContacts = allContacts.filter(c => !connectedIds.has(c.id))

  function toggleChannel(ch: NotifyChannel) {
    setSelectedChannels(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch]
    )
  }

  function handleAdd() {
    if (!selectedContactId) return
    const body: SystemContactCreate = {
      contact_id: Number(selectedContactId),
      role: selectedRole,
      notify_channels: selectedChannels,
    }
    addMutation.mutate(body, {
      onSuccess: () => {
        setSheetOpen(false)
        setSelectedContactId('')
        setSelectedRole('primary')
        setSelectedChannels(['teams'])
      }
    })
  }

  if (isLoading) return <div className="text-sm text-[#8B97AD]">로딩 중...</div>

  return (
    <div>
      {systemContacts.length === 0 ? (
        <EmptyState
          icon={<Users className="w-10 h-10" />}
          title="연결된 담당자가 없습니다"
          cta={{ label: '담당자 추가', onClick: () => setSheetOpen(true) }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {systemContacts.map(sc => (
            <div
              key={sc.id}
              className="flex items-center justify-between rounded-sm bg-[#1E2127] px-4 py-3
                         shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]"
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-medium text-[#E2E8F2]">{sc.contact.name}</p>
                  <p className="text-xs text-[#8B97AD]">{sc.contact.email ?? '-'}</p>
                </div>
                <NeuBadge variant={ROLE_BADGE[sc.role]}>{ROLE_LABELS[sc.role]}</NeuBadge>
                <div className="flex gap-1">
                  {sc.notify_channels.map(ch => <ChannelBadge key={ch} channel={ch} />)}
                </div>
              </div>
              <button
                onClick={() => removeMutation.mutate(sc.contact_id)}
                className="text-[#8B97AD] hover:text-[#EF4444] transition-colors"
                aria-label="연결 해제"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <NeuButton variant="glass" size="sm" className="self-start mt-2" onClick={() => setSheetOpen(true)}>
            담당자 추가
          </NeuButton>
        </div>
      )}

      {/* Sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheetOpen(false)} aria-hidden="true" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="담당자 추가"
            className="relative w-full sm:w-80 bg-[#1E2127] h-full shadow-[-8px_0_32px_rgba(0,0,0,0.4)] p-6 flex flex-col gap-4 overflow-y-auto border-l border-[#2B2F37]"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#E2E8F2]">담당자 추가</h3>
              <button
                onClick={() => setSheetOpen(false)}
                className="text-[#8B97AD] hover:text-[#E2E8F2] focus:outline-none focus:ring-1 focus:ring-[#00D4FF] rounded-sm p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <NeuSelect
              label="담당자 선택"
              value={selectedContactId}
              onChange={e => setSelectedContactId(e.target.value)}
            >
              <option value="">-- 선택 --</option>
              {availableContacts.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.email ?? c.teams_upn ?? '-'})</option>
              ))}
            </NeuSelect>

            <NeuSelect
              label="역할"
              value={selectedRole}
              onChange={e => setSelectedRole(e.target.value as ContactRole)}
            >
              <option value="primary">주담당</option>
              <option value="secondary">부담당</option>
              <option value="escalation">에스컬레이션</option>
            </NeuSelect>

            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-[#E2E8F2]">알림 채널</p>
              <div className="flex gap-3">
                {(['teams', 'webhook'] as NotifyChannel[]).map(ch => (
                  <label key={ch} className="flex items-center gap-2 text-sm text-[#8B97AD] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedChannels.includes(ch)}
                      onChange={() => toggleChannel(ch)}
                      className="rounded accent-[#00D4FF]"
                    />
                    {ch === 'teams' ? 'Teams' : 'Webhook'}
                  </label>
                ))}
              </div>
            </div>

            <NeuButton
              onClick={handleAdd}
              loading={addMutation.isPending}
              disabled={!selectedContactId}
              className="mt-auto"
            >
              연결
            </NeuButton>
          </div>
        </div>
      )}
    </div>
  )
}
