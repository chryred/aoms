import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { ChartScaleContext, ZOOM_CHART_SCALE } from '@/components/apm/live/chartScale'

interface WidgetZoomProps {
  title: string
  /** 현재 범위 (예: 전체 / 시스템 / 시스템 · 인스턴스) */
  scopeLabel: string
  /** 닫힐 때 포커스를 돌려줄 요소 (확대를 연 위젯 헤더) */
  returnFocusTo: HTMLElement | null
  onClose: () => void
  children: ReactNode
  /** 차트 글자 배율 (기본 ZOOM_CHART_SCALE) */
  chartScale?: number
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 위젯 확대 오버레이(페이지 안 약 90vw x 80vh). 같은 컴포넌트·같은 라이브 데이터를 큰 크기로 그린다. */
export function WidgetZoom({
  title,
  scopeLabel,
  returnFocusTo,
  onClose,
  children,
  chartScale = ZOOM_CHART_SCALE,
}: WidgetZoomProps) {
  const tabActive = useTabActive()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // 포털은 탭 컨테이너 밖(document.body)에 그려지므로 탭이 숨겨지면 직접 닫는다
  useEffect(() => {
    if (!tabActive) closeRef.current()
  }, [tabActive])

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 차트 툴팁이 열려 있으면 Esc 는 툴팁만 닫는다(차트 레이어가 처리)
        if ((e.target as HTMLElement | null)?.closest?.('[data-chart-hover="open"]')) return
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      // 포커스 트랩: Tab/Shift+Tab 이 대화상자 밖으로 나가지 않고 순환한다
      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panel.contains(active) || (active === panel && !e.shiftKey)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      returnFocusTo?.focus()
    }
  }, [returnFocusTo])

  if (!tabActive) return null

  return createPortal(
    <div
      className="bg-overlay-heavy fixed inset-0 z-50 flex items-center justify-center"
      data-testid="widget-zoom-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 확대`}
        tabIndex={-1}
        className="bg-bg-base shadow-neu-flat border-border-alt flex h-[80vh] w-[90vw] flex-col rounded-sm border p-4 focus:outline-none"
        onDoubleClick={(e) => {
          if (
            !(e.target as HTMLElement).closest(
              'tr, a, button, select, input, textarea, [data-no-zoom]',
            )
          )
            onClose()
        }}
      >
        <div className="mb-3 flex shrink-0 items-center gap-3">
          <h3 className="text-text-primary text-base font-semibold">{title}</h3>
          <span className="text-text-secondary text-xs">{scopeLabel}</span>
          <span className="text-text-secondary ml-auto text-[10px] select-none">
            더블클릭 또는 ESC로 닫기
          </span>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary focus-visible:ring-accent rounded-sm p-1 focus-visible:ring-1 focus-visible:outline-none"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ChartScaleContext.Provider value={chartScale}>{children}</ChartScaleContext.Provider>
        </div>
      </div>
    </div>,
    document.body,
  )
}
