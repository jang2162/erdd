import {
  TREE_ROOT, computeWarnings, filesToModel, tableFileName, validateModelIntegrity,
  type ProjectModel, type Warning,
} from '@erdd/core'
import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { readTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

/** 경고가 가리키는 자리. 못 구하면 두 값 모두 null이다 — 키는 언제나 있다. */
type WarningLocation = { path: string | null; label: string | null }
const NO_LOCATION: WarningLocation = { path: null, label: null }

/**
 * 경고 하나의 좌표(파일 + 라벨). scope마다 푸는 길이 다르다.
 *
 * ⚠️ 라벨은 **파일에 든 부분 이름**이다. too-long·reserved·duplicate-physical-table의 메시지는
 * 조합된 최종 이름("TB_MBR")을 말하는데 파일에 적힌 것은 부분 이름("MBR")이라, 사용자가 경고의
 * 이름을 파일에서 찾지 못한다. 한 줄에 둘을 나란히 놓는 것이 그 다리다 — 그래서 그 셋에
 * 별도의 꼬리를 붙이지 않는다(붙이면 같은 사실이 두 번 나온다).
 *
 * ⚠️ 관계 경고에는 tableId가 없다. 관계는 **자식 테이블** 파일에 실린다
 * (file-merge.ts의 FILE_FIELDS에서 relationship.childTableId가 '(소속 테이블)'이다).
 */
function locate(model: ProjectModel, w: Warning): WarningLocation {
  const fileOf = (tableId: string): string => `${TREE_ROOT}/tables/${tableFileName(model, tableId)}`
  // 좌표는 부가 정보다. 무엇이 어긋나 못 풀든 validate가 경고 하나 때문에 죽으면 안 된다.
  try {
    if (w.scope === 'table') {
      const table = model.tables[w.entityId]
      if (table === undefined) return NO_LOCATION
      return { path: fileOf(table.id), label: table.physicalName }
    }
    if (w.scope === 'column') {
      const column = model.columns[w.entityId]
      const table = w.tableId === undefined ? undefined : model.tables[w.tableId]
      if (column === undefined || table === undefined) return NO_LOCATION
      return { path: fileOf(table.id), label: `${table.physicalName}.${column.physicalName}` }
    }
    const rel = model.relationships[w.entityId]
    if (rel === undefined || model.tables[rel.childTableId] === undefined) return NO_LOCATION
    const parent = model.tables[rel.parentTableId]
    return {
      path: fileOf(rel.childTableId),
      label: rel.name !== null && rel.name !== ''
        ? rel.name
        : `→ ${parent?.physicalName ?? rel.parentTableId}`,
    }
  } catch {
    return NO_LOCATION
  }
}

/** 사람용 한 줄. 좌표를 앞에 세운다 — 경로는 그대로 복사해 열 수 있는 형태여야 한다. */
function warningLine(w: Warning & WarningLocation): string {
  const head = [w.path, w.label].filter((v): v is string => v !== null && v !== '')
  return `  ${[...head, w.message].join('  ')}`
}

export function validate(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const result = filesToModel(await readTree(ctx.cwd))

    if (!result.ok) {
      emit(
        ctx.json,
        [`파싱 오류 ${result.issues.length}건`, ...result.issues.map((i) => `  ${i.path}: ${i.message}`)].join('\n'),
        { ok: false, parseErrors: result.issues, integrityIssues: [], warnings: [] },
      )
      return 1
    }

    const integrityIssues = validateModelIntegrity(result.model)
    // 좌표는 기존 필드에 얹기만 한다 — --json 소비자가 보던 모양은 그대로다.
    const warnings = computeWarnings(result.model, config.namingRules, config.dialects)
      .map((w) => ({ ...w, ...locate(result.model, w) }))
    const ok = integrityIssues.length === 0 && (!ctx.strict || warnings.length === 0)

    const human = [
      integrityIssues.length === 0 ? '정합성 문제 없음' : `정합성 오류 ${integrityIssues.length}건`,
      ...integrityIssues.map((i) => `  ${JSON.stringify(i)}`),
      warnings.length === 0 ? '명명 경고 없음' : `명명 경고 ${warnings.length}건`,
      ...warnings.map(warningLine),
    ].join('\n')

    emit(ctx.json, human, {
      ok,
      parseErrors: [], integrityIssues, warnings,
    })
    return ok ? 0 : 1
  })
}
