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
