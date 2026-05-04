import { useEffect, useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { ImageUploadDropzone } from './ImageUploadDropzone'
import { useCreateGuide } from '@/hooks/mutations/useGuideMutations'
import { useUpdateGuide } from '@/hooks/mutations/useGuideMutations'
import { useUploadGuideImage } from '@/hooks/mutations/useGuideMutations'
import { useDeleteGuideImage } from '@/hooks/mutations/useGuideMutations'
import { useSystems } from '@/hooks/queries/useSystems'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useGuide } from '@/hooks/queries/useGuides'
import type { GuideSummary, GuideCategory, LocalImage } from '@/types/guide'

interface GuideEditModalProps {
  open: boolean
  onClose: () => void
  editTarget: GuideSummary | null
  /** 현재 로그인 사용자 역할 */
  userRole: 'admin' | 'operator'
  /** 현재 사용자가 담당하는 시스템 ID 목록 (operator 전용) */
  mySystemIds: number[]
  /** 읽기 전용 모드 — 저장 버튼 숨김, 모든 필드 비활성화 */
  readOnly?: boolean
}

const CATEGORY_LABELS: Record<GuideCategory, string> = {
  howto: 'How-to (사용 방법)',
  error: '오류 해결',
  navigation: '화면 안내',
}

export function GuideEditModal({
  open,
  onClose,
  editTarget,
  userRole,
  mySystemIds,
  readOnly = false,
}: GuideEditModalProps) {
  const isEdit = editTarget !== null
  const modalRef = useRef<HTMLDivElement>(null)

  // ── 시스템 목록 ────────────────────────────────────────────────
  const { data: allSystems = [] } = useSystems()
  useMyPrimarySystems() // eager fetch — data consumed via mySystemIds prop

  // admin은 전체 시스템, operator는 자신 담당 시스템만
  const availableSystems =
    userRole === 'admin' ? allSystems : allSystems.filter((s) => mySystemIds.includes(s.id))

  // ── 수정 시 전체 Guide 데이터 조회 (content + images 포함) ──────
  const { data: fullGuide, isLoading: isLoadingGuide } = useGuide(editTarget?.id ?? '')

  // ── 폼 상태 ────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [systemId, setSystemId] = useState<string>('') // '' = 선택 안 함, 'null' = 공통, '숫자' = 시스템 ID
  const [category, setCategory] = useState<string>('')
  const [tagInput, setTagInput] = useState('')
  const [localImages, setLocalImages] = useState<LocalImage[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Mutations ──────────────────────────────────────────────────
  const createMutation = useCreateGuide()
  const updateMutation = useUpdateGuide()
  const uploadImageMutation = useUploadGuideImage()
  const deleteImageMutation = useDeleteGuideImage()

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    uploadImageMutation.isPending ||
    deleteImageMutation.isPending

  // ── 폼 초기화 — 신규 생성 시 ──────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (!editTarget) {
      setTitle('')
      setContent('')
      setSystemId('')
      setCategory('')
      setTagInput('')
      setLocalImages([])
      setErrors({})
    }
  }, [open, editTarget])

  // ── 폼 초기화 — 수정 시 (전체 데이터 도착 후) ──────────────────
  useEffect(() => {
    if (!open || !editTarget || !fullGuide) return
    setTitle(fullGuide.title)
    setCategory(fullGuide.category ?? '')
    setTagInput(fullGuide.tags.join(', '))
    setSystemId(fullGuide.system_id === null ? 'null' : String(fullGuide.system_id ?? ''))
    setContent(fullGuide.content)
    setLocalImages(
      fullGuide.images.map((img) => ({
        id: img.id,
        previewUrl: img.url,
        alt_text: img.alt_text ?? '',
        sort_order: img.sort_order,
      })),
    )
    setErrors({})
  }, [open, editTarget, fullGuide])

  // ── Focus trap + ESC ───────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const modal = modalRef.current
    if (!modal) return
    const FOCUSABLE =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE))
    getFocusable()[0]?.focus()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const validate = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!title.trim()) errs.title = '제목을 입력해주세요.'
    if (!content.trim()) errs.content = '본문을 입력해주세요.'
    if (!systemId) errs.systemId = '시스템을 선택해주세요.'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [title, content, systemId])

  const parseTags = () =>
    tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const parsedSystemId = systemId === 'null' ? null : Number(systemId)
    const tags = parseTags()

    if (!isEdit) {
      // ── 신규 생성: multipart 단일 요청 ───────────────────────────
      const fd = new FormData()
      fd.append('title', title.trim())
      fd.append('content', content.trim())
      fd.append('system_id', systemId === 'null' ? '' : String(parsedSystemId ?? ''))
      if (category) fd.append('category', category)
      tags.forEach((t) => fd.append('tags', t))
      localImages.forEach((img, idx) => {
        if (img.file) {
          fd.append('images', img.file)
          fd.append(`alt_${idx}`, img.alt_text)
        }
      })
      createMutation.mutate(fd, {
        onSuccess: () => {
          toast.success('가이드가 등록되었습니다.')
          onClose()
        },
        onError: () => toast.error('가이드 등록에 실패했습니다.'),
      })
    } else {
      // ── 수정: JSON PUT + 이미지 추가/삭제 분리 ──────────────────
      const guideId = editTarget!.id

      // 1) 메타 수정
      try {
        await updateMutation.mutateAsync({
          id: guideId,
          data: {
            title: title.trim(),
            content: content.trim(),
            system_id: parsedSystemId,
            category: (category as GuideCategory) || null,
            tags,
          },
        })
      } catch {
        toast.error('가이드 수정에 실패했습니다.')
        return
      }

      // 2) 삭제된 이미지 처리 (기존 이미지 중 로컬에서 제거된 것)
      const originalImages = fullGuide?.images ?? []
      const localIds = new Set(localImages.filter((i) => i.id).map((i) => i.id))
      const toDelete = originalImages.filter((oi) => !localIds.has(oi.id))
      for (const img of toDelete) {
        try {
          await deleteImageMutation.mutateAsync({ guideId, imageId: img.id })
        } catch {
          toast.error(`이미지 삭제 실패: ${img.alt_text ?? img.id}`)
        }
      }

      // 3) 신규 이미지 업로드
      const newImages = localImages.filter((i) => !i.id && i.file)
      for (const img of newImages) {
        const fd = new FormData()
        fd.append('image', img.file!)
        fd.append('alt_text', img.alt_text)
        try {
          await uploadImageMutation.mutateAsync({ guideId, formData: fd })
        } catch {
          toast.error(`이미지 업로드 실패: ${img.file!.name}`)
        }
      }

      toast.success('가이드가 수정되었습니다.')
      onClose()
    }
  }

  if (!open) return null

  const drawerTitle = readOnly ? '가이드 보기' : isEdit ? '가이드 수정' : '새 가이드 등록'
  // 수정 모드에서 전체 데이터 로딩 중인지 여부
  const isDataLoading = isEdit && isLoadingGuide

  return (
    <>
      {/* Overlay */}
      <div className="bg-overlay fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={drawerTitle}
        className={cn(
          'border-border bg-bg-base fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[560px] flex-col border-l',
          'shadow-[-8px_0_32px_rgba(0,0,0,0.4)]',
        )}
      >
        {/* Header */}
        <div className="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
          <h2 className="text-text-primary text-lg font-semibold">{drawerTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isDataLoading ? (
            <div className="flex flex-col gap-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="bg-bg-deep h-10 animate-pulse rounded-sm" />
              ))}
            </div>
          ) : (
            <form id="guide-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
              {/* 시스템 선택 */}
              <div className="flex flex-col gap-1.5">
                <NeuSelect
                  id="guide-system"
                  label="시스템 *"
                  value={systemId}
                  onChange={(e) => {
                    if (readOnly) return
                    setSystemId(e.target.value)
                    if (errors.systemId) setErrors((prev) => ({ ...prev, systemId: '' }))
                  }}
                  error={errors.systemId}
                  disabled={readOnly}
                >
                  <option value="">— 선택 —</option>
                  {/* admin만 "공통(시스템 무관)" 작성 가능 */}
                  {userRole === 'admin' && <option value="null">공통 (시스템 무관)</option>}
                  {availableSystems.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.display_name}
                    </option>
                  ))}
                </NeuSelect>
              </div>

              {/* 제목 */}
              <NeuInput
                id="guide-title"
                label="제목 *"
                placeholder="가이드 제목"
                value={title}
                onChange={(e) => {
                  if (readOnly) return
                  setTitle(e.target.value)
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }))
                }}
                error={errors.title}
                disabled={readOnly}
              />

              {/* 카테고리 */}
              <NeuSelect
                id="guide-category"
                label="카테고리"
                value={category}
                onChange={(e) => {
                  if (readOnly) return
                  setCategory(e.target.value)
                }}
                disabled={readOnly}
              >
                <option value="">— 선택 안 함 —</option>
                {(Object.keys(CATEGORY_LABELS) as GuideCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </NeuSelect>

              {/* 태그 */}
              <NeuInput
                id="guide-tags"
                label="태그 (콤마로 구분)"
                placeholder="예: 알림, 예외규칙, 설정"
                value={tagInput}
                onChange={(e) => {
                  if (readOnly) return
                  setTagInput(e.target.value)
                }}
                disabled={readOnly}
              />

              {/* 본문 */}
              <NeuTextarea
                id="guide-content"
                label="본문 *"
                placeholder="가이드 내용을 마크다운 형식으로 작성하세요."
                rows={8}
                value={content}
                onChange={(e) => {
                  if (readOnly) return
                  setContent(e.target.value)
                  if (errors.content) setErrors((prev) => ({ ...prev, content: '' }))
                }}
                error={errors.content}
                disabled={readOnly}
              />

              {/* 이미지 업로드 / 보기 */}
              <ImageUploadDropzone
                images={localImages}
                onChange={readOnly ? () => undefined : setLocalImages}
                onError={(msg) => toast.error(msg)}
                disabled={readOnly}
              />
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex shrink-0 justify-end gap-2 border-t px-6 py-4">
          <NeuButton type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            {readOnly ? '닫기' : '취소'}
          </NeuButton>
          {!readOnly && (
            <NeuButton type="submit" form="guide-form" loading={isPending || isDataLoading}>
              {isEdit ? '저장' : '등록'}
            </NeuButton>
          )}
        </div>
      </div>
    </>
  )
}
