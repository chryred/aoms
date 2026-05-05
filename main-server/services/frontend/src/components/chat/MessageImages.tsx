import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { MessageImage } from '@/types/chat'

interface MessageImagesProps {
  images: MessageImage[]
}

export function MessageImages({ images }: MessageImagesProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  if (!images || images.length === 0) return null

  return (
    <>
      <ImageGrid images={images} onOpen={setLightboxIndex} />
      {lightboxIndex !== null && (
        <Lightbox images={images} index={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  )
}

function ImageGrid({
  images,
  onOpen,
}: {
  images: MessageImage[]
  onOpen: (index: number) => void
}) {
  const isGrid = images.length >= 4

  return (
    <div className={isGrid ? 'mt-2 grid grid-cols-2 gap-1.5' : 'mt-2 flex flex-wrap gap-1.5'}>
      {images.map((img, i) => (
        <button
          key={img.url}
          type="button"
          title={img.alt ?? img.url}
          onClick={() => onOpen(i)}
          className={[
            'shadow-neu-flat overflow-hidden rounded-sm transition-shadow',
            'hover:shadow-neu-pressed focus:ring-accent focus:ring-1 focus:outline-none',
            isGrid ? 'aspect-video w-full' : 'h-24 w-36',
          ].join(' ')}
        >
          <img
            src={img.url}
            alt={img.alt ?? '가이드 이미지'}
            className="h-full w-full object-cover"
          />
        </button>
      ))}
    </div>
  )
}

function Lightbox({
  images,
  index,
  onClose,
}: {
  images: MessageImage[]
  index: number
  onClose: () => void
}) {
  const img = images[index]

  // ESC key — stopPropagation to prevent ChatPanel's ESC handler from firing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // capture: true so we intercept before ChatPanel's bubble-phase listener
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  // Body scroll lock while lightbox is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      className="bg-overlay fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label={img.alt ?? '이미지 확대'}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={[
          'bg-surface text-accent-contrast shadow-neu-flat',
          'absolute top-4 right-4 z-10 rounded-sm p-1.5',
          'hover:shadow-neu-pressed focus:ring-accent focus:ring-1 focus:outline-none',
          'transition-shadow',
        ].join(' ')}
        aria-label="닫기"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Image — stop click propagation so clicking the image doesn't close */}
      <div
        className="flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={img.url}
          alt={img.alt ?? '가이드 이미지'}
          className="shadow-neu-flat max-h-[90vh] max-w-[90vw] rounded-sm object-contain"
        />
        {img.alt && (
          <p className="text-text-primary bg-surface/80 absolute bottom-4 left-1/2 max-w-[80vw] -translate-x-1/2 rounded-sm px-3 py-1 text-center text-xs">
            {img.alt}
          </p>
        )}
      </div>
    </div>
  )
}
