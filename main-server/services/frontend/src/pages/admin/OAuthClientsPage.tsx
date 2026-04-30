import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Copy, Check } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { oauthApi, type OAuthClientCreated } from '@/api/oauth'
import { formatKST } from '@/lib/utils'
import toast from 'react-hot-toast'

// ── 등록 폼 ──────────────────────────────────────────────────────────────

interface RegisterFormProps {
  onClose: () => void
}

function RegisterForm({ onClose }: RegisterFormProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [uriInput, setUriInput] = useState('')
  const [uris, setUris] = useState<string[]>([])
  const [created, setCreated] = useState<OAuthClientCreated | null>(null)
  const [copied, setCopied] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: oauthApi.createClient,
    onSuccess: (data) => {
      setCreated(data)
      queryClient.invalidateQueries({ queryKey: ['oauth-clients'] })
    },
    onError: () => toast.error('클라이언트 등록 중 오류가 발생했습니다'),
  })

  const addUri = () => {
    const trimmed = uriInput.trim()
    if (trimmed && !uris.includes(trimmed)) {
      setUris((prev) => [...prev, trimmed])
      setUriInput('')
    }
  }

  const removeUri = (uri: string) => setUris((prev) => prev.filter((u) => u !== uri))

  const copySecret = (secret: string) => {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (created) {
    return (
      <div className="space-y-4">
        <div className="border-warning/30 bg-warning/5 rounded-sm border p-4 text-sm">
          <p className="text-warning font-medium">⚠ client_secret은 지금만 확인할 수 있습니다</p>
          <p className="text-text-secondary mt-1 text-xs">
            반드시 지금 저장하세요. 이후에는 재확인이 불가능합니다.
          </p>
        </div>

        <div className="space-y-2 text-sm">
          <div className="border-border bg-bg-base flex items-center justify-between rounded-sm border px-3 py-2">
            <span className="text-text-secondary text-xs">client_id</span>
            <span className="text-text-primary font-mono text-xs">{created.client_id}</span>
          </div>
          <div className="border-border bg-bg-base flex items-center justify-between rounded-sm border px-3 py-2">
            <span className="text-text-secondary text-xs">client_secret</span>
            <div className="flex items-center gap-2">
              <span className="text-text-primary font-mono text-xs">{created.client_secret}</span>
              <button
                type="button"
                onClick={() => copySecret(created.client_secret)}
                className="text-text-secondary hover:text-accent"
              >
                {copied ? (
                  <Check className="text-normal h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        <NeuButton className="w-full" onClick={onClose}>
          닫기
        </NeuButton>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <NeuInput
        id="name"
        label="시스템 이름"
        placeholder="예: 인사관리 시스템"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="space-y-2">
        <label className="text-text-secondary block text-xs font-medium">Redirect URI</label>
        <div className="flex gap-2">
          <NeuInput
            id="uri"
            placeholder="예: http://other-system/callback"
            value={uriInput}
            onChange={(e) => setUriInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUri())}
            className="flex-1"
          />
          <NeuButton type="button" onClick={addUri} className="shrink-0 px-3">
            추가
          </NeuButton>
        </div>
        {uris.length > 0 && (
          <ul className="space-y-1">
            {uris.map((uri) => (
              <li
                key={uri}
                className="border-border bg-bg-base flex items-center justify-between rounded-sm border px-3 py-1.5 text-xs"
              >
                <span className="text-text-primary font-mono">{uri}</span>
                <button
                  type="button"
                  onClick={() => removeUri(uri)}
                  className="text-text-disabled hover:text-critical ml-2"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <NeuButton
          className="flex-1"
          disabled={!name.trim() || uris.length === 0 || isPending}
          onClick={() => mutate({ name: name.trim(), redirect_uris: uris })}
        >
          {isPending ? <span className="btn-arc mx-auto block" /> : '등록'}
        </NeuButton>
        <NeuButton variant="secondary" className="flex-1" onClick={onClose}>
          취소
        </NeuButton>
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────

export function OAuthClientsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data: clients, isLoading } = useQuery({
    queryKey: ['oauth-clients'],
    queryFn: oauthApi.listClients,
  })

  const { mutate: deactivate } = useMutation({
    mutationFn: oauthApi.deactivateClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-clients'] })
      toast.success('클라이언트가 비활성화되었습니다')
    },
    onError: () => toast.error('비활성화 중 오류가 발생했습니다'),
  })

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="OAuth 클라이언트"
        description="Synapse SSO를 사용할 타시스템 클라이언트를 관리합니다"
        action={
          !showForm && (
            <NeuButton onClick={() => setShowForm(true)} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              클라이언트 등록
            </NeuButton>
          )
        }
      />

      {showForm && (
        <NeuCard className="max-w-lg">
          <h3 className="text-text-primary mb-4 text-sm font-semibold">신규 클라이언트 등록</h3>
          <RegisterForm onClose={() => setShowForm(false)} />
        </NeuCard>
      )}

      {isLoading ? (
        <LoadingSkeleton shape="table" />
      ) : !clients?.length ? (
        <NeuCard className="py-12 text-center">
          <p className="text-text-secondary text-sm">등록된 클라이언트가 없습니다</p>
        </NeuCard>
      ) : (
        <div className="border-border overflow-hidden rounded-sm border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-surface border-b">
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  시스템 이름
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  Client ID
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  Redirect URI
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  상태
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  등록일
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr
                  key={client.id}
                  className="border-border hover:bg-surface/50 border-b transition-colors last:border-0"
                >
                  <td className="text-text-primary px-4 py-3 font-medium">{client.name}</td>
                  <td className="text-text-secondary px-4 py-3 font-mono text-xs">
                    {client.client_id}
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-0.5">
                      {(client.redirect_uris ?? []).map((uri) => (
                        <div key={uri} className="text-text-secondary font-mono text-xs">
                          {uri}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        client.is_active
                          ? 'bg-normal/10 text-normal'
                          : 'bg-text-disabled/10 text-text-disabled'
                      }`}
                    >
                      {client.is_active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="text-text-secondary px-4 py-3 text-xs">
                    {formatKST(client.created_at, 'date')}
                  </td>
                  <td className="px-4 py-3">
                    {client.is_active && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`"${client.name}" 클라이언트를 비활성화하시겠습니까?`)) {
                            deactivate(client.id)
                          }
                        }}
                        className="text-text-disabled hover:text-critical transition-colors"
                        title="비활성화"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
