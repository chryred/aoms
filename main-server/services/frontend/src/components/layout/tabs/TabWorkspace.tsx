import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigationType, type Location } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useTabStore, type Tab } from '@/store/tabStore'
import { TabActiveContext, TabKeyContext } from './TabContext'
import { TabBar } from './TabBar'
import { normalizeTabPath, resolveTabTitle, tabDomId, tabPanelDomId } from './tabMeta'

interface Props {
  /** 주어진 location 으로 앱 라우트 트리를 렌더링한다 (<Routes location={...}>) */
  renderRoutes: (location: Location) => ReactNode
}

function TabPanel({
  tab,
  active,
  renderRoutes,
}: {
  tab: Tab
  active: boolean
  renderRoutes: Props['renderRoutes']
}) {
  const ref = useRef<HTMLElement>(null)
  const scrollTop = useRef(0)

  // display:none 이면 브라우저가 scrollTop 을 잃으므로 직접 보존/복원한다
  useLayoutEffect(() => {
    if (active && ref.current) ref.current.scrollTop = scrollTop.current
  }, [active])

  return (
    // 숨겨진 <main> 은 HTML 규칙상 허용 (보이는 main 은 항상 1개). closest('main') 사용처 호환.
    <main
      ref={ref}
      role="tabpanel"
      id={tabPanelDomId(tab.key)}
      aria-labelledby={tabDomId(tab.key)}
      hidden={!active}
      onScroll={(e) => {
        if (active) scrollTop.current = e.currentTarget.scrollTop
      }}
      className="absolute inset-0 overflow-y-auto overscroll-y-contain scroll-smooth p-4 md:p-6"
    >
      {tab.mounted && (
        <TabKeyContext.Provider value={tab.key}>
          <TabActiveContext.Provider value={active}>
            {renderRoutes(tab.location as unknown as Location)}
          </TabActiveContext.Provider>
        </TabKeyContext.Provider>
      )}
    </main>
  )
}

/**
 * MDI 탭 워크스페이스. 열린 탭마다 라우트 엘리먼트를 마운트한 채 유지(keep-alive)하고
 * 비활성 탭은 hidden 처리한다. URL 은 항상 활성 탭을 가리키며 탭 선택 = navigate.
 */
export function TabWorkspace({ renderRoutes }: Props) {
  const location = useLocation()
  const navType = useNavigationType()
  const tabs = useTabStore((s) => s.tabs)
  const activeKey = useTabStore((s) => s.activeKey)
  const notice = useTabStore((s) => s.notice)
  const syncLocation = useTabStore((s) => s.syncLocation)
  const clearNotice = useTabStore((s) => s.clearNotice)

  useLayoutEffect(() => {
    syncLocation(location, navType)
  }, [location, navType, syncLocation])

  useEffect(() => {
    if (!notice) return
    toast(notice)
    clearNotice()
  }, [notice, clearNotice])

  const currentKey = normalizeTabPath(location.pathname)
  // 탭 대상이 아닌 경로(redirect 전용·알 수 없는 경로)는 탭 없이 실제 location 으로 렌더링 → Navigate 가 동작
  const transient = resolveTabTitle(currentKey) === null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TabBar />
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TabPanel
            key={tab.key}
            tab={tab}
            active={tab.key === activeKey && !transient}
            renderRoutes={renderRoutes}
          />
        ))}
        {transient && (
          <main className="absolute inset-0 overflow-y-auto p-4 md:p-6">
            {renderRoutes(location)}
          </main>
        )}
      </div>
    </div>
  )
}
