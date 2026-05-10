export type GuideCategory = 'howto' | 'error' | 'navigation'

export interface GuideImage {
  id: string
  guide_id: string
  file_path: string
  url: string // /api/v1/guides/static/{filename}
  alt_text: string | null
  sort_order: number
  created_at: string
}

export type GuideStatus = 'draft' | 'published'

export interface Guide {
  id: string
  system_id: number | null // null = 공통(시스템 무관)
  system_name: string | null
  title: string
  content: string
  category: GuideCategory | null
  tags: string[]
  created_by: number | null
  created_by_name: string | null
  is_active: boolean
  status: GuideStatus
  created_at: string
  updated_at: string
  images: GuideImage[]
  image_count: number
}

export interface GuideSummary {
  id: string
  system_id: number | null
  system_name: string | null
  title: string
  category: GuideCategory | null
  tags: string[]
  created_by: number | null
  created_by_name: string | null
  is_active: boolean
  status: GuideStatus
  created_at: string
  updated_at: string
  image_count: number
}

export interface GuideListResult {
  items: GuideSummary[]
  total: number
}

export interface GuideListParams {
  system_id?: number | null
  category?: GuideCategory
  search?: string
  status?: GuideStatus
  limit?: number
  offset?: number
}

export interface GuideCreateBody {
  title: string
  content: string
  system_id: number | null
  category?: GuideCategory | null
  tags?: string[]
}

export interface GuideUpdateBody {
  title?: string
  content?: string
  system_id?: number | null
  category?: GuideCategory | null
  tags?: string[]
}

/** 이미지 업로드 응답 */
export interface GuideImageUploadResult {
  image: GuideImage
}

/** 로컬 편집용 — 업로드 전 미리보기 상태 */
export interface LocalImage {
  /** 기존 이미지: id 존재. 신규 업로드: tempId 사용 */
  id?: string
  tempId?: string
  file?: File
  previewUrl: string
  alt_text: string
  sort_order: number
}
