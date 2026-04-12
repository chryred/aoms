import { describe, it, expect } from 'vitest'
import { qk } from '@/constants/queryKeys'

describe('queryKeys (qk)', () => {
  it('systems()', () => {
    expect(qk.systems()).toEqual(['systems'])
  })

  it('system(id)', () => {
    expect(qk.system(1)).toEqual(['systems', 1])
  })

  it('alerts(params)', () => {
    const params = { system_id: 1, severity: 'critical' as const }
    expect(qk.alerts(params)).toEqual(['alerts', params])
  })

  it('me()', () => {
    expect(qk.me()).toEqual(['auth', 'me'])
  })

  it('contacts()', () => {
    expect(qk.contacts()).toEqual(['contacts'])
  })

  it('contact(id)', () => {
    expect(qk.contact(5)).toEqual(['contacts', 5])
  })

  it('systemContacts(systemId)', () => {
    expect(qk.systemContacts(2)).toEqual(['systems', 2, 'contacts'])
  })

  it('aggregations.hourly', () => {
    const params = { system_id: 1, collector_type: 'synapse_agent', metric_group: 'cpu', hours: 24 }
    const key = qk.aggregations.hourly(params)
    expect(key[0]).toBe('aggregations')
    expect(key[1]).toBe('hourly')
  })

  it('aggregations.daily', () => {
    const key = qk.aggregations.daily({ system_id: 1 })
    expect(key[0]).toBe('aggregations')
    expect(key[1]).toBe('daily')
  })

  it('aggregations.weekly', () => {
    const key = qk.aggregations.weekly({})
    expect(key[0]).toBe('aggregations')
    expect(key[1]).toBe('weekly')
  })

  it('aggregations.monthly', () => {
    const key = qk.aggregations.monthly({ period_type: 'monthly' })
    expect(key[0]).toBe('aggregations')
    expect(key[1]).toBe('monthly')
  })

  it('aggregations.trends()', () => {
    expect(qk.aggregations.trends()).toEqual(['aggregations', 'trends'])
  })

  it('reports(type)', () => {
    expect(qk.reports('daily')).toEqual(['reports', 'daily'])
  })

  it('reports() — 타입 없음', () => {
    expect(qk.reports()).toEqual(['reports', undefined])
  })

  it('search.collectionInfo()', () => {
    expect(qk.search.collectionInfo()).toEqual(['search', 'collection-info'])
  })

  it('search.aggregationStatus()', () => {
    expect(qk.search.aggregationStatus()).toEqual(['search', 'aggregation-status'])
  })

  it('agents()', () => {
    const key = qk.agents()
    expect(key[0]).toBe('agents')
  })

  it('agent(id)', () => {
    expect(qk.agent(7)).toEqual(['agents', 7])
  })

  it('agentStatus(id)', () => {
    expect(qk.agentStatus(7)).toEqual(['agents', 7, 'status'])
  })

  it('agentConfig(id)', () => {
    expect(qk.agentConfig(7)).toEqual(['agents', 7, 'config'])
  })

  it('installJob(jobId)', () => {
    expect(qk.installJob('job-abc')).toEqual(['agents', 'jobs', 'job-abc'])
  })

  it('agentLiveStatus(id)', () => {
    expect(qk.agentLiveStatus(7)).toEqual(['agents', 7, 'live-status'])
  })
})
