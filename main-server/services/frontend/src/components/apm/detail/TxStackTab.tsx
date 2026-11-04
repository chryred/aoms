import { Fragment, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { buildStackGroups, frameMethod, isFrameworkMethod } from '@/lib/apm/methodStats'
import type { StackGroup } from '@/lib/apm/methodStats'
import { cn } from '@/lib/utils'
import type { StackSample } from '@/types/apm'

const SHOWN_FRAMES = 3
const BTN =
  'text-text-tertiary hover:text-text-primary hover:bg-hover-subtle focus-visible:ring-accent inline-flex min-h-[28px] items-center gap-1 rounded-sm px-2 text-xs focus-visible:ring-1 focus-visible:outline-none'

/** "pkg.Class.method(File.java:12)" → ["Class.method", "File.java:12"] */
function splitFrame(frame: string) {
  const method = frameMethod(frame)
  const parts = method.split('.')
  const short = parts.slice(-2).join('.')
  const loc = /\(([^)]*)\)/.exec(frame)?.[1] ?? ''
  return { short, loc }
}

/**
 * 단어 중간이 아니라 `.` `(` `$` 뒤에서만 줄바꿈되도록 <wbr> 을 넣는다 (복사 텍스트에는 영향 없음).
 * 전역 .font-mono 의 word-break:break-all 은 break-normal! 로 끄고, 한 토큰이 넘치면 행 안에서 가로 스크롤한다.
 */
function BreakableFrame({ text }: { text: string }) {
  const parts = text.split(/(?<=[.($])/)
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </>
  )
}

function Row({ g }: { g: StackGroup }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const head = splitFrame(g.headline)
  const shown = open ? g.frames : g.frames.slice(0, SHOWN_FRAMES)
  const hidden = g.frames.length - SHOWN_FRAMES

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(g.frames.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 클립보드 권한 없음: 무시 */
    }
  }

  return (
    <li data-testid="stack-row" className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="text-text-primary min-w-0 truncate text-sm font-semibold"
          title={g.headline}
        >
          {head.short}
        </span>
        {head.loc && <span className="text-text-tertiary text-xs">{head.loc}</span>}
        <span
          title="상위 스택 프레임 패턴으로 추정한 분류입니다 (확정 아님)"
          className="bg-muted-bg text-text-secondary rounded-sm px-1.5 py-0.5 text-xs"
        >
          {g.category} <span className="text-text-tertiary">(추정)</span>
        </span>
        <span className="font-num text-text-secondary ml-auto text-sm tabular-nums">
          약 {Math.round(g.estMs).toLocaleString()}ms ({Math.round(g.ratio)}%)
          <span className="text-text-tertiary ml-1 text-xs">추정</span>
        </span>
      </div>
      <div aria-hidden="true" className="bg-muted-bg mt-1.5 h-1.5 rounded-sm">
        <div
          data-testid="stack-bar"
          className="bg-text-tertiary h-full min-w-[2px] rounded-sm"
          style={{ width: `${g.ratio}%` }}
        />
      </div>
      <p className="text-text-secondary mt-1.5 overflow-x-auto text-xs">
        실행 중:{' '}
        <span className="font-mono break-normal!">
          <BreakableFrame text={frameMethod(g.top)} />
        </span>
        <span className="text-text-tertiary"> · 관측 {g.count}회</span>
      </p>
      <ol className="mt-1.5 space-y-0.5 font-mono text-xs break-normal!">
        {shown.map((f, i) => (
          <li
            key={i}
            className={cn(
              'overflow-x-auto',
              isFrameworkMethod(frameMethod(f)) ? 'text-text-tertiary' : 'text-text-primary',
            )}
          >
            <BreakableFrame text={f} />
          </li>
        ))}
      </ol>
      <div className="mt-1 flex gap-1">
        {hidden > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className={BTN}
          >
            {open ? '프레임 접기' : `프레임 ${hidden}개 더 보기`}
          </button>
        )}
        <button type="button" onClick={copy} className={BTN}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? '복사됨' : '스택 복사'}
        </button>
      </div>
    </li>
  )
}

interface Props {
  stacks: StackSample[]
  /** 미계측 시간(ms) = elapsed − sql − ext — 메소드 통계와 같은 기준 */
  unmeasuredMs?: number
  onOpenMethodStats?: () => void
}

/** 액티브 내역 — SQL·외부 호출로 계측되지 않은 구간에서 스레드가 어디에 머물렀는지 */
export function TxStackTab({ stacks, unmeasuredMs = 0, onOpenMethodStats }: Props) {
  const groups = buildStackGroups(stacks, unmeasuredMs)
  if (groups.length === 0)
    return (
      <p className="text-text-secondary text-sm">
        수집된 스택 샘플이 없습니다 — 샘플링 기준보다 빠르게 끝난 트랜잭션이거나 샘플링이 꺼져
        있습니다.
      </p>
    )
  const total = groups.reduce((a, g) => a + g.count, 0)
  return (
    <div>
      <p data-testid="stack-intro" className="text-text-secondary mb-2 text-sm">
        SQL·외부 호출로 계측되지 않은 구간(약{' '}
        <span className="font-num tabular-nums">{Math.round(unmeasuredMs).toLocaleString()}ms</span>
        ) 동안 스레드 스택을 <span className="font-num tabular-nums">{total.toLocaleString()}</span>
        번 찍었습니다. 많이 찍힌 위치일수록 오래 머문 곳입니다. 시간은 비율로 나눈 추정값입니다.
        {onOpenMethodStats && (
          <button type="button" onClick={onOpenMethodStats} className={cn(BTN, 'ml-1')}>
            메소드 통계에서 보기
          </button>
        )}
      </p>
      <ul className="border-border border-t">
        {groups.map((g, i) => (
          <Row key={i} g={g} />
        ))}
      </ul>
    </div>
  )
}
