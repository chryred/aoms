import { useState } from 'react'
import { Lock, X } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { agentsApi } from '@/api/agents'
import { useSSHSessionStore } from '@/store/sshSessionStore'

interface SSHSessionModalProps {
  defaultHost?: string
  defaultUsername?: string
  onSuccess: () => void
  onClose: () => void
}

export function SSHSessionModal({
  defaultHost = '',
  defaultUsername = '',
  onSuccess,
  onClose,
}: SSHSessionModalProps) {
  const [host, setHost] = useState(defaultHost)
  const [port, setPort] = useState(22)
  const [username, setUsername] = useState(defaultUsername)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const setSession = useSSHSessionStore((s) => s.setSession)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await agentsApi.createSession({ host, port, username, password })
      setSession(res.session_token, res.host, res.port, res.username, res.expires_in)
      onSuccess()
    } catch {
      setError('SSH 연결에 실패했습니다. 호스트·계정·포트·비밀번호를 확인하세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <NeuCard className="relative mx-4 w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#00D4FF]" />
            <h3 className="text-base font-semibold text-[#E2E8F2]">SSH 세션 등록</h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#8B97AD] hover:text-[#E2E8F2] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none rounded-sm"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-xs text-[#8B97AD]">
          계정 정보는 30분간 메모리에만 보관되며, 미사용 시 자동 삭제됩니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-[#8B97AD]">호스트 IP</label>
              <NeuInput
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.0.0.1"
                required
              />
            </div>
            <div className="w-20">
              <label className="mb-1 block text-xs text-[#8B97AD]">포트</label>
              <NeuInput
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder="22"
                min={1}
                max={65535}
                required
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">SSH 계정</label>
            <NeuInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jeus_user"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#8B97AD]">비밀번호</label>
            <NeuInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p className="rounded-sm bg-[rgba(239,68,68,0.08)] px-3 py-2 text-xs text-[#EF4444]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" loading={loading}>
              연결
            </NeuButton>
          </div>
        </form>
      </NeuCard>
    </div>
  )
}
