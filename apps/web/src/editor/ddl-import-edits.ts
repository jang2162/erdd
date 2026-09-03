import type { DdlImportPlan, ProjectModel } from '@erdd/core'
import { applyDdlImport as applyDdlImportCore } from '@erdd/core'
import { computeAutoLayout } from './auto-layout.js'

/**
 * `applyDdlImport`(core)의 web 호출부. **하는 일은 dagre 계층 배치를 주입하는 것 하나다.**
 *
 * 본체는 core 에 있다 — CLI 의 `erdd import` 가 같은 경로를 써야 해서 옮겼다. core 는 dagre 를
 * 의존할 수 없으므로(dependencies 가 zod 뿐이다) 배치가 주입 인자가 됐고, core 의 기본값은
 * 격자다. ⚠️ **주입을 빼면 캔버스 좌표가 조용히 격자로 바뀐다** — 오류도 타입 에러도 나지
 * 않는다. `ddl-import-edits.test.ts` 가 그 한 가지를 잠근다.
 */
export function applyDdlImport(
  model: ProjectModel, plan: DdlImportPlan, newId: () => string,
): ProjectModel {
  return applyDdlImportCore(model, plan, newId, { layout: computeAutoLayout })
}
