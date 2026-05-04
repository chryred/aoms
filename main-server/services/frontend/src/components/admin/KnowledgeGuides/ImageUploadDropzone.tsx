import { useRef, useCallback } from 'react'
import { ImageIcon, X, ChevronUp, ChevronDown, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LocalImage } from '@/types/guide'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_SIZE_BYTES = 5 * 1024 * 1024 // 5MB
const MAX_IMAGES = 5

interface ImageUploadDropzoneProps {
  images: LocalImage[]
  onChange: (images: LocalImage[]) => void
  onError?: (msg: string) => void
  /** 읽기 전용 모드 — 업로드/삭제/순서변경 비활성화 */
  disabled?: boolean
}

let tempCounter = 0
function nextTempId() {
  return `tmp-${++tempCounter}`
}

export function ImageUploadDropzone({
  images,
  onChange,
  onError,
  disabled = false,
}: ImageUploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const validateAndAdd = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files)
      const remaining = MAX_IMAGES - images.length
      if (remaining <= 0) {
        onError?.(`이미지는 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`)
        return
      }
      const toAdd: LocalImage[] = []
      for (const file of arr.slice(0, remaining)) {
        if (!ALLOWED_TYPES.includes(file.type)) {
          onError?.(`지원하지 않는 파일 형식입니다. PNG, JPEG, WebP만 허용됩니다.`)
          continue
        }
        if (file.size > MAX_SIZE_BYTES) {
          onError?.(`${file.name}: 파일 크기가 5MB를 초과합니다.`)
          continue
        }
        toAdd.push({
          tempId: nextTempId(),
          file,
          previewUrl: URL.createObjectURL(file),
          alt_text: '',
          sort_order: images.length + toAdd.length,
        })
      }
      if (toAdd.length > 0) {
        onChange([...images, ...toAdd])
      }
    },
    [images, onChange, onError],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (e.dataTransfer.files) validateAndAdd(e.dataTransfer.files)
    },
    [validateAndAdd],
  )

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault()

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      validateAndAdd(e.target.files)
      // input 리셋 — 같은 파일 재선택 허용
      e.target.value = ''
    }
  }

  const removeImage = (idx: number) => {
    const next = images.filter((_, i) => i !== idx).map((img, i) => ({ ...img, sort_order: i }))
    onChange(next)
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const next = [...images]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    onChange(next.map((img, i) => ({ ...img, sort_order: i })))
  }

  const moveDown = (idx: number) => {
    if (idx === images.length - 1) return
    const next = [...images]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    onChange(next.map((img, i) => ({ ...img, sort_order: i })))
  }

  const updateAlt = (idx: number, alt: string) => {
    onChange(images.map((img, i) => (i === idx ? { ...img, alt_text: alt } : img)))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-secondary text-[0.8125rem] font-medium">
        이미지 ({images.length}/{MAX_IMAGES})
      </p>

      {/* 드롭존 — disabled 모드에서는 숨김 */}
      {!disabled && images.length < MAX_IMAGES && (
        <div
          role="button"
          tabIndex={0}
          aria-label="이미지 파일을 드래그하거나 클릭하여 업로드"
          className={cn(
            'border-border bg-bg-base shadow-neu-inset flex cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed px-4 py-6',
            'text-text-secondary hover:border-accent hover:text-accent transition-colors duration-150',
            'focus:ring-accent focus:ring-1 focus:outline-none',
          )}
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        >
          <Upload className="h-5 w-5" />
          <p className="text-sm">클릭 또는 드래그&amp;드롭 (PNG / JPEG / WebP, 최대 5MB)</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      {/* 이미지 목록 */}
      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          {images.map((img, idx) => (
            <div
              key={img.id ?? img.tempId}
              className="bg-bg-base border-border shadow-neu-flat flex items-start gap-3 rounded-sm border p-2"
            >
              {/* 미리보기 */}
              <div className="bg-bg-deep border-border h-16 w-16 shrink-0 overflow-hidden rounded-sm border">
                {img.previewUrl ? (
                  <img
                    src={img.previewUrl}
                    alt={img.alt_text || '미리보기'}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="text-text-disabled h-5 w-5" />
                  </div>
                )}
              </div>

              {/* Alt 텍스트 */}
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  placeholder="이미지 설명 (alt 텍스트, 선택)"
                  value={img.alt_text}
                  onChange={(e) => updateAlt(idx, e.target.value)}
                  readOnly={disabled}
                  className={cn(
                    'bg-bg-base border-border shadow-neu-inset text-text-primary placeholder:text-text-disabled w-full rounded-sm border px-3 py-1.5 text-sm',
                    'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:ring-offset-2 focus:outline-none',
                    disabled && 'cursor-default',
                  )}
                />
                <p className="text-text-disabled mt-1 text-xs">순서: {idx + 1}</p>
              </div>

              {/* 정렬 + 삭제 버튼 — disabled 모드에서는 숨김 */}
              {!disabled && (
                <div className="flex shrink-0 flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    aria-label="위로 이동"
                    className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-0.5 focus:ring-1 focus:outline-none disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(idx)}
                    disabled={idx === images.length - 1}
                    aria-label="아래로 이동"
                    className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-0.5 focus:ring-1 focus:outline-none disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    aria-label="이미지 삭제"
                    className="text-text-secondary hover:text-critical focus:ring-critical rounded-sm p-0.5 focus:ring-1 focus:outline-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
