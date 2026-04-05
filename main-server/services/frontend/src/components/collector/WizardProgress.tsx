import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WizardProgressProps {
  currentStep: 1 | 2 | 3 | 4 | 5
  totalSteps?: number
  labels?: string[]
}

const DEFAULT_LABELS = ['타입 선택', '메트릭 그룹', 'Prometheus Job', '고급 설정', '확인 및 저장']

export function WizardProgress({
  currentStep,
  totalSteps = 5,
  labels = DEFAULT_LABELS,
}: WizardProgressProps) {
  return (
    <div className="mb-8 flex items-center" aria-label="마법사 진행 단계">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1
        const isDone = step < currentStep
        const isCurrent = step === currentStep

        return (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all',
                  isDone
                    ? 'bg-[#00D4FF] text-[#1E2127]'
                    : isCurrent
                      ? 'border-2 border-[#00D4FF] bg-[#1E2127] text-[#00D4FF]'
                      : 'bg-[#2B2F37] text-[#5A6478]',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isDone ? <Check className="h-4 w-4" /> : step}
              </div>
              <span
                className={cn(
                  'mt-1 text-xs whitespace-nowrap',
                  isCurrent ? 'font-medium text-[#00D4FF]' : 'text-[#8B97AD]',
                )}
              >
                {labels[i]}
              </span>
            </div>
            {/* Connector line */}
            {step < totalSteps && (
              <div
                className={cn('mx-2 mb-4 h-0.5 flex-1', isDone ? 'bg-[#00D4FF]' : 'bg-[#2B2F37]')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
