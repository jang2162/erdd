import '@testing-library/jest-dom/vitest'

// React Flow가 jsdom에서 요구하는 관측자 폴리필
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as never)
if (!globalThis.DOMMatrixReadOnly) {
  globalThis.DOMMatrixReadOnly = class { constructor() {} } as never
}

// Radix Select가 트리거를 열 때 쓰는 포인터 API가 jsdom에 없다. 없으면 트리거를 클릭해도
// 목록이 뜨지 않아 "기본값 말고 다른 값을 고른다"를 테스트가 재현할 수 없다.
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}

// 드래그의 "좌표 → 드롭 타깃" 조회가 쓰는 API. jsdom에는 레이아웃 엔진이 없어 **아예 없다**
// (null을 주는 것이 아니라 undefined라, 그냥 부르면 TypeError로 핸들러가 터진다).
// 레이아웃이 없으니 의미 있는 답을 줄 수도 없다 — 드롭 타깃 판정은 dropTargetOf로 직접 테스트하고,
// 컴포넌트 테스트는 useDragStore.moveOver로 타깃을 세운다.
Document.prototype.elementFromPoint ??= () => null
