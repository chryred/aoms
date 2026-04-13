import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { AlertCircle } from 'lucide-react'

interface ErrorCardProps {
  message?: string
  onRetry?: () => void
}

export function ErrorCard({ message = '데이터를 불러오지 못했습니다', onRetry }: ErrorCardProps) {
  return (
    <NeuCard className="flex flex-col items-center gap-4 py-12 text-center">
      <AlertCircle className="text-critical h-12 w-12" />
      <p className="text-text-secondary">{message}</p>
      {onRetry && (
        <NeuButton variant="ghost" onClick={onRetry}>
          다시 시도
        </NeuButton>
      )}
    </NeuCard>
  )
}
