import { describe, it, expect } from 'vitest'
import { ROUTES } from '@/constants/routes'

describe('ROUTES', () => {
  it('정적 경로들', () => {
    expect(ROUTES.LOGIN).toBe('/login')
    expect(ROUTES.REGISTER).toBe('/register')
    expect(ROUTES.DASHBOARD).toBe('/dashboard')
    expect(ROUTES.SYSTEMS).toBe('/systems')
    expect(ROUTES.ALERTS).toBe('/alerts')
    expect(ROUTES.CONTACTS).toBe('/contacts')
    expect(ROUTES.CONTACTS_NEW).toBe('/contacts/new')
    expect(ROUTES.REPORTS).toBe('/reports')
    expect(ROUTES.REPORTS_HISTORY).toBe('/reports/history')
    expect(ROUTES.SEARCH).toBe('/search')
    expect(ROUTES.TRENDS).toBe('/trends')
    expect(ROUTES.FEEDBACK).toBe('/feedback')
    expect(ROUTES.PROFILE).toBe('/profile')
    expect(ROUTES.ADMIN_USERS).toBe('/admin/users')
    expect(ROUTES.VECTOR_HEALTH).toBe('/vector-health')
    expect(ROUTES.AGENTS).toBe('/agents')
  })

  it('contactEdit 함수 — 숫자 ID', () => {
    expect(ROUTES.contactEdit(1)).toBe('/contacts/1/edit')
    expect(ROUTES.contactEdit(99)).toBe('/contacts/99/edit')
  })

  it('contactEdit 함수 — 문자열 ID', () => {
    expect(ROUTES.contactEdit('abc')).toBe('/contacts/abc/edit')
  })

  it('systemDetail 함수', () => {
    expect(ROUTES.systemDetail(5)).toBe('/dashboard/5')
  })

  it('agentDetail 함수', () => {
    expect(ROUTES.agentDetail(3)).toBe('/agents/3')
  })
})
