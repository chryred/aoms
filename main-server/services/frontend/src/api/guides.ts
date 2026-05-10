import { adminApi, filterParams } from '@/lib/ky-client'
import type {
  Guide,
  GuideListResult,
  GuideListParams,
  GuideUpdateBody,
  GuideImage,
} from '@/types/guide'

export const guidesApi = {
  // ── 목록 조회 ────────────────────────────────────────────────
  list: (params?: GuideListParams): Promise<GuideListResult> => {
    const p: Record<string, string | number | boolean> = {}
    if (params?.search) p['search'] = params.search
    if (params?.category) p['category'] = params.category
    if (params?.limit !== undefined) p['limit'] = params.limit
    if (params?.offset !== undefined) p['offset'] = params.offset
    // system_id: null은 "공통" 필터를 의미 — 쿼리파라미터로 표현: system_id=null (문자열)
    if (params?.system_id !== undefined) {
      if (params.system_id === null) {
        p['system_id'] = 'null'
      } else {
        p['system_id'] = params.system_id
      }
    }
    if (params?.status) p['status'] = params.status
    return adminApi.get('api/v1/guides', { searchParams: filterParams(p) }).json<GuideListResult>()
  },

  // ── 단건 조회 ────────────────────────────────────────────────
  get: (id: string): Promise<Guide> => adminApi.get(`api/v1/guides/${id}`).json<Guide>(),

  // ── 생성 (multipart/form-data: 메타 + 초기 이미지) ────────────
  create: (formData: FormData): Promise<Guide> =>
    adminApi.post('api/v1/guides', { body: formData, timeout: 60_000 }).json<Guide>(),

  // ── 수정 (JSON — 메타데이터만) ─────────────────────────────────
  update: (id: string, data: GuideUpdateBody): Promise<Guide> =>
    adminApi.put(`api/v1/guides/${id}`, { json: data }).json<Guide>(),

  // ── 삭제 (soft delete) ───────────────────────────────────────
  delete: (id: string): Promise<void> =>
    adminApi.delete(`api/v1/guides/${id}`).then(() => undefined),

  // ── 게시 (draft → published + Qdrant 인덱싱) ───────────────
  publish: (
    id: string,
  ): Promise<{ id: string; title: string; status: string; updated_at: string }> =>
    adminApi.post(`api/v1/guides/${id}/publish`).json(),

  // ── 게시취소 (published → draft + Qdrant 삭제) ─────────────
  unpublish: (
    id: string,
  ): Promise<{ id: string; title: string; status: string; updated_at: string }> =>
    adminApi.post(`api/v1/guides/${id}/unpublish`).json(),

  // ── 이미지 추가 ──────────────────────────────────────────────
  uploadImage: (id: string, formData: FormData): Promise<GuideImage> =>
    adminApi
      .post(`api/v1/guides/${id}/images`, { body: formData, timeout: 60_000 })
      .json<GuideImage>(),

  // ── 이미지 삭제 ──────────────────────────────────────────────
  deleteImage: (id: string, imageId: string): Promise<void> =>
    adminApi.delete(`api/v1/guides/${id}/images/${imageId}`).then(() => undefined),
}
