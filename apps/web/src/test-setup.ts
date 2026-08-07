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
