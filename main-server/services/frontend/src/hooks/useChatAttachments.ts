import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { chatApi } from '@/api/chat'

export type AttachmentStatus = 'uploading' | 'ready' | 'failed'

export interface ComposerAttachment {
  localId: string
  previewUrl: string
  name: string
  size: number
  mime: string
  status: AttachmentStatus
  key?: string
  error?: string
}

function newLocalId(): string {
  return `att-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`
}

export function useChatAttachments(sessionId: string | null) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const sessionRef = useRef<string | null>(sessionId)

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  // 컴포넌트 언마운트 시 objectURL 해제
  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const upload = useCallback(async (file: File) => {
    if (!sessionRef.current) {
      toast.error('세션이 아직 준비되지 않았습니다.')
      return
    }
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 지원됩니다.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('최대 10MB까지 업로드 가능합니다.')
      return
    }
    const localId = newLocalId()
    const previewUrl = URL.createObjectURL(file)
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        previewUrl,
        name: file.name,
        size: file.size,
        mime: file.type,
        status: 'uploading',
      },
    ])
    try {
      const resp = await chatApi.uploadAttachment(sessionRef.current, file)
      setAttachments((prev) =>
        prev.map((a) =>
          a.localId === localId
            ? { ...a, status: 'ready', key: resp.key, mime: resp.mime, size: resp.size }
            : a,
        ),
      )
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? '업로드 실패'
      setAttachments((prev) =>
        prev.map((a) => (a.localId === localId ? { ...a, status: 'failed', error: msg } : a)),
      )
      toast.error(`업로드 실패: ${msg.slice(0, 80)}`)
    }
  }, [])

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((file) => {
        void upload(file)
      })
    },
    [upload],
  )

  const remove = useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.localId !== localId)
    })
  }, [])

  const clear = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => URL.revokeObjectURL(a.previewUrl))
      return []
    })
  }, [])

  const readyKeys = attachments
    .filter((a) => a.status === 'ready' && a.key)
    .map((a) => a.key as string)

  const isUploading = attachments.some((a) => a.status === 'uploading')

  return { attachments, addFiles, remove, clear, readyKeys, isUploading }
}
