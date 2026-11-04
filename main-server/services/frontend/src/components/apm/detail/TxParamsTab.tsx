import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import type { TxParams } from '@/types/apm'

const MASK = '****'

export function TxParamsTab({ params }: { params: TxParams | null | undefined }) {
  const [copied, setCopied] = useState(false)
  if (!params)
    return (
      <p className="text-text-secondary text-sm">
        수집된 요청 파라미터가 없습니다. 에이전트 설정에서 &apos;요청 파라미터 수집&apos;을 켜면
        느린·에러 트랜잭션의 파라미터가 기록됩니다.
      </p>
    )

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(params.q)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 클립보드 권한 없음 */
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-text-secondary text-sm font-semibold">쿼리 스트링</h2>
          {params.q && (
            <button
              type="button"
              onClick={copy}
              aria-label="쿼리 스트링 복사"
              className="text-text-secondary hover:text-text-primary focus-visible:ring-accent inline-flex min-h-[28px] items-center gap-1 rounded-sm px-2 text-xs focus-visible:ring-1 focus-visible:outline-none"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '복사됨' : '복사'}
            </button>
          )}
        </div>
        <pre className="bg-bg-deep rounded-sm p-3 font-mono text-xs break-all whitespace-pre-wrap">
          {params.q || '-'}
        </pre>
      </section>
      <section>
        <h2 className="text-text-secondary mb-1 text-sm font-semibold">파라미터</h2>
        {params.p.length === 0 ? (
          <p className="text-text-secondary text-sm">파라미터가 없습니다</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-border text-text-secondary border-b">
                <th scope="col" className="px-2 py-1.5 font-medium">
                  이름
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  값
                </th>
              </tr>
            </thead>
            <tbody>
              {params.p.map(([k, v], i) => (
                <tr key={`${k}-${i}`} data-testid="param-row" className="border-border border-b">
                  <td className="px-2 py-1.5 font-mono break-all">{k}</td>
                  <td className="px-2 py-1.5 font-mono break-all">
                    {v === MASK ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-text-disabled">{MASK}</span>
                        <NeuBadge>마스킹됨</NeuBadge>
                      </span>
                    ) : (
                      v
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {params.t && (
          <p className="text-text-secondary mt-2 text-xs">일부 생략됨 (길이·개수 제한)</p>
        )}
      </section>
    </div>
  )
}
