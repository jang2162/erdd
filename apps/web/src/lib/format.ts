export function formatCreatedAt(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

const COUNT_FORMAT = new Intl.NumberFormat('ko-KR')

/**
 * 항목 수·건수 표시. 천 단위 구분자를 붙인다(16565 → "16,565"). 관리 화면 목록, 삭제 확인 문구, 공용 리소스
 * 라이브러리 목록, 탭 제목의 개수, 페이지 표시, 적용 진행 표시, 토스트 요약이 모두 이것을 쓴다.
 */
export function formatCount(n: number): string {
  return COUNT_FORMAT.format(n)
}

/** 나눠 적용하는 동안의 버튼·토스트 문구. `done` 은 끝난 조각 수다. */
export function formatProgress(done: number, total: number): string {
  return `적용 중… ${formatCount(done)} / ${formatCount(total)}`
}
