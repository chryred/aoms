import { useState, useEffect } from 'react'
import { Download, Shield, Info } from 'lucide-react'
import { sslApi } from '@/api/ssl'
import type { RootCaInfo } from '@/types/ssl'

type OsTab = 'windows' | 'macos' | 'linux' | 'ios' | 'android'

const OS_TABS: { key: OsTab; label: string }[] = [
  { key: 'windows', label: 'Windows' },
  { key: 'macos', label: 'macOS' },
  { key: 'linux', label: 'Linux' },
  { key: 'ios', label: 'iOS' },
  { key: 'android', label: 'Android' },
]

function detectOs(): OsTab {
  const ua = navigator.userAgent
  if (/iPhone|iPad/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Mac/i.test(ua)) return 'macos'
  if (/Linux/i.test(ua)) return 'linux'
  return 'windows'
}

const STEPS: Record<OsTab, { title: string; steps: string[]; code?: string }> = {
  windows: {
    title: 'Windows 인증서 설치',
    steps: [
      '아래 "Root CA 다운로드" 버튼을 클릭하여 shinsegae-root-ca.crt 파일을 저장합니다.',
      '다운로드된 .crt 파일을 더블클릭합니다.',
      '"인증서 설치(I)..." 버튼을 클릭합니다.',
      '"로컬 컴퓨터(L)" 를 선택하고 다음을 클릭합니다.',
      '"모든 인증서를 다음 저장소에 저장(P)" 을 선택하고 찾아보기를 클릭합니다.',
      '"신뢰할 수 있는 루트 인증 기관" 을 선택하고 확인합니다.',
      '다음 → 마침을 클릭한 후 브라우저를 재시작합니다.',
    ],
  },
  macos: {
    title: 'macOS 인증서 설치',
    steps: [
      '아래 "Root CA 다운로드" 버튼을 클릭하여 파일을 저장합니다.',
      '다운로드된 .crt 파일을 더블클릭합니다. 키체인 접근이 열립니다.',
      '"시스템" 키체인을 선택하고 "추가" 버튼을 클릭합니다.',
      '키체인에서 추가된 인증서를 더블클릭하여 상세 창을 엽니다.',
      '"신뢰" 섹션을 펼치고 "이 인증서 사용 시" 를 "항상 신뢰" 로 변경합니다.',
      '창을 닫으면 관리자 비밀번호 입력 팝업이 표시됩니다. 비밀번호를 입력합니다.',
      '브라우저를 완전히 종료 후 재시작합니다.',
    ],
  },
  linux: {
    title: 'Linux 인증서 설치',
    steps: [
      '아래 "Root CA 다운로드" 버튼을 클릭하여 파일을 저장합니다.',
      '아래 명령어를 터미널에서 실행합니다.',
      '브라우저 또는 curl 명령어로 설치 여부를 확인합니다.',
    ],
    code: `# Debian / Ubuntu
sudo cp shinsegae-root-ca.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates

# RHEL / CentOS / Rocky Linux
sudo cp shinsegae-root-ca.crt /etc/pki/ca-trust/source/anchors/
sudo update-ca-trust extract

# 설치 확인
openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt shinsegae-root-ca.crt`,
  },
  ios: {
    title: 'iOS 인증서 설치',
    steps: [
      'Safari 브라우저에서 아래 "Root CA 다운로드" 버튼을 탭합니다.',
      '팝업에서 "허용" 을 탭하면 프로필이 다운로드됩니다.',
      '설정 앱 상단의 "프로필이 다운로드됨" 배너를 탭합니다.',
      '"설치" 를 탭하고 기기 암호를 입력합니다.',
      '경고 화면에서 "설치" 를 탭하여 확인합니다.',
      '설정 → 일반 → 정보 → 인증서 신뢰 설정으로 이동합니다.',
      '해당 인증서 옆 스위치를 활성화하고 경고 팝업에서 "계속" 을 탭합니다.',
    ],
  },
  android: {
    title: 'Android 인증서 설치',
    steps: [
      '아래 "Root CA 다운로드" 버튼을 탭하여 파일을 저장합니다.',
      '설정 → 보안 → 인증서 설치 (또는 "암호화 및 자격 증명") 로 이동합니다.',
      '"CA 인증서" 를 선택합니다.',
      '"어쨌든 설치" 경고에서 확인 후 다운로드된 파일을 선택합니다.',
      '설치 완료 후 설정 → 보안 → 신뢰할 수 있는 자격 증명에서 확인합니다.',
    ],
  },
}

export function RootCaGuidePage() {
  const [activeTab, setActiveTab] = useState<OsTab>(detectOs)
  const [caInfo, setCaInfo] = useState<RootCaInfo | null>(null)
  const [caInfoLoading, setCaInfoLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    sslApi
      .getRootCaInfo()
      .then(setCaInfo)
      .catch(() => null)
      .finally(() => setCaInfoLoading(false))
  }, [])

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const link = document.createElement('a')
      link.href = '/api/v1/ssl/root-ca/download'
      link.download = 'shinsegae-root-ca.crt'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      setDownloading(false)
    }
  }

  const current = STEPS[activeTab]

  return (
    <div className="bg-bg-deep text-text-primary min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <div className="bg-surface border-border shadow-neu-flat flex h-10 w-10 items-center justify-center rounded-sm border">
            <Shield className="text-accent h-5 w-5" />
          </div>
          <div>
            <h1 className="text-text-primary text-xl font-semibold">Root CA 설치 가이드</h1>
            <p className="text-text-secondary mt-0.5 text-sm">
              사내 시스템 접속 시 브라우저 인증서 경고를 해소합니다.
            </p>
          </div>
        </div>

        {/* CA Info Card */}
        {caInfo?.available && (
          <div className="bg-surface border-border shadow-neu-flat mb-6 rounded-sm border p-4">
            <div className="mb-2 flex items-center gap-2">
              <Info className="text-accent h-4 w-4 shrink-0" />
              <span className="text-text-primary text-sm font-medium">인증 기관 정보</span>
            </div>
            <dl className="space-y-1 text-xs">
              {caInfo.subject && (
                <div className="flex gap-2">
                  <dt className="text-text-disabled w-20 shrink-0">발급 기관</dt>
                  <dd className="text-text-secondary break-all">{caInfo.subject}</dd>
                </div>
              )}
              {caInfo.not_after && (
                <div className="flex gap-2">
                  <dt className="text-text-disabled w-20 shrink-0">만료일</dt>
                  <dd className="text-text-secondary">{caInfo.not_after}</dd>
                </div>
              )}
              {caInfo.fingerprint_sha256 && (
                <div className="flex gap-2">
                  <dt className="text-text-disabled w-20 shrink-0">지문(SHA256)</dt>
                  <dd className="text-text-secondary font-mono text-[11px] break-all">
                    {caInfo.fingerprint_sha256}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Download Button */}
        <div className="mb-6">
          <button
            onClick={handleDownload}
            disabled={downloading || caInfoLoading || caInfo?.available === false}
            className="bg-accent text-accent-contrast shadow-neu-flat flex items-center gap-2 rounded-sm px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloading ? '다운로드 중...' : 'Root CA 다운로드'}
          </button>
          {caInfo?.available === false && (
            <p className="text-critical mt-2 text-xs">
              Root CA 파일이 서버에 없습니다. 관리자에게 문의하세요.
            </p>
          )}
        </div>

        {/* OS Tabs */}
        <div className="bg-surface border-border shadow-neu-flat rounded-sm border">
          {/* Tab Bar */}
          <div className="border-border flex border-b">
            {OS_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-accent text-accent border-b-2'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Steps */}
          <div className="p-5">
            <h2 className="text-text-primary mb-4 text-sm font-semibold">{current.title}</h2>
            <ol className="space-y-3">
              {current.steps.map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  <span className="bg-bg-base border-border text-accent mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                    {idx + 1}
                  </span>
                  <span className="text-text-secondary text-sm leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>

            {current.code && (
              <pre className="bg-bg-deep border-border text-text-primary mt-4 overflow-x-auto rounded-sm border p-3 font-mono text-xs">
                {current.code}
              </pre>
            )}
          </div>
        </div>

        <p className="text-text-disabled mt-6 text-center text-xs">
          설치 후 문제가 지속되면 IT 운영팀에 문의하세요.
        </p>
      </div>
    </div>
  )
}
