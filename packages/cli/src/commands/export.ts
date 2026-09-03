import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { ddlWarnings, filesToModel, generateDbml, generateDdl, type Dialect } from '@erdd/core'
import { readConfig } from '../config.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
import { emit, note } from '../output.js'
import { readTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

export type ExportFormat = 'ddl' | 'dbml'

export type ExportCtx = CommandCtx & {
  format: ExportFormat
  /** 없으면 config.dialects[0]. DIALECTS 검사는 main.ts 가 이미 했다. */
  dialect?: Dialect
  /** 없으면 stdout. */
  out?: string
}

/**
 * DBML `Project` 블록에 쓸 이름 — **작업 디렉터리 이름**이다.
 *
 * ⚠️ **이 이름의 목적은 방언을 실어 나르는 것이다.** DBML 의 방언은 `Project { database_type }`
 * 이고(→ `import.ts` 의 `resolveDialect`), `generateDbml` 은 **이름이 있을 때만** 그 블록을 낸다.
 * 이름을 안 주면 블록이 통째로 빠져 **CLI 가 낸 DBML 을 되읽을 때 방언이 `config.dialects[0]` 로
 * 떨어진다** — 방언이 다른 프로젝트로 옮기면 컬럼 타입이 조용히 달라진다(리뷰가 실측으로 찾은
 * 구멍이다. `roundtrip.test.ts` 의 「방언이 다른 프로젝트로 되읽어도」가 이것을 잠근다).
 *
 * `erdd.config.yaml` 에 이름 필드를 새로 만들지 않은 이유는 파일 포맷 변경이 딸려 오기 때문이다
 * (읽기·쓰기·기본값 주입·매뉴얼, 연결 모드에서는 서버 동기화 여부까지).
 *
 * 공백·한글·하이픈은 `quoteDbmlIdent` 가 큰따옴표로 감싸므로 그대로 안전하다. 루트에서 부르면
 * 이름이 빈 문자열이라 `undefined` 를 돌려주고, 그때는 블록이 빠진다(이 수정 이전의 동작이다).
 */
export function dbmlProjectName(cwd: string): string | undefined {
  return basename(cwd) || undefined
}

/**
 * 로컬 파일을 DDL·DBML 로 내보낸다. 서버를 타지 않는다 — `validate` 와 같은 순수 파일 경로다.
 *
 * ⚠️ **DDL 본문은 stdout, 그 밖의 모든 말은 stderr 다.** 이 명령의 주 용도가
 * `erdd export > schema.sql` 파이프라인이라, 경고 한 줄이 stdout 에 섞이면 산출물이 깨진다.
 * `ddlWarnings` 도 방언 안내도 `note()`(stderr)로 나간다.
 *
 * `--json` 은 `{ format, dialect, path, content, warnings }` 다. **`content` 와 `path` 는 서로
 * 배타다** — `-o` 를 줬으면 본문은 그 파일에 있으므로 `content: null` 이고 `path` 가 채워지며,
 * 안 줬으면 `path: null` 이고 `content` 에 본문이 실린다. 같은 본문을 두 자리에 싣지 않는다.
 */
export function exportCommand(ctx: ExportCtx): Promise<number> {
  return run(ctx, async () => {
    // 미저장 편집은 `erdd/` 에 없다 — 이 명령이 보는 것과 화면이 보는 것이 다르다.
    if (await hasDraft(ctx.cwd)) note(UNSAVED_NOTICE)
    const config = await readConfig(ctx.cwd)
    const result = filesToModel(await readTree(ctx.cwd))
    if (!result.ok) {
      // validate 와 같은 봉투다 — 같은 파일 오류를 두 명령이 다른 모양으로 말하면 안 된다.
      emit(
        ctx.json,
        [`파싱 오류 ${result.issues.length}건`, ...result.issues.map((i) => `  ${i.path}: ${i.message}`)].join('\n'),
        { ok: false, parseErrors: result.issues, integrityIssues: [], warnings: [] },
      )
      return 1
    }

    const dialect = ctx.dialect ?? config.dialects[0]!
    // config 에 없는 방언도 유효하기만 하면 낸다 — 일회성으로 다른 DB 의 DDL 이 필요한 것은
    // 정상적인 쓰임이다. 다만 조용히 하지는 않는다(설정과 다른 산출물이 나간 것이다).
    if (!config.dialects.includes(dialect)) {
      note(`알림: ${dialect}는 erdd.config.yaml의 dialects에 없습니다(${config.dialects.join(', ')}). 그대로 내보냅니다`)
    }

    const rules = config.namingRules
    const content = ctx.format === 'ddl'
      ? generateDdl(result.model, dialect, { kind: 'all' }, rules, config.tableOptions)
      : generateDbml(result.model, dialect, { kind: 'all' }, { projectName: dbmlProjectName(ctx.cwd) }, rules)
    const warnings = ddlWarnings(result.model, dialect, { kind: 'all' }, rules)
    for (const w of warnings) note(`경고: ${w}`)

    if (ctx.out === undefined) {
      emit(ctx.json, content, { format: ctx.format, dialect, path: null, content, warnings })
      return 0
    }
    const path = resolve(ctx.cwd, ctx.out)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
    emit(ctx.json, `${path}에 ${ctx.format}을 썼습니다`, {
      format: ctx.format, dialect, path, content: null, warnings,
    })
    return 0
  })
}
