/** 목록 한 페이지의 행 수 — 관리 화면 조회 모달과 에디터 패널이 함께 쓴다. */
export const PAGE_SIZE = 50

export type PageResult<T> = { rows: T[]; total: number; page: number; pageCount: number }

/**
 * 검색어가 값 가운데 하나에 부분 일치하는가. 앞뒤 공백을 걷고 대소문자를 무시한다.
 * **정규식이 아니다** — `%`·`_`·`(`·`.` 도 글자 그대로 찾는다(서버 `items.page` 의 이스케이프와 같은 뜻).
 */
export function matchesQuery(values: readonly (string | null | undefined)[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return values.some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

/**
 * 메모리에 있는 행을 거르고 한 페이지를 자른다(에디터 패널 공용). `page` 는 1부터이고, 지워서 전체가 줄어
 * 범위를 벗어나면 마지막 페이지로 당긴다 — 빈 페이지에 갇히지 않게 한다.
 */
export function filterAndPage<T>(
  rows: readonly T[],
  query: string,
  fields: (row: T) => readonly (string | null | undefined)[],
  page: number,
  size: number = PAGE_SIZE,
): PageResult<T> {
  const filtered = query.trim() === '' ? rows : rows.filter((row) => matchesQuery(fields(row), query))
  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (current - 1) * size
  return { rows: filtered.slice(start, start + size), total, page: current, pageCount }
}
