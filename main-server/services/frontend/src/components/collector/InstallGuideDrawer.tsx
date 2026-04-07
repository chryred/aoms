import { useState } from 'react'
import { X, Copy, Check, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useInstallGuide } from '@/hooks/queries/useInstallGuide'
import { useCollectorStatus } from '@/hooks/queries/useCollectorStatus'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/constants/queryKeys'
import type { RequiredFile } from '@/types/collectorConfig'

interface InstallGuideDrawerProps {
  configId: number
  onClose: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-[#8B97AD] hover:bg-[rgba(0,212,255,0.06)] hover:text-[#00D4FF] focus:outline-none"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[#22C55E]" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? '복사됨' : '복사'}
    </button>
  )
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="mt-2">
      {label && <p className="mb-1.5 text-xs font-medium text-[#8B97AD]">{label}</p>}
      <div className="relative rounded-sm border border-[#2B2F37] bg-[#13151A]">
        <div className="absolute top-2 right-2">
          <CopyButton text={code} />
        </div>
        <pre className="overflow-x-auto p-3 pr-20 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[#E2E8F2]">
          {code}
        </pre>
      </div>
    </div>
  )
}

function RequiredFileRow({ file }: { file: RequiredFile }) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const option = file.download_options[selectedIdx]

  return (
    <div className="rounded-sm border border-[#2B2F37] bg-[#13151A] p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[#E2E8F2]">{file.description}</p>
          <p className="mt-0.5 font-mono text-xs text-[#8B97AD]">{option.filename}</p>
          {option.note && <p className="mt-0.5 text-xs text-[#F59E0B]">{option.note}</p>}
        </div>
        {file.download_options.length > 1 && (
          <select
            value={selectedIdx}
            onChange={(e) => setSelectedIdx(Number(e.target.value))}
            className="rounded-sm border border-[#2B2F37] bg-[#1E2127] px-2 py-1 text-xs text-[#E2E8F2] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none"
          >
            {file.download_options.map((opt, i) => (
              <option key={i} value={i}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <a
        href={option.download_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-sm border border-[rgba(0,212,255,0.2)] bg-[rgba(0,212,255,0.06)] px-3 py-1.5 text-xs text-[#00D4FF] hover:bg-[rgba(0,212,255,0.12)] focus:outline-none"
      >
        <Download className="h-3.5 w-3.5" />
        다운로드
        <ExternalLink className="h-3 w-3 opacity-60" />
      </a>
    </div>
  )
}

function StatusBadge({ status }: { status: 'up' | 'down' | 'unknown' }) {
  const map = {
    up: { color: 'text-[#22C55E]', dot: 'bg-[#22C55E]', label: '정상 수집 중' },
    down: { color: 'text-[#EF4444]', dot: 'bg-[#EF4444]', label: '수집 중단' },
    unknown: { color: 'text-[#8B97AD]', dot: 'bg-[#8B97AD]', label: '확인 불가' },
  }
  const s = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.color}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export function InstallGuideDrawer({ configId, onClose }: InstallGuideDrawerProps) {
  const { data: guide, isLoading } = useInstallGuide(configId)
  const [statusEnabled, setStatusEnabled] = useState(false)
  const { data: statusData, isFetching: statusFetching } = useCollectorStatus(
    configId,
    statusEnabled,
  )
  const qc = useQueryClient()

  function handleCheckStatus() {
    setStatusEnabled(true)
    qc.invalidateQueries({ queryKey: qk.collectorStatus(configId) })
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[#2B2F37] bg-[#1E2127] shadow-[-4px_0_24px_rgba(0,0,0,0.4)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2B2F37] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#E2E8F2]">수집기 설치 가이드</h2>
            {guide && (
              <p className="mt-0.5 text-sm text-[#8B97AD]">
                {guide.collector_type} · {guide.system_name} ({guide.host})
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-[#8B97AD] hover:text-[#E2E8F2] focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-sm text-[#8B97AD]">
              로딩 중…
            </div>
          )}

          {guide && (
            <div className="flex flex-col gap-8">
              {/* 섹션 1: 사전 준비 */}
              <section>
                <h3 className="mb-1 text-sm font-semibold text-[#E2E8F2]">
                  1단계 · 바이너리 다운로드
                </h3>
                <p className="mb-3 text-xs text-[#8B97AD]">
                  인터넷이 되는 PC에서 아래 파일을 다운로드한 뒤,{' '}
                  <code className="rounded bg-[#13151A] px-1 py-0.5 text-[#00D4FF]">
                    install-agents.sh
                  </code>
                  와 같은 디렉토리에 위치시키세요.
                </p>
                {/* install-agents.sh 다운로드 */}
                <div className="mb-3 rounded-sm border border-[#2B2F37] bg-[#13151A] p-3">
                  <p className="mb-2 text-sm font-medium text-[#E2E8F2]">설치 스크립트</p>
                  <a
                    href="/api/v1/collector-config/install-script"
                    download="install-agents.sh"
                    className="inline-flex items-center gap-1.5 rounded-sm border border-[rgba(0,212,255,0.2)] bg-[rgba(0,212,255,0.06)] px-3 py-1.5 text-xs text-[#00D4FF] hover:bg-[rgba(0,212,255,0.12)] focus:outline-none"
                  >
                    <Download className="h-3.5 w-3.5" />
                    install-agents.sh
                  </a>
                </div>
                {/* 필요 바이너리 목록 */}
                {guide.required_files.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {guide.required_files.map((file) => (
                      <RequiredFileRow key={file.filename} file={file} />
                    ))}
                  </div>
                )}
              </section>

              {/* 섹션 2: 설치 명령어 */}
              <section>
                <h3 className="mb-1 text-sm font-semibold text-[#E2E8F2]">
                  2단계 · 설치 명령어 실행
                </h3>
                <p className="mb-2 text-xs text-[#8B97AD]">
                  대상 서버에서 아래 명령어를 실행하세요.
                </p>
                <CodeBlock code={guide.install_command} />
                {guide.jvm_args && (
                  <div className="mt-4">
                    <p className="mb-1 text-xs font-medium text-[#F59E0B]">
                      JVM 옵션 추가 (JEUS 시작 스크립트에 포함)
                    </p>
                    <CodeBlock code={guide.jvm_args} />
                  </div>
                )}
              </section>

              {/* 섹션 3: Prometheus 설정 */}
              <section>
                <h3 className="mb-1 text-sm font-semibold text-[#E2E8F2]">
                  3단계 · Prometheus 설정
                </h3>
                <p className="mb-2 text-xs text-[#8B97AD]">
                  HTTP SD를 사용 중이면 자동 등록됩니다. 수동 등록 시 아래 내용을{' '}
                  <code className="rounded bg-[#13151A] px-1 py-0.5 text-[#00D4FF]">
                    prometheus.yml
                  </code>{' '}
                  의{' '}
                  <code className="rounded bg-[#13151A] px-1 py-0.5 text-[#8B97AD]">
                    scrape_configs
                  </code>
                  에 추가하세요.
                </p>
                <CodeBlock code={guide.prometheus_scrape_snippet} />
              </section>
            </div>
          )}
        </div>

        {/* Footer: 동작 확인 */}
        <div className="border-t border-[#2B2F37] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {statusData && <StatusBadge status={statusData.status} />}
              {!statusData && !statusFetching && (
                <p className="text-sm text-[#5A6478]">아직 확인하지 않았습니다</p>
              )}
              {statusFetching && <p className="text-sm text-[#8B97AD]">조회 중…</p>}
            </div>
            <NeuButton type="button" onClick={handleCheckStatus} loading={statusFetching}>
              <RefreshCw className="h-4 w-4" />
              동작 확인
            </NeuButton>
          </div>
        </div>
      </div>
    </div>
  )
}
