import { useMutation, useQueryClient } from '@tanstack/react-query'
import { guidesApi } from '@/api/guides'
import { qk } from '@/constants/queryKeys'
import type { GuideUpdateBody } from '@/types/guide'

export function useCreateGuide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (formData: FormData) => guidesApi.create(formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
    },
  })
}

export function useUpdateGuide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: GuideUpdateBody }) => guidesApi.update(id, data),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
      qc.invalidateQueries({ queryKey: qk.guides.detail(id) })
    },
  })
}

export function useDeleteGuide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => guidesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
    },
  })
}

export function useUploadGuideImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ guideId, formData }: { guideId: string; formData: FormData }) =>
      guidesApi.uploadImage(guideId, formData),
    onSuccess: (_result, { guideId }) => {
      qc.invalidateQueries({ queryKey: qk.guides.detail(guideId) })
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
    },
  })
}

export function useDeleteGuideImage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ guideId, imageId }: { guideId: string; imageId: string }) =>
      guidesApi.deleteImage(guideId, imageId),
    onSuccess: (_result, { guideId }) => {
      qc.invalidateQueries({ queryKey: qk.guides.detail(guideId) })
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
    },
  })
}

export function usePublishGuide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => guidesApi.publish(id),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
      qc.invalidateQueries({ queryKey: qk.guides.detail(id) })
    },
  })
}

export function useUnpublishGuide() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => guidesApi.unpublish(id),
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['guides', 'list'] })
      qc.invalidateQueries({ queryKey: qk.guides.detail(id) })
    },
  })
}
