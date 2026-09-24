import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, filterAndPage, matchesQuery } from './paginate'

type Row = { name: string; code: string | null }
const FIELDS = (r: Row) => [r.name, r.code]
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ name: `이름${String(i).padStart(3, '0')}`, code: `C${i}` }))

describe('matchesQuery', () => {
  it('빈 검색어(공백만 포함)는 모두 맞는다', () => {
    expect(matchesQuery(['a'], '')).toBe(true)
    expect(matchesQuery(['a'], '   ')).toBe(true)
  })
  it('대소문자 없이 어느 칸이든 부분 일치하면 맞고, null 칸은 건너뛴다', () => {
    expect(matchesQuery(['회원', 'MBR'], 'mb')).toBe(true)
    expect(matchesQuery([null, 'Member Info'], ' INFO ')).toBe(true)
    expect(matchesQuery([null, undefined], 'x')).toBe(false)
  })
  it('특수 문자는 글자 그대로 찾는다 — 정규식이 아니다', () => {
    const hit = (values: string[], q: string) => values.filter((v) => matchesQuery([v], q))
    const values = ['100%', '1000', 'a_b', 'axb', 'f(x)', 'fx', 'a.b', 'acb']
    expect(hit(values, '%')).toEqual(['100%'])
    expect(hit(values, '_')).toEqual(['a_b'])
    expect(hit(values, '(')).toEqual(['f(x)'])
    expect(hit(values, '.')).toEqual(['a.b'])
  })
})

describe('filterAndPage', () => {
  it('거르지 않으면 한 페이지 50건이고 pageCount 는 올림이다', () => {
    const r = filterAndPage(rows(120), '', FIELDS, 1)
    expect(PAGE_SIZE).toBe(50)
    expect(r.rows).toHaveLength(50)
    expect(r.rows[0]!.name).toBe('이름000')
    expect(r).toMatchObject({ total: 120, page: 1, pageCount: 3 })
    expect(filterAndPage(rows(120), '', FIELDS, 3).rows.map((x) => x.name)).toEqual(
      rows(120).slice(100).map((x) => x.name))
  })
  it('검색은 걸러진 행 기준으로 total·pageCount 를 낸다', () => {
    const r = filterAndPage(rows(120), 'c11', FIELDS, 1)
    expect(r.rows.map((x) => x.code)).toEqual(['C11', 'C110', 'C111', 'C112', 'C113', 'C114', 'C115', 'C116', 'C117', 'C118', 'C119'])
    expect(r).toMatchObject({ total: 11, page: 1, pageCount: 1 })
  })
  it('범위를 벗어난 페이지는 마지막 페이지로 당긴다 — 지워서 전체가 줄어든 경우', () => {
    expect(filterAndPage(rows(60), '', FIELDS, 3)).toMatchObject({ page: 2, pageCount: 2 })
    expect(filterAndPage(rows(60), '', FIELDS, 3).rows).toHaveLength(10)
    // 51번째를 지워 50건이 되면 2쪽에 있던 사람은 1쪽을 본다(빈 쪽에 갇히지 않는다).
    expect(filterAndPage(rows(50), '', FIELDS, 2)).toMatchObject({ page: 1, pageCount: 1, total: 50 })
  })
  it('빈 목록은 1/1 쪽이고 0보다 작은 페이지는 1쪽이다', () => {
    expect(filterAndPage([], '', FIELDS, 1)).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 })
    expect(filterAndPage(rows(3), '', FIELDS, 0).page).toBe(1)
  })
})
