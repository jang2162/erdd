/**
 * 전체 페이지 이동을 함수로 감싼다 — 테스트에서 목 가능하게 하려는 것뿐이다.
 * `window.location.assign`을 직접 부르면 jsdom 에서 실제 이동이 일어나지 않아
 * "이동이 요청됐다"는 것 자체를 잠글 수 없다.
 */
export function assignLocation(href: string): void {
  window.location.assign(href)
}
