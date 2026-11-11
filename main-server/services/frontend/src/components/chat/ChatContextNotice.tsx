interface ChatContextNoticeProps {
  onNewChat: () => void
  onContinue: () => void
}

/** 같은 날 대화를 다른 화면에서 열었을 때 메시지 목록 위에 보이는 한 줄 안내 (모달 아님, 자동 전환 없음).
 *  sticky — 목록이 맨 아래로 스크롤돼 있어도 보이도록 스크롤 영역 상단에 고정 */
export function ChatContextNotice({ onNewChat, onContinue }: ChatContextNoticeProps) {
  return (
    <div
      role="status"
      className="border-border bg-surface text-text-secondary sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border px-3 py-1.5 text-xs"
    >
      <span className="min-w-0 flex-1">다른 화면에서 열었어요. 새 대화로 시작할까요?</span>
      <button
        type="button"
        onClick={onNewChat}
        className="text-text-primary hover:text-accent focus:ring-accent rounded-sm px-1.5 py-0.5 font-medium underline underline-offset-2 focus:ring-1 focus:outline-none"
      >
        새 대화
      </button>
      <button
        type="button"
        onClick={onContinue}
        className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm px-1.5 py-0.5 focus:ring-1 focus:outline-none"
      >
        계속
      </button>
    </div>
  )
}
