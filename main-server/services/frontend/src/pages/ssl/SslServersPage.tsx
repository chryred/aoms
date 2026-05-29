import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Wifi, ChevronLeft, X } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { useSslServers } from '@/hooks/queries/useSslServers'
import { useCreateSslServer, useDeleteSslServer } from '@/hooks/mutations/useSslDeploy'
import { useBannerVisible } from '@/hooks/useBannerVisible'
import { sslApi } from '@/api/ssl'
import { ROUTES } from '@/constants/routes'
import { formatKST, cn } from '@/lib/utils'
import type { SslServer } from '@/types/ssl'

// ── 등록 폼 스키마 ────────────────────────────────────────────────────────────
const createSchema = z
  .object({
    system_code: z.string().min(1, '필수'),
    system_name: z.string().min(1, '필수'),
    host: z.string().min(1, '필수'),
    account: z.string().min(1, '필수'),
    password: z.string().min(1, '최초 등록 시 필수'),
    ssh_port: z.coerce.number().int().min(1).max(65535).default(22),
    instance_role: z.string().optional(),
    web_type: z.enum(['webtob', 'nginx', 'apache', 'lets_encrypt_http01']),
    cert_type: z.enum(['wildcard', 'individual']).default('wildcard'),
    domain: z.string().optional(),
    config_file: z.string().optional(),
    cert_dir: z.string().optional(),
    webtob_home: z.string().optional(),
    network_zone: z.enum(['internal', 'dmz']).default('internal'),
  })
  .refine((d) => d.cert_type !== 'individual' || !!d.domain, {
    message: 'individual 선택 시 도메인 필수',
    path: ['domain'],
  })
  .refine((d) => d.web_type !== 'webtob' || !!d.webtob_home, {
    message: 'webtob 선택 시 webtob_home 필수',
    path: ['webtob_home'],
  })

type CreateForm = z.infer<typeof createSchema>

// ── 존 배지 ──────────────────────────────────────────────────────────────────
function ZoneBadge({ zone }: { zone: string }) {
  return (
    <span
      className={cn(
        'rounded-sm px-2 py-0.5 text-xs font-medium',
        zone === 'dmz' ? 'bg-warning/10 text-warning' : 'bg-accent/10 text-accent',
      )}
    >
      {zone.toUpperCase()}
    </span>
  )
}

// ── 상세 항목 표시 컴포넌트 ────────────────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-h-[32px] items-start gap-2 py-1.5">
      <dt className="text-text-disabled w-28 shrink-0 text-xs">{label}</dt>
      <dd className="text-text-primary min-w-0 text-xs break-all">{value ?? '—'}</dd>
    </div>
  )
}

// ── 서버 상세 Drawer ──────────────────────────────────────────────────────────
function ServerDetailDrawer({
  server,
  onClose,
}: {
  server: SslServer | null
  onClose: () => void
}) {
  const bannerVisible = useBannerVisible()
  const open = server !== null

  const webTypeLabel: Record<string, string> = {
    nginx: 'nginx',
    apache: 'Apache',
    webtob: 'WebtoB',
    lets_encrypt_http01: "DMZ (Let's Encrypt)",
  }

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'bg-overlay fixed inset-0 z-40 transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="서버 상세 정보"
        className={cn(
          'border-border bg-bg-base fixed right-0 bottom-0 z-50 flex w-full max-w-[400px] flex-col border-l transition-[translate,top] duration-200',
          bannerVisible ? 'top-12' : 'top-0',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* 헤더 */}
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-text-primary text-sm font-semibold">서버 상세</h2>
          <NeuButton size="sm" variant="ghost" onClick={onClose} aria-label="닫기">
            <X className="h-4 w-4" />
          </NeuButton>
        </div>

        {/* 콘텐츠 */}
        {server && (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {/* 섹션: 기본 정보 */}
            <p className="text-text-disabled mb-2 text-xs font-medium tracking-widest uppercase">
              기본 정보
            </p>
            <dl className="border-border divide-border divide-y border-y">
              <DetailRow label="시스템 코드" value={server.system_code} />
              <DetailRow label="시스템명" value={server.system_name} />
              <DetailRow label="호스트" value={server.host} />
              <DetailRow label="계정" value={server.account} />
              <DetailRow label="SSH 포트" value={server.ssh_port} />
              <DetailRow label="인스턴스 역할" value={server.instance_role} />
            </dl>

            {/* 섹션: 인증서 설정 */}
            <p className="text-text-disabled mt-5 mb-2 text-xs font-medium tracking-widest uppercase">
              인증서 설정
            </p>
            <dl className="border-border divide-border divide-y border-y">
              <DetailRow
                label="웹서버 종류"
                value={webTypeLabel[server.web_type] ?? server.web_type}
              />
              <DetailRow
                label="인증서 타입"
                value={
                  server.cert_type === 'wildcard' ? '와일드카드 (*.shinsegae.com)' : '개별 도메인'
                }
              />
              <DetailRow label="도메인" value={server.domain ?? '—'} />
              <DetailRow label="인증서 디렉터리" value={server.cert_dir} />
              <DetailRow label="설정파일 경로" value={server.config_file} />
              <DetailRow label="WEBTOB_HOME" value={server.webtob_home ?? '—'} />
            </dl>

            {/* 섹션: 네트워크 / 상태 */}
            <p className="text-text-disabled mt-5 mb-2 text-xs font-medium tracking-widest uppercase">
              네트워크 / 상태
            </p>
            <dl className="border-border divide-border divide-y border-y">
              <DetailRow label="네트워크 존" value={<ZoneBadge zone={server.network_zone} />} />
              <DetailRow
                label="상태"
                value={
                  <span
                    className={cn(
                      'rounded-sm px-2 py-0.5 text-xs font-medium',
                      server.status === 'active'
                        ? 'bg-normal/10 text-normal'
                        : 'bg-muted-bg text-text-disabled',
                    )}
                  >
                    {server.status}
                  </span>
                }
              />
              <DetailRow label="HA 그룹 ID" value={server.ha_group_id ?? '—'} />
              <DetailRow label="Serial 순서" value={server.serial_order} />
              <DetailRow label="등록일" value={formatKST(server.created_at, 'datetime')} />
              <DetailRow label="수정일" value={formatKST(server.updated_at, 'datetime')} />
            </dl>
          </div>
        )}
      </div>
    </>
  )
}

// ── 서버 목록 행 ──────────────────────────────────────────────────────────────
function ServerRow({
  server,
  onSelect,
  onDelete,
  onTestSsh,
  testingId,
}: {
  server: SslServer
  onSelect: (server: SslServer) => void
  onDelete: (id: number) => void
  onTestSsh: (id: number) => void
  testingId: number | null
}) {
  return (
    <tr
      className="border-border hover:bg-glass-bg cursor-pointer border-b transition-colors last:border-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      tabIndex={0}
      onClick={() => onSelect(server)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(server)}
    >
      <td className="px-4 py-3">
        <p className="text-text-primary font-medium">{server.host}</p>
        <p className="text-text-secondary text-xs">
          {server.system_name} {server.instance_role ? `(${server.instance_role})` : ''}
        </p>
      </td>
      <td className="px-4 py-3">
        <ZoneBadge zone={server.network_zone} />
      </td>
      <td className="px-4 py-3 text-sm">
        <span className="text-text-secondary">{server.web_type}</span>
      </td>
      <td className="px-4 py-3 text-sm">
        <span className="text-text-secondary">
          {server.cert_type === 'wildcard' ? '와일드카드' : server.domain}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <NeuButton
            size="sm"
            variant="ghost"
            onClick={() => onTestSsh(server.id)}
            disabled={testingId === server.id}
            aria-label="SSH 연결 테스트"
          >
            <Wifi className="h-4 w-4" aria-hidden="true" />
          </NeuButton>
          <NeuButton
            size="sm"
            variant="ghost"
            onClick={() => onDelete(server.id)}
            aria-label="서버 삭제"
          >
            <Trash2 className="text-critical h-4 w-4" aria-hidden="true" />
          </NeuButton>
        </div>
      </td>
    </tr>
  )
}

// ── 등록 모달 ─────────────────────────────────────────────────────────────────
function ServerFormModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { mutateAsync, isPending } = useCreateSslServer()
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({ resolver: zodResolver(createSchema) })

  const certType = watch('cert_type')
  const webType = watch('web_type')

  const onSubmit = async (data: CreateForm) => {
    await mutateAsync(data)
    reset()
    onSuccess()
    onClose()
  }

  if (!open) return null

  return (
    <div className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border-border shadow-neu-flat w-full max-w-lg rounded-sm border p-6">
        <h2 className="text-text-primary mb-4 text-base font-semibold">SSL 서버 등록</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NeuInput
              label="시스템 코드"
              autoFocus
              {...register('system_code')}
              error={errors.system_code?.message}
            />
            <NeuInput
              label="시스템명"
              {...register('system_name')}
              error={errors.system_name?.message}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NeuInput
              label="호스트 (IP 또는 도메인)"
              {...register('host')}
              error={errors.host?.message}
            />
            <NeuInput label="계정" {...register('account')} error={errors.account?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NeuInput
              label="SSH 포트"
              type="number"
              {...register('ssh_port')}
              placeholder="22"
              error={errors.ssh_port?.message}
            />
            <div />
          </div>
          <NeuInput
            label="비밀번호 (최초 1회 — authorized_keys 등록 후 삭제됨)"
            type="password"
            {...register('password')}
            error={errors.password?.message}
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-text-secondary mb-1 block text-xs">웹서버 종류</label>
              <select
                {...register('web_type')}
                className="bg-bg-base border-border text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-base w-full rounded-sm border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <option value="nginx">nginx</option>
                <option value="apache">apache</option>
                <option value="webtob">webtob</option>
                <option value="lets_encrypt_http01">{"DMZ (Let's Encrypt)"}</option>
              </select>
              {errors.web_type && (
                <p className="text-critical mt-1 text-xs">{errors.web_type.message}</p>
              )}
            </div>
            <div>
              <label className="text-text-secondary mb-1 block text-xs">인증서 타입</label>
              <select
                {...register('cert_type')}
                className="bg-bg-base border-border text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-base w-full rounded-sm border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <option value="wildcard">와일드카드 (*.shinsegae.com)</option>
                <option value="individual">개별 도메인</option>
              </select>
            </div>
          </div>
          {certType === 'individual' && (
            <NeuInput
              label="도메인 (예: crm.shinsegae.com)"
              {...register('domain')}
              error={errors.domain?.message}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <NeuInput label="인증서 디렉터리" {...register('cert_dir')} placeholder="/etc/ssl" />
            <NeuInput label="설정파일 경로" {...register('config_file')} placeholder="선택 사항" />
          </div>
          {webType === 'webtob' && (
            <NeuInput
              label="WEBTOB_HOME"
              {...register('webtob_home')}
              error={errors.webtob_home?.message}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <NeuInput
              label="인스턴스 역할"
              {...register('instance_role')}
              placeholder="선택 사항 (예: was1)"
            />
            <div>
              <label className="text-text-secondary mb-1 block text-xs">네트워크 존</label>
              <select
                {...register('network_zone')}
                className="bg-bg-base border-border text-text-primary focus-visible:ring-accent focus-visible:ring-offset-bg-base w-full rounded-sm border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <option value="internal">내부망</option>
                <option value="dmz">DMZ</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" disabled={isPending}>
              {isPending ? '등록 중…' : '등록'}
            </NeuButton>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export function SslServersPage() {
  const navigate = useNavigate()
  const [showModal, setShowModal] = useState(false)
  const [selectedServer, setSelectedServer] = useState<SslServer | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<{
    id: number
    success: boolean
    message: string
  } | null>(null)

  const { data: servers, isLoading, isError, refetch } = useSslServers()
  const { mutate: deleteServer } = useDeleteSslServer()

  const handleDelete = (id: number) => {
    if (!confirm('이 서버를 삭제하시겠습니까?')) return
    if (selectedServer?.id === id) setSelectedServer(null)
    deleteServer(id)
  }

  const handleTestSsh = async (id: number) => {
    setTestingId(id)
    setTestResult(null)
    try {
      const res = await sslApi.testSsh(id)
      setTestResult({ id, ...res })
    } catch {
      setTestResult({ id, success: false, message: 'SSH 테스트 요청 실패' })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="SSL 서버 관리"
        description="인증서 배포 대상 서버 등록 및 관리"
        action={
          <div className="flex gap-2">
            <NeuButton size="sm" variant="ghost" onClick={() => navigate(ROUTES.SSL_DASHBOARD)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              현황
            </NeuButton>
            <NeuButton size="sm" onClick={() => setShowModal(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              서버 등록
            </NeuButton>
          </div>
        }
      />

      {testResult && (
        <div
          className={cn(
            'rounded-sm border px-4 py-3 text-sm',
            testResult.success
              ? 'border-normal/40 bg-normal/10 text-normal'
              : 'border-critical/40 bg-critical/10 text-critical',
          )}
        >
          {testResult.message}
        </div>
      )}

      {isLoading && <LoadingSkeleton count={5} />}
      {isError && <ErrorCard message="서버 목록을 불러오지 못했습니다." onRetry={refetch} />}

      {servers && servers.length === 0 && (
        <div className="py-16 text-center">
          <Plus className="text-text-disabled mx-auto mb-3 h-10 w-10" />
          <p className="text-text-secondary mb-4">등록된 서버가 없습니다</p>
          <NeuButton size="sm" onClick={() => setShowModal(true)}>
            서버 등록
          </NeuButton>
        </div>
      )}

      {servers && servers.length > 0 && (
        <div className="bg-surface border-border overflow-x-auto rounded-sm border">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-border border-b">
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  호스트 / 시스템
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">존</th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  웹서버
                </th>
                <th className="text-text-secondary px-4 py-3 text-left text-xs font-medium">
                  인증서
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <ServerRow
                  key={server.id}
                  server={server}
                  onSelect={setSelectedServer}
                  onDelete={handleDelete}
                  onTestSsh={handleTestSsh}
                  testingId={testingId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ServerFormModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={() => refetch()}
      />

      <ServerDetailDrawer server={selectedServer} onClose={() => setSelectedServer(null)} />
    </div>
  )
}
