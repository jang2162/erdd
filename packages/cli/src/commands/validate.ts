import {
  computeWarnings, filesToModel, validateModelIntegrity,
  type ProjectModel, type Warning,
} from '@erdd/core'
import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { readTree } from '../tree.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
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
function locate(
  model: ProjectModel, tableFiles: Record<string, string>, w: Warning,
): WarningLocation {
  /**
   * 좌표로 쓸 파일 경로. **filesToModel이 실제로 읽어 온 경로를 그대로 쓴다.**
   *
   * 예전에는 `erdd/tables/${physicalName}.yaml`로 **재조립**했는데, 파일명과 물리명은
   * 정규 동선에서 어긋난다 — SKILL.md가 "테이블 파일 이름을 직접 바꾸지 않는다 … 이름을
   * 바꾸려면 파일 안의 `name`을 고친다"고 시키고 파일명은 다음 `pull`이 따라오기 때문이다.
   * 개명 직후 파일은 `MBR.yaml`인데 물리명은 `MEMBER`라 재조립은 없는 파일을 가리켰고,
   * 두 테이블이 이름을 맞바꾼 상태에서는 **있는 남의 파일**을 가리켰다. validate는 push 전
   * 검사라 정확히 그 창에서 돌고, 수렴(pull)은 그 뒤에나 온다.
   *
   * 그래서 `unsafeFileName` 가드도 함께 걷어냈다. 그것은 빈 물리명이 `erdd/tables/.yaml`이라는
   * 없는 경로를 만드는 것을 **막던** 방어인데, 재조립이 사라지면 만들 거짓 경로 자체가 없다.
   * 이제 그런 테이블도 자기가 실제로 들어 있는 파일을 **올바로** 가리킨다(막던 것이 고쳐졌다).
   *
   * ⚠️ 폴백(`?? null`)은 **지금은 도달하지 않는다.** `ok: true`에서 tableFiles는 모든
   * 테이블을 덮는다(파일이 객체가 아니면 테이블이 모델에 안 들어오고, 같은 id가 두 파일에
   * 있으면 `ok: false`다). 사양의 「좌표를 못 구하면 메시지만 낸다」 계약을 코드로 남겨 두는
   * 자리이지 관측된 갈래가 아니다.
   */
  const fileOf = (tableId: string): string | null => tableFiles[tableId] ?? null
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
      .map((w) => ({ ...w, ...locate(result.model, result.tableFiles, w) }))
    // ⚠️ **판정에 넣지 않는다**(설계 D3) — `validate` 는 파일만 본다. 미저장 편집이 있다고
    // 종료 코드가 바뀌면 커밋 훅·CI 가 화면 상태에 좌우된다.
    const unsavedDraft = await hasDraft(ctx.cwd)
    const ok = integrityIssues.length === 0 && (!ctx.strict || warnings.length === 0)

    const human = [
      integrityIssues.length === 0 ? '정합성 문제 없음' : `정합성 오류 ${integrityIssues.length}건`,
      ...integrityIssues.map((i) => `  ${JSON.stringify(i)}`),
      warnings.length === 0 ? '명명 경고 없음' : `명명 경고 ${warnings.length}건`,
      ...warnings.map(warningLine),
      ...(unsavedDraft ? [UNSAVED_NOTICE] : []),
    ].join('\n')

    emit(ctx.json, human, {
      ok,
      parseErrors: [], integrityIssues, warnings, unsavedDraft,
    })
    return ok ? 0 : 1
  })
}
