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
  const [selectedContactId, setSelectedContactId] = useState<string>('')
  const [selectedRole, setSelectedRole] = useState<ContactRole>('primary')
  const [selectedChannels, setSelectedChannels] = useState<NotifyChannel[]>(['teams'])

  const connectedIds = new Set(systemContacts.map((sc) => sc.contact_id))
  const availableContacts = allContacts.filter((c) => !connectedIds.has(c.id))

  function toggleChannel(ch: NotifyChannel) {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
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
      },
    })
  }

  if (isLoading) return <div className="text-text-secondary text-sm">로딩 중...</div>

  return (
    <div>
      {systemContacts.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="연결된 담당자가 없습니다"
          cta={{ label: '담당자 추가', onClick: () => setSheetOpen(true) }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {systemContacts.map((sc) => (
            <div
              key={sc.id}
              className="bg-bg-base shadow-neu-flat flex items-center justify-between rounded-sm px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-text-primary text-sm font-medium">{sc.contact.name}</p>
                  <p className="text-text-secondary text-xs">{sc.contact.email ?? '-'}</p>
                </div>
                <NeuBadge variant={ROLE_BADGE[sc.role]}>{ROLE_LABELS[sc.role]}</NeuBadge>
                <div className="flex gap-1">
                  {sc.notify_channels.map((ch) => (
                    <ChannelBadge key={ch} channel={ch} />
                  ))}
                </div>
              </div>
              <button
                onClick={() => removeMutation.mutate(sc.contact_id)}
                className="text-text-secondary hover:text-critical transition-colors"
                aria-label="연결 해제"
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
            담당자 추가
          </NeuButton>
        </div>
      )}

      {/* Sheet */}
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
            aria-label="담당자 추가"
            className="border-border bg-bg-base relative flex h-full w-full flex-col gap-4 overflow-y-auto border-l p-6 shadow-[-8px_0_32px_rgba(0,0,0,0.4)] sm:w-80"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-text-primary text-base font-semibold">담당자 추가</h3>
              <button
                onClick={() => setSheetOpen(false)}
                className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <NeuSelect
              label="담당자 선택"
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
            >
              <option value="">-- 선택 --</option>
              {availableContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.email ?? c.teams_upn ?? '-'})
                </option>
              ))}
            </NeuSelect>

            <NeuSelect
              label="역할"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ContactRole)}
            >
              <option value="primary">주담당</option>
              <option value="secondary">부담당</option>
              <option value="escalation">에스컬레이션</option>
            </NeuSelect>

            <div className="flex flex-col gap-1.5">
              <p className="text-text-primary text-sm font-medium">알림 채널</p>
              <div className="flex gap-3">
                {(['teams', 'webhook'] as NotifyChannel[]).map((ch) => (
                  <label
                    key={ch}
                    className="text-text-secondary flex cursor-pointer items-center gap-2 text-sm"
                  >
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
