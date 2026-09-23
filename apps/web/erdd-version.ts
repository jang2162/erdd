import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 제품 버전 — `@erdd/cli` 의 버전 하나로 통일한다. vite.config.ts 와 vitest.config.ts 가 함께
 * 쓴다(둘은 별개 설정이라 한쪽에만 두면 테스트에서 `__ERDD_VERSION__` 이 정의되지 않는다).
 *
 * 파일이 없거나 버전이 비었으면 빌드를 죽인다 — 빈 값으로 떨어지면 헤더에 `v` 만 뜬 채로
 * 배포되고 아무도 알아채지 못한다.
 */
export function erddVersion(): string {
  const file = path.resolve(import.meta.dirname, '../../packages/cli/package.json')
  const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown }
  if (typeof version !== 'string' || version === '') {
    throw new Error(`${file} 에서 version 을 읽지 못했습니다: ${JSON.stringify(version)}`)
  }
  return version
}
