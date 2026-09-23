import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 헤더에 떠야 할 버전 — `packages/cli/package.json` 을 직접 읽는다. 주입된 `__ERDD_VERSION__` 과
 * 비교하면 자기 자신과 비교하는 셈이고, 버전을 적어 두면 다음 릴리스에 테스트가 깨진다.
 */
export const CLI_VERSION = (JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../../../packages/cli/package.json'), 'utf8'),
) as { version: string }).version
