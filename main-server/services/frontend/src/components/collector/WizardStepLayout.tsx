import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'

interface WizardStepLayoutProps {
  onPrev?: () => void
  onNext?: () => void
  nextDisabled?: boolean
  nextLabel?: string
  isPending?: boolean
  children: ReactNode
}

export function WizardStepLayout({
  onPrev,
  onNext,
  nextDisabled,
  nextLabel = '다음',
  isPending,
  children,
}: WizardStepLayoutProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>{children}</div>
      <div className="flex items-center justify-between">
        <div>
          {onPrev && (
            <NeuButton variant="ghost" onClick={onPrev} type="button">
              이전
            </NeuButton>
          )}
        </div>
        <div>
          {onNext && (
            <NeuButton
              type="button"
              onClick={onNext}
              disabled={nextDisabled || isPending}
              loading={isPending}
            >
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              {nextLabel}
            </NeuButton>
          )}
        </div>
      </div>
    </div>
  )
}
