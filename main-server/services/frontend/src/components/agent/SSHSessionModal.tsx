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
  /** 설정 시 해당 계정으로 username을 고정(읽기 전용). 에이전트 등록 계정과 세션 계정이 일치해야 할 때 사용. */
  requiredUsername?: string
  onSuccess: () => void
  onClose: () => void
}

export function SSHSessionModal({
  defaultHost = '',
  defaultUsername = '',
  requiredUsername,
  onSuccess,
  onClose,
}: SSHSessionModalProps) {
  const [host, setHost] = useState(defaultHost)
  const [port, setPort] = useState<number | string>(22)
  const [username, setUsername] = useState(requiredUsername ?? defaultUsername)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const setSession = useSSHSessionStore((s) => s.setSession)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await agentsApi.createSession({ host, port: Number(port), username, password })
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
      <div className="bg-overlay absolute inset-0" aria-hidden="true" onClick={onClose} />
      <NeuCard className="relative mx-4 w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="text-accent h-4 w-4" />
            <h3 className="text-text-primary text-base font-semibold">SSH 세션 등록</h3>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm focus:ring-1 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-text-secondary mb-4 text-xs">
          계정 정보는 5분간 메모리에만 보관되며, 미사용 또는 새로고침시 자동 삭제됩니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-text-secondary mb-1 block text-xs">호스트 IP</label>
              <NeuInput
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.0.0.1"
                required
              />
            </div>
            <div className="w-20">
              <label className="text-text-secondary mb-1 block text-xs">포트</label>
              <NeuInput
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="22"
                min={1}
                max={65535}
                required
              />
            </div>
          </div>
          <div>
            <label className="text-text-secondary mb-1 block text-xs">
              SSH 계정
              {requiredUsername && (
                <span className="text-text-disabled ml-1">(등록 계정: {requiredUsername})</span>
              )}
            </label>
            <NeuInput
              value={username}
              onChange={(e) => !requiredUsername && setUsername(e.target.value)}
              readOnly={!!requiredUsername}
              placeholder="계정명"
              required
              className={requiredUsername ? 'cursor-default opacity-75' : undefined}
            />
          </div>
          <div>
            <label className="text-text-secondary mb-1 block text-xs">비밀번호</label>
            <NeuInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <p className="bg-critical-card-bg text-critical rounded-sm px-3 py-2 text-xs">
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
