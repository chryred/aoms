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
    <div className="flex items-center mb-8" aria-label="마법사 진행 단계">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1
        const isDone = step < currentStep
        const isCurrent = step === currentStep

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all',
                  isDone
                    ? 'bg-[#6366F1] text-white'
                    : isCurrent
                      ? 'border-2 border-[#6366F1] text-[#6366F1] bg-[#E8EBF0]'
                      : 'bg-[#C8CBD4] text-[#4A5568]'
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isDone ? <Check className="w-4 h-4" /> : step}
              </div>
              <span
                className={cn(
                  'mt-1 text-xs whitespace-nowrap',
                  isCurrent ? 'text-[#6366F1] font-medium' : 'text-[#4A5568]'
                )}
              >
                {labels[i]}
              </span>
            </div>
            {/* Connector line */}
            {step < totalSteps && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-2 mb-4',
                  isDone ? 'bg-[#6366F1]' : 'bg-[#C8CBD4]'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
