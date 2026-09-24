import { describe, expect, it, vi } from 'vitest'
import { DOMAIN_PAGE_LIMIT, fetchAllDomainOptions } from './library-domains'

const domainItem = (i: number) => ({ id: `d${i}`, payload: { name: `도메인${i}` } })

describe('fetchAllDomainOptions', () => {
  it('total 에 닿을 때까지 200건씩 넘겨 받고 이름을 푼다', async () => {
    const all = Array.from({ length: 450 }, (_, i) => domainItem(i))
    const fetchPage = vi.fn(async (offset: number) => ({ items: all.slice(offset, offset + DOMAIN_PAGE_LIMIT), total: all.length }))
    const out = await fetchAllDomainOptions(fetchPage)
    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 200, 400])
    expect(out).toHaveLength(450)
    expect(out[449]).toEqual({ id: 'd449', name: '도메인449' })
  })

  it('그 사이 지워져 페이지가 짧게 오면 거기서 멈춘다', async () => {
    const fetchPage = vi.fn(async (offset: number) => (offset === 0
      ? { items: Array.from({ length: 200 }, (_, i) => domainItem(i)), total: 400 }
      : { items: [domainItem(200)], total: 201 }))
    const out = await fetchAllDomainOptions(fetchPage)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(201)
  })
})
