import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
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

async function downloadImage(url: string, filename: string) {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(href)
  } catch {
    window.open(url, '_blank')
  }
}

function pickFilename(img: MessageImage): string {
  if (img.name) return img.name
  try {
    const u = new URL(img.url, window.location.origin)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last && /\.[a-zA-Z0-9]{2,5}$/.test(last)) return decodeURIComponent(last)
  } catch {
    // URL 파싱 실패 시 alt 또는 기본 파일명 사용
  }
  if (img.alt) return img.alt.replace(/[^\wㄱ-힝.-]/g, '_') + '.png'
  return 'image.png'
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

  // Portal로 document.body에 렌더 — 부모의 transform/animate 영향에서 분리
  // (parent에 animate-fade-in-up-subtle 등 transform이 있으면 fixed containing block이 뷰포트가 아닌 부모 박스가 됨)
  return createPortal(
    <div
      className="bg-overlay fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label={img.alt ?? '이미지 확대'}
    >
      {/* Download button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          void downloadImage(img.url, pickFilename(img))
        }}
        className={[
          'bg-surface text-text-primary shadow-neu-flat',
          'absolute top-4 right-14 z-10 rounded-sm p-1.5',
          'hover:shadow-neu-pressed focus:ring-accent focus:ring-1 focus:outline-none',
          'transition-shadow',
        ].join(' ')}
        aria-label="다운로드"
      >
        <Download className="h-5 w-5" />
      </button>

      {/* Close button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className={[
          'bg-surface text-text-primary shadow-neu-flat',
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
    </div>,
    document.body,
  )
}
