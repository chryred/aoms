# Synapse-V Frontend — Phase 3c 상세 설계 명세서

> `frontend-design-spec.md` + `phase1-design-spec.md` 기반. Phase 3c 사용자 관리 기능 구현 계약서.
> 구현 전 반드시 이 문서를 전체 숙지할 것.

---

## 0. 전제 조건 (Phase 1 완료 확인)

Phase 3c 시작 전 다음이 모두 완료되어 있어야 한다.

| 항목 | 파일 | 확인 방법 |
|---|---|---|
| `AuthLayout` 구현 완료 | `src/components/layout/AuthLayout.tsx` | `/login` 접속 시 중앙 정렬 레이아웃 확인 |
| `AuthGuard` 구현 완료 | `src/components/layout/AuthGuard.tsx` | 비인증 시 `/login` 리다이렉트 확인 |
| `AdminGuard` 구현 완료 | `src/components/layout/AdminGuard.tsx` | `role !== 'admin'` 시 `/dashboard` 리다이렉트 확인 |
| `useAuthStore` (login/logout/setToken) | `src/store/authStore.ts` | `sessionStorage['aoms-auth']` 키 존재 확인 |
| `LoginPage` (AUTH-01) 동작 | `src/pages/auth/LoginPage.tsx` | `/login` → 로그인 성공 → `/dashboard` 리다이렉트 |
| `NeuCard`, `NeuInput`, `NeuButton` | `src/components/neumorphic/` | 기존 로그인 화면에서 사용 중 |
| `adminApi` (ky 클라이언트) | `src/lib/ky-client.ts` | `Authorization: Bearer` 자동 주입 확인 |

### 백엔드 선행 구현 목록 (Phase 3c 프론트 전 필수)

현재 `routes/auth.py`에 아래 엔드포인트가 없으므로 반드시 먼저 구현해야 한다.

| # | 엔드포인트 | 파일 | 내용 |
|---|---|---|---|
| 1 | `POST /api/v1/auth/register` | `routes/auth.py` | 신규 가입 신청. `is_approved=False`, `is_active=True`로 저장. 이메일 중복 시 409 |
| 2 | `GET /api/v1/auth/users` | `routes/auth.py` | 관리자 전용. 전체 사용자 목록 반환 (`require_admin` Dependency) |
| 3 | `PATCH /api/v1/auth/users/{id}/status` | `routes/auth.py` | 관리자 전용. `is_approved` / `is_active` 변경 |
| 4 | `PATCH /api/v1/auth/users/{id}/role` | `routes/auth.py` | 관리자 전용. `role` 변경 (`admin` / `operator`) |
| 5 | `PATCH /api/v1/auth/me` | `routes/auth.py` | 인증 사용자 본인. 이름 / 비밀번호 변경 |

> `GET /api/v1/auth/me` 는 Phase 1에서 이미 구현됨 (`routes/auth.py:119`).

---

## 1. Phase 3c 범위

| ID | 경로 | 설명 | 가드 |
|---|---|---|---|
| AUTH-02 | `/register` | 사용자 등록 신청 | 없음 (비인증 접근 가능) |
| AUTH-03 | `/admin/users` | 사용자 승인 관리 | `AdminGuard` |
| PROFILE | `/profile` | 내 프로필 조회 및 수정 | `AuthGuard` |

---

## 2. 디렉토리 구조 추가분

Phase 1/2 구조에서 아래 파일/폴더를 추가한다.

```
src/
├── types/
│   └── auth.ts                          ← 기존 파일에 타입 추가 (섹션 3 참고)
├── api/
│   └── auth.ts                          ← 기존 파일에 함수 추가 (섹션 4 참고)
├── hooks/
│   ├── queries/
│   │   ├── useMe.ts                     ← 신규
│   │   └── useUsers.ts                  ← 신규 (관리자 전용)
│   └── mutations/
│       ├── useRegister.ts               ← 신규
│       ├── useUpdateUserStatus.ts       ← 신규
│       ├── useUpdateUserRole.ts         ← 신규
│       └── useUpdateMe.ts               ← 신규
├── components/
│   └── user/
│       ├── UserStatusBadge.tsx          ← 신규
│       └── ConfirmDialog.tsx            ← 신규 (승인/거부/비활성화 확인 다이얼로그)
└── pages/
    ├── auth/
    │   └── RegisterPage.tsx             ← 신규 (AUTH-02)
    ├── admin/
    │   └── UserManagementPage.tsx       ← 신규 (AUTH-03)
    └── ProfilePage.tsx                  ← 신규 (PROFILE)
```

---

## 3. TypeScript 타입 추가 (`src/types/auth.ts`)

기존 `auth.ts`에 아래 타입을 추가한다. 기존 `User`, `LoginRequest`, `LoginResponse` 타입은 그대로 유지한다.

### User 모델 기반 상태 정리

`models.py`의 `User` 테이블은 `is_active(Boolean)` + `is_approved(Boolean)` 두 컬럼으로 상태를 관리한다.
UI에서는 이를 단일 `UserStatus` 문자열로 표현한다.

| `is_active` | `is_approved` | `UserStatus` | 설명 |
|---|---|---|---|
| `true` | `false` | `'pending'` | 가입 신청 후 관리자 승인 대기 중 |
| `true` | `true` | `'active'` | 승인 완료, 로그인 가능 |
| `false` | `true` | `'disabled'` | 비활성화 (관리자 처리) |
| `false` | `false` | `'disabled'` | 비활성화 (미승인 포함) |

```typescript
// src/types/auth.ts 에 추가

export type UserStatus = 'pending' | 'active' | 'disabled'

// 관리자용 전체 사용자 정보 (GET /api/v1/auth/users 응답)
export interface UserAdminOut {
  id: number
  email: string           // 변경 불가 (회원가입 시 확정)
  name: string
  role: UserRole          // 'admin' | 'operator'
  is_active: boolean
  is_approved: boolean
  created_at: string      // ISO 8601 UTC
}

// UI용 파생 헬퍼 (백엔드 응답 → UI 상태 변환)
export function toUserStatus(user: Pick<UserAdminOut, 'is_active' | 'is_approved'>): UserStatus {
  if (!user.is_active) return 'disabled'
  if (!user.is_approved) return 'pending'
  return 'active'
}

// POST /api/v1/auth/register 요청 바디
export interface RegisterRequest {
  name: string
  email: string
  password: string
  department?: string     // 소속 (선택, 백엔드 User 모델에 컬럼 추가 필요 — 선택사항)
  system_ids?: number[]   // 담당 시스템 ID 목록 (선택)
}

// PATCH /api/v1/auth/users/{id}/status 요청 바디
export interface UserStatusUpdateRequest {
  is_approved?: boolean
  is_active?: boolean
}

// PATCH /api/v1/auth/users/{id}/role 요청 바디
export interface UserRoleUpdateRequest {
  role: UserRole
}

// PATCH /api/v1/auth/me 요청 바디
export interface UserUpdateRequest {
  name?: string
  current_password?: string   // 비밀번호 변경 시 필수
  new_password?: string
}
```

> `RegisterRequest.department` 및 `system_ids`는 현재 `User` 모델에 컬럼이 없다. 백엔드와 협의 후 추가 여부를 결정한다. 추가하지 않을 경우 `RegisterPage`에서 해당 필드를 제거하거나 로컬 노트 용도로만 수집한다.

---

## 4. API 레이어 (`src/api/auth.ts` 확장)

기존 `authApi` 객체에 아래 함수를 추가한다.

```typescript
// src/api/auth.ts 추가분
import type {
  RegisterRequest,
  UserAdminOut,
  UserStatusUpdateRequest,
  UserRoleUpdateRequest,
  UserUpdateRequest,
  User,
} from '@/types/auth'

// 기존 authApi = { login, refresh, logout, me } 에 아래 추가:

// register: POST /api/v1/auth/register — 신청 후 201 반환 (body에 user 없음)
register: (body: RegisterRequest) =>
  adminApi.post('api/v1/auth/register', { json: body }).json<{ message: string }>(),

// getUsers: GET /api/v1/auth/users — 관리자 전용
getUsers: () =>
  adminApi.get('api/v1/auth/users').json<UserAdminOut[]>(),

// updateUserStatus: PATCH /api/v1/auth/users/{id}/status — 승인/거부/비활성화
updateUserStatus: (id: number, body: UserStatusUpdateRequest) =>
  adminApi.patch(`api/v1/auth/users/${id}/status`, { json: body }).json<UserAdminOut>(),

// updateUserRole: PATCH /api/v1/auth/users/{id}/role — role 변경 (관리자 전용)
updateUserRole: (id: number, body: UserRoleUpdateRequest) =>
  adminApi.patch(`api/v1/auth/users/${id}/role`, { json: body }).json<UserAdminOut>(),

// updateMe: PATCH /api/v1/auth/me — 본인 프로필 수정
updateMe: (body: UserUpdateRequest) =>
  adminApi.patch('api/v1/auth/me', { json: body }).json<User>(),
```

---

## 5. React Query 훅

### 5.1 `src/hooks/queries/useMe.ts`

```typescript
import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { qk } from '@/constants/queryKeys'

export function useMe() {
  return useQuery({
    queryKey: qk.me(),
    queryFn: authApi.me,
    staleTime: 60_000,
  })
}
```

> `qk.me()`는 Phase 1에서 이미 정의됨 (`queryKeys.ts:me: () => ['auth', 'me'] as const`).

### 5.2 `src/hooks/queries/useUsers.ts` (관리자 전용)

```typescript
import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

export const usersQueryKey = ['auth', 'users'] as const

export function useUsers() {
  const user = useAuthStore((s) => s.user)
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: authApi.getUsers,
    staleTime: 30_000,
    enabled: user?.role === 'admin',  // 관리자만 실행
  })
}
```

### 5.3 `src/hooks/mutations/useRegister.ts`

```typescript
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import type { RegisterRequest } from '@/types/auth'

export function useRegister() {
  return useMutation({
    mutationFn: (body: RegisterRequest) => authApi.register(body),
    // onSuccess: 페이지 컴포넌트에서 성공 상태 처리
  })
}
```

### 5.4 `src/hooks/mutations/useUpdateUserStatus.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersQueryKey } from '@/hooks/queries/useUsers'
import toast from 'react-hot-toast'
import type { UserStatusUpdateRequest } from '@/types/auth'

export function useUpdateUserStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserStatusUpdateRequest }) =>
      authApi.updateUserStatus(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey })
      toast.success('사용자 상태가 변경되었습니다')
    },
    onError: () => toast.error('상태 변경에 실패했습니다'),
  })
}
```

### 5.5 `src/hooks/mutations/useUpdateUserRole.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersQueryKey } from '@/hooks/queries/useUsers'
import toast from 'react-hot-toast'
import type { UserRoleUpdateRequest } from '@/types/auth'

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserRoleUpdateRequest }) =>
      authApi.updateUserRole(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey })
      toast.success('권한이 변경되었습니다')
    },
    onError: () => toast.error('권한 변경에 실패했습니다'),
  })
}
```

### 5.6 `src/hooks/mutations/useUpdateMe.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { qk } from '@/constants/queryKeys'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import type { UserUpdateRequest } from '@/types/auth'

export function useUpdateMe() {
  const qc = useQueryClient()
  const login = useAuthStore((s) => s.login)
  const token = useAuthStore((s) => s.token)

  return useMutation({
    mutationFn: (body: UserUpdateRequest) => authApi.updateMe(body),
    onSuccess: (updatedUser) => {
      // AuthStore의 user 정보 갱신 (이름 변경 반영)
      if (token) {
        login({ access_token: token, token_type: 'bearer', user: updatedUser })
      }
      qc.invalidateQueries({ queryKey: qk.me() })
      toast.success('프로필이 업데이트되었습니다')
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } })?.response?.status
      if (status === 401) {
        toast.error('현재 비밀번호가 올바르지 않습니다')
      } else {
        toast.error('프로필 수정에 실패했습니다')
      }
    },
  })
}
```

---

## 6. AUTH-02 상세 설계 (`/register`)

### 개요

- 비인증 사용자(미로그인)가 가입을 신청하는 화면
- 기존 `LoginPage`와 동일하게 `AuthLayout` 사용
- 제출 후 `is_approved=False` 상태로 저장 → 관리자가 AUTH-03에서 승인

### 컴포넌트 트리

```
AuthLayout (Outlet)
└── RegisterPage
    └── NeuCard (max-w-lg, w-full)
        ├── Logo + "Synapse-V" 타이틀
        ├── 부제목: "사용자 등록 신청"
        ├── [성공 상태가 아닌 경우] <form> (react-hook-form + zod)
        │   ├── NeuInput — 이름 (required)
        │   ├── NeuInput — 이메일 (required, type="email")
        │   ├── NeuInput — 비밀번호 (required, type="password")
        │   ├── NeuInput — 비밀번호 확인 (required, type="password")
        │   ├── NeuButton type="submit" (w-full, loading=isPending)
        │   └── 링크: "이미 계정이 있으신가요? 로그인" → /login
        └── [성공 상태인 경우] 성공 화면
            ├── 체크 아이콘 (lucide-react CheckCircle2)
            ├── "등록 신청이 완료되었습니다"
            ├── "관리자 승인 후 로그인 가능합니다" (안내 텍스트)
            └── NeuButton "로그인 페이지로" → /login
```

### zod 스키마

```typescript
import { z } from 'zod'

const registerSchema = z.object({
  name: z.string().min(2, '이름은 2자 이상 입력하세요'),
  email: z.string().email('유효한 이메일 주소를 입력하세요'),
  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(
      /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
      '영문, 숫자, 특수문자를 모두 포함해야 합니다'
    ),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['confirmPassword'],
})

type RegisterFormData = z.infer<typeof registerSchema>
```

### 에러 처리

| HTTP 상태 | 원인 | UI 처리 |
|---|---|---|
| `409 Conflict` | 이미 가입된 이메일 | `setError('email', { message: '이미 사용 중인 이메일입니다' })` |
| `422` | 유효성 검사 실패 | zod에서 인라인 필드 에러로 처리 |
| 기타 | 서버 오류 | `toast.error('등록 신청 중 오류가 발생했습니다')` |

### 구현 코드 스켈레톤

```tsx
// src/pages/auth/RegisterPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2 } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useRegister } from '@/hooks/mutations/useRegister'
import toast from 'react-hot-toast'

export function RegisterPage() {
  const navigate = useNavigate()
  const [isSuccess, setIsSuccess] = useState(false)

  const { register, handleSubmit, formState: { errors }, setError } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  const { mutate, isPending } = useRegister()

  const onSubmit = (data: RegisterFormData) => {
    mutate(
      { name: data.name, email: data.email, password: data.password },
      {
        onSuccess: () => setIsSuccess(true),
        onError: (err: unknown) => {
          const status = (err as { response?: { status: number } })?.response?.status
          if (status === 409) {
            setError('email', { message: '이미 사용 중인 이메일입니다' })
          } else {
            toast.error('등록 신청 중 오류가 발생했습니다')
          }
        },
      }
    )
  }

  if (isSuccess) {
    return (
      <NeuCard className="w-full max-w-md text-center">
        <CheckCircle2 className="w-16 h-16 text-[#16A34A] mx-auto mb-4" />
        <h2 className="text-xl font-bold text-[#1A1F2E] mb-2">등록 신청이 완료되었습니다</h2>
        <p className="text-sm text-[#4A5568] mb-6">관리자 승인 후 로그인 가능합니다</p>
        <NeuButton className="w-full" onClick={() => navigate('/login')}>
          로그인 페이지로
        </NeuButton>
      </NeuCard>
    )
  }

  return (
    <NeuCard className="w-full max-w-md">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-[#1A1F2E]">Synapse-V</h1>
        <p className="mt-1 text-sm text-[#4A5568]">사용자 등록 신청</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <NeuInput id="name" label="이름" placeholder="홍길동" error={errors.name?.message} {...register('name')} />
        <NeuInput id="email" type="email" label="이메일" placeholder="user@company.com" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <NeuInput id="password" type="password" label="비밀번호" placeholder="영문+숫자+특수문자 8자 이상" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        <NeuInput id="confirmPassword" type="password" label="비밀번호 확인" placeholder="비밀번호 재입력" error={errors.confirmPassword?.message} {...register('confirmPassword')} />

        <NeuButton type="submit" className="w-full mt-6" loading={isPending}>
          등록 신청
        </NeuButton>
      </form>

      <p className="mt-4 text-center text-sm text-[#4A5568]">
        이미 계정이 있으신가요?{' '}
        <button
          type="button"
          onClick={() => navigate('/login')}
          className="text-[#6366F1] hover:underline font-medium"
        >
          로그인
        </button>
      </p>
    </NeuCard>
  )
}
```

---

## 7. AUTH-03 상세 설계 (`/admin/users`)

### 개요

- `AdminGuard` 보호 필요 — `role !== 'admin'` 접근 시 `/dashboard` 리다이렉트 (toast 포함)
- `AdminGuard`는 Phase 1에서 이미 구현됨 — 재구현 금지, 라우트 등록 시 감싸기만 한다 (섹션 9 참고)

### 컴포넌트 트리

```
UserManagementPage
├── PageHeader "사용자 승인 관리"
├── 탭 (pending 카운트 배지 포함)
│   ├── "전체" (N)
│   ├── "승인 대기" (pending 카운트, 빨간 배지)
│   ├── "활성" (active 카운트)
│   └── "비활성" (disabled 카운트)
└── DataTable<UserAdminOut>
    ├── 컬럼: 이름, 이메일, role 배지, status 배지, 신청일, 액션
    └── 행별 액션 버튼 (status에 따라 다름)
```

### 탭 상태별 필터링

```typescript
// 탭 선택에 따른 로컬 필터 (서버사이드 X, 전체 목록 조회 후 클라이언트 필터)
type TabFilter = 'all' | 'pending' | 'active' | 'disabled'

function filterUsers(users: UserAdminOut[], tab: TabFilter): UserAdminOut[] {
  if (tab === 'all') return users
  return users.filter((u) => toUserStatus(u) === tab)
}
```

### DataTable 컬럼 정의

| 컬럼 | 내용 | 비고 |
|---|---|---|
| 이름 | `user.name` | |
| 이메일 | `user.email` | |
| 소속 | `user.department` (선택 필드) | 모델 확장 시 표시 |
| 권한 | `UserStatusBadge` (role) | `admin` → 보라, `operator` → 회색 |
| 상태 | `UserStatusBadge` (status) | `pending` → 노랑, `active` → 초록, `disabled` → 빨강 |
| 신청일 | `formatKST(user.created_at)` | |
| 액션 | 상태별 버튼 (아래 표 참고) | |

### 행별 액션 버튼

| 상태 | 버튼 | 색상 | 동작 |
|---|---|---|---|
| `pending` | "승인" | 초록 (`text-[#16A34A]`) | `ConfirmDialog` → `updateUserStatus({ is_approved: true })` |
| `pending` | "거부" | 빨강 (`text-[#DC2626]`) | `ConfirmDialog` → `updateUserStatus({ is_active: false })` |
| `active` | "비활성화" | 주황 (`text-[#D97706]`) | `ConfirmDialog` → `updateUserStatus({ is_active: false })` |
| `disabled` | "재활성화" | 초록 | `ConfirmDialog` → `updateUserStatus({ is_active: true, is_approved: true })` |

**role 변경 드롭다운:**
- 각 행에 `<select>` 또는 shadcn `Select` 컴포넌트로 `admin` / `operator` 선택
- 변경 즉시 `useUpdateUserRole` 호출 (ConfirmDialog 없이 즉시 처리)

### UX 주의사항

1. **자기 자신 계정 보호**: 현재 로그인된 `useAuthStore(s => s.user).id`와 행의 `user.id`를 비교하여 일치하면 모든 액션 버튼 비활성화 (disabled + tooltip "본인 계정은 변경할 수 없습니다")
2. **pending 카운트 배지**: `pending` 탭 레이블 옆에 카운트 숫자를 배지로 표시. 카운트가 0이면 배지 미표시
3. **낙관적 업데이트 없음**: 상태 변경 후 `invalidateQueries`로 목록 새로고침 (데이터 정합성 우선)

### `UserStatusBadge` 컴포넌트

```tsx
// src/components/user/UserStatusBadge.tsx
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import type { UserStatus, UserRole } from '@/types/auth'

interface UserStatusBadgeProps {
  status: UserStatus
}

export function UserStatusBadge({ status }: UserStatusBadgeProps) {
  const map: Record<UserStatus, { label: string; className: string }> = {
    pending:  { label: '승인 대기', className: 'bg-yellow-100 text-yellow-700' },
    active:   { label: '활성',      className: 'bg-green-100  text-green-700'  },
    disabled: { label: '비활성',    className: 'bg-red-100    text-red-700'    },
  }
  const { label, className } = map[status]
  return <NeuBadge className={className}>{label}</NeuBadge>
}

interface UserRoleBadgeProps {
  role: UserRole
}

export function UserRoleBadge({ role }: UserRoleBadgeProps) {
  return (
    <NeuBadge
      className={role === 'admin'
        ? 'bg-[#EEF2FF] text-[#6366F1]'
        : 'bg-gray-100 text-gray-600'
      }
    >
      {role === 'admin' ? '관리자' : '운영자'}
    </NeuBadge>
  )
}
```

### `ConfirmDialog` 컴포넌트

```tsx
// src/components/user/ConfirmDialog.tsx
// shadcn AlertDialog 기반
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  onConfirm: () => void
  isPending?: boolean
}

export function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel, confirmVariant = 'default', onConfirm, isPending
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className={confirmVariant === 'destructive' ? 'bg-[#DC2626] hover:bg-red-700' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

### 구현 코드 스켈레톤

```tsx
// src/pages/admin/UserManagementPage.tsx
import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useUsers } from '@/hooks/queries/useUsers'
import { useUpdateUserStatus } from '@/hooks/mutations/useUpdateUserStatus'
import { useUpdateUserRole } from '@/hooks/mutations/useUpdateUserRole'
import { PageHeader } from '@/components/common/PageHeader'
import { UserStatusBadge, UserRoleBadge } from '@/components/user/UserStatusBadge'
import { ConfirmDialog } from '@/components/user/ConfirmDialog'
import { formatKST } from '@/lib/utils'
import { toUserStatus } from '@/types/auth'
import type { UserAdminOut, TabFilter } from '@/types/auth'

export function UserManagementPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [confirmState, setConfirmState] = useState<{
    open: boolean; userId: number; action: 'approve' | 'reject' | 'disable' | 'reactivate'
  } | null>(null)

  const { data: users = [], isLoading } = useUsers()
  const { mutate: updateStatus, isPending: isStatusPending } = useUpdateUserStatus()
  const { mutate: updateRole } = useUpdateUserRole()

  const pendingCount = users.filter((u) => toUserStatus(u) === 'pending').length
  const filtered = filterUsers(users, activeTab)

  const handleConfirm = () => {
    if (!confirmState) return
    const { userId, action } = confirmState
    const bodyMap = {
      approve:    { is_approved: true },
      reject:     { is_active: false },
      disable:    { is_active: false },
      reactivate: { is_active: true, is_approved: true },
    }
    updateStatus({ id: userId, body: bodyMap[action] }, {
      onSettled: () => setConfirmState(null),
    })
  }

  // ... 테이블 렌더링
}
```

---

## 8. PROFILE 상세 설계 (`/profile`)

### 컴포넌트 트리

```
ProfilePage
├── PageHeader "내 프로필"
└── NeuCard (max-w-2xl)
    ├── 사용자 정보 섹션
    │   ├── 이름 + UserRoleBadge (role)
    │   ├── 이메일 (표시만, 수정 불가)
    │   ├── 가입일 formatKST(created_at)
    │   └── "정보 수정" NeuButton (ghost) → 편집 모드 토글
    ├── [편집 모드] 프로필 수정 폼
    │   ├── NeuInput — 이름 (수정 가능)
    │   ├── 이메일 표시 (readOnly, 안내: "이메일은 변경할 수 없습니다")
    │   ├── NeuButton "저장" (loading=isPending)
    │   └── NeuButton "취소" (ghost)
    └── 비밀번호 변경 아코디언 (별도 섹션)
        ├── [접힘] "비밀번호 변경" 클릭 → 펼침
        └── [펼침] 비밀번호 변경 폼
            ├── NeuInput — 현재 비밀번호
            ├── NeuInput — 새 비밀번호 (8자 이상, 영문+숫자+특수문자)
            ├── NeuInput — 새 비밀번호 확인
            ├── NeuButton "비밀번호 변경" (loading=isPending)
            └── NeuButton "취소" (ghost)
```

### 수정 가능/불가 필드 정리

| 필드 | 편집 가능 여부 | 설명 |
|---|---|---|
| 이름 (`name`) | 가능 | 프로필 수정 폼에서 변경 |
| 이메일 (`email`) | 불가 | 회원가입 시 확정. 읽기 전용으로만 표시 |
| 비밀번호 | 가능 | 별도 아코디언 섹션에서 처리. 현재 비밀번호 재확인 필수 |
| role | 불가 | AUTH-03에서 관리자만 변경 가능. 배지로 표시만 |

### zod 스키마

```typescript
// 이름 수정 스키마
const profileSchema = z.object({
  name: z.string().min(2, '이름은 2자 이상 입력하세요'),
})

// 비밀번호 변경 스키마
const passwordSchema = z.object({
  current_password: z.string().min(1, '현재 비밀번호를 입력하세요'),
  new_password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(
      /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
      '영문, 숫자, 특수문자를 모두 포함해야 합니다'
    ),
  confirm_password: z.string(),
}).refine((data) => data.new_password === data.confirm_password, {
  message: '비밀번호가 일치하지 않습니다',
  path: ['confirm_password'],
})
```

### 보안 주의사항

1. **현재 비밀번호 재확인 필수**: `useUpdateMe`에서 `current_password`를 함께 전송하고 백엔드에서 검증
2. **성공 toast**: `useUpdateMe`의 `onSuccess`에서 `toast.success('프로필이 업데이트되었습니다')` 처리
3. **비밀번호 변경 성공 후**: 폼 초기화 + 아코디언 닫기
4. **이름 변경 성공 후**: `useAuthStore`의 `user` 정보도 업데이트 (`useUpdateMe.onSuccess` 내부에서 처리)

### 구현 코드 스켈레톤

```tsx
// src/pages/ProfilePage.tsx
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMe } from '@/hooks/queries/useMe'
import { useUpdateMe } from '@/hooks/mutations/useUpdateMe'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { UserRoleBadge } from '@/components/user/UserStatusBadge'
import { formatKST } from '@/lib/utils'

export function ProfilePage() {
  const { data: me, isLoading } = useMe()
  const { mutate: updateMe, isPending } = useUpdateMe()
  const [isEditing, setIsEditing] = useState(false)
  const [isPasswordOpen, setIsPasswordOpen] = useState(false)

  // 이름 수정 폼
  const profileForm = useForm({ resolver: zodResolver(profileSchema) })
  // 비밀번호 변경 폼
  const passwordForm = useForm({ resolver: zodResolver(passwordSchema) })

  const handleProfileSubmit = (data: { name: string }) => {
    updateMe({ name: data.name }, {
      onSuccess: () => setIsEditing(false),
    })
  }

  const handlePasswordSubmit = (data: { current_password: string; new_password: string }) => {
    updateMe(
      { current_password: data.current_password, new_password: data.new_password },
      {
        onSuccess: () => {
          passwordForm.reset()
          setIsPasswordOpen(false)
        },
      }
    )
  }

  if (isLoading) return <LoadingSkeleton shape="card" />

  return (
    <div className="space-y-6">
      <PageHeader title="내 프로필" />
      <NeuCard className="max-w-2xl">
        {/* 사용자 정보 + 편집 폼 */}
        {/* 비밀번호 변경 아코디언 */}
      </NeuCard>
    </div>
  )
}
```

---

## 9. 라우트 등록 (`src/App.tsx`)

Phase 1의 `App.tsx`에 아래 내용을 추가한다.

```tsx
// Phase 3c 신규 페이지 import (Lazy)
const RegisterPage        = lazy(() => import('@/pages/auth/RegisterPage'))
const UserManagementPage  = lazy(() => import('@/pages/admin/UserManagementPage'))
const ProfilePage         = lazy(() => import('@/pages/ProfilePage'))

// App 컴포넌트 내부 <Routes>에 추가:

{/* 인증 레이아웃 (비인증 접근 가능) */}
<Route element={<AuthLayout />}>
  <Route path="/login" element={<LoginPage />} />
  {/* AUTH-02: AuthGuard 없음 — 미로그인 상태에서 신청 가능 */}
  <Route path="/register" element={
    <Suspense fallback={<LoadingSkeleton shape="card" />}>
      <RegisterPage />
    </Suspense>
  } />
</Route>

{/* 앱 레이아웃 (AuthGuard) */}
<Route element={<AuthGuard><AppLayout /></AuthGuard>}>
  {/* ... 기존 라우트 ... */}

  {/* PROFILE: AuthGuard 적용 (AppLayout 내부) */}
  <Route path="/profile" element={
    <Suspense fallback={<LoadingSkeleton shape="card" />}>
      <ProfilePage />
    </Suspense>
  } />

  {/* AUTH-03: AdminGuard 추가 (AppLayout 내부) */}
  <Route path="/admin/users" element={
    <AdminGuard>
      <Suspense fallback={<LoadingSkeleton shape="table" />}>
        <UserManagementPage />
      </Suspense>
    </AdminGuard>
  } />
</Route>
```

### 라우트 등록 규칙 요약

| 경로 | 레이아웃 | AuthGuard | AdminGuard | 비고 |
|---|---|---|---|---|
| `/register` | `AuthLayout` | 없음 | 없음 | 비인증 접근 가능 |
| `/profile` | `AppLayout` | 있음 | 없음 | 로그인 사용자 본인 |
| `/admin/users` | `AppLayout` | 있음 | 있음 | 관리자 전용 |

### `ROUTES` 상수 추가 (`src/constants/routes.ts`)

```typescript
export const ROUTES = {
  // ... 기존 ...
  REGISTER:     '/register',
  PROFILE:      '/profile',
  ADMIN_USERS:  '/admin/users',
} as const
```

### Sidebar 링크 추가

- `/profile`: 사이드바 하단 또는 TopBar 사용자 메뉴에 "내 프로필" 링크 추가
- `/admin/users`: `user.role === 'admin'` 조건부 렌더링으로 사이드바에 "사용자 관리" 링크 추가 (pending 카운트 배지 포함)

---

## 10. 검증 체크리스트

### 기능 검증

- [ ] `/register` 접근 시 `AuthLayout` 중앙 정렬 레이아웃 적용 확인
- [ ] 비밀번호 최소 8자 + 영문 + 숫자 + 특수문자 미충족 시 inline 에러 표시
- [ ] 비밀번호 확인 불일치 시 inline 에러 표시
- [ ] 이미 사용 중인 이메일 등록 시 "이미 사용 중인 이메일입니다" 에러 표시
- [ ] 등록 성공 시 성공 화면으로 전환, "로그인 페이지로" 버튼 동작
- [ ] `/admin/users` — `operator` role 접근 시 `/dashboard` 리다이렉트 + toast
- [ ] 승인 대기 탭에 pending 카운트 배지 표시
- [ ] "승인" 클릭 → ConfirmDialog → 확인 → 사용자 상태 `active`로 변경 → 목록 갱신
- [ ] "거부" 클릭 → ConfirmDialog (destructive) → 확인 → 사용자 상태 `disabled`로 변경
- [ ] "비활성화" / "재활성화" 동작 확인
- [ ] 자기 자신 계정 행에서 모든 액션 버튼 비활성화 확인
- [ ] role 드롭다운 변경 즉시 반영 확인
- [ ] `/profile` — 이름 수정 성공 후 TopBar 사용자 이름 즉시 갱신 확인
- [ ] 비밀번호 변경 시 현재 비밀번호 틀린 경우 "현재 비밀번호가 올바르지 않습니다" toast
- [ ] 이메일 필드는 읽기 전용, 수정 불가 확인

### 보안 검증

- [ ] `GET /api/v1/auth/users` — `operator` 토큰으로 호출 시 백엔드 403 반환 확인
- [ ] `PATCH /api/v1/auth/users/{id}/status` — `operator` 토큰으로 호출 시 403 반환 확인
- [ ] `PATCH /api/v1/auth/me` — 현재 비밀번호 없이 비밀번호 변경 시도 시 401 반환 확인

### 접근성 검증

- [ ] 모든 `NeuInput` 필드에 `label` + `htmlFor` 연결 (screen reader 대응)
- [ ] `ConfirmDialog` — 키보드 포커스 트랩 동작 확인 (shadcn AlertDialog 기본 제공)
- [ ] 비밀번호 필드 `autoComplete="new-password"` / `"current-password"` 적용 확인
