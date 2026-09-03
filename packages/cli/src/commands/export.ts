import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { ddlWarnings, filesToModel, generateDbml, generateDdl, type Dialect } from '@erdd/core'
import { readConfig } from '../config.js'
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
      ? generateDdl(result.model, dialect, { kind: 'all' }, rules)
      : generateDbml(result.model, dialect, { kind: 'all' }, {}, rules)
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
