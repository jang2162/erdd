import { describe, expect, it } from 'vitest'
import config from '../vite.config'
import { CLI_VERSION } from '@/testing/cli-version'

/**
 * 웹 테스트는 vitest.config.ts 의 define 만 거친다. vite.config.ts 에서 define 이 빠지면 빌드는
 * 통과하고 번들에 `__ERDD_VERSION__` 식별자가 그대로 남아 런타임에 ReferenceError 로 헤더가 죽는다 —
 * 그 설정은 여기서만 잠긴다.
 */
describe('vite.config', () => {
  it('빌드에도 @erdd/cli 버전을 __ERDD_VERSION__ 으로 주입한다', () => {
    expect(config.define?.__ERDD_VERSION__).toBe(JSON.stringify(CLI_VERSION))
  })
})
