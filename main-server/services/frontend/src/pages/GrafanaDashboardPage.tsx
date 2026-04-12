import { useState } from 'react'
import { PageHeader } from '@/components/common/PageHeader'
import { cn } from '@/lib/utils'

const DASHBOARDS = [
  { uid: 'system-overview', label: '시스템 종합' },
  { uid: 'host-resources', label: '호스트 리소스' },
  { uid: 'log-errors', label: '로그 에러' },
  { uid: 'database', label: '데이터베이스' },
] as const

export function GrafanaDashboardPage() {
  const [activeUid, setActiveUid] = useState<string>(DASHBOARDS[0].uid)

  const iframeSrc = `/grafana/d/${activeUid}?orgId=1&kiosk`

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <PageHeader title="Grafana 대시보드" />

      {/* 탭 */}
      <div className="flex gap-1 rounded-sm p-1.5 shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]">
        {DASHBOARDS.map((d) => (
          <button
            key={d.uid}
            type="button"
            onClick={() => setActiveUid(d.uid)}
            className={cn(
              'rounded-sm px-4 py-2 text-sm font-medium transition-all duration-150',
              'focus:ring-1 focus:ring-[#00D4FF] focus:outline-none',
              activeUid === d.uid
                ? 'bg-[#252932] text-white shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37]'
                : 'text-[#8B97AD] hover:text-[#E2E8F2] hover:ring-1 hover:ring-[#00D4FF4D]',
            )}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* iframe */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-sm shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
        <iframe
          key={activeUid}
          src={iframeSrc}
          title={`Grafana - ${DASHBOARDS.find((d) => d.uid === activeUid)?.label}`}
          className="h-full w-full border-0"
          sandbox="allow-same-origin allow-scripts allow-popups"
        />
      </div>
    </div>
  )
}
