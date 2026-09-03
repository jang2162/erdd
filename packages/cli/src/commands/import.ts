import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { uuidv7 } from 'uuidv7'
import {
  applyDdlImport, detectDialect, filesToModel, modelToFiles, parseDbml, parseDdl, planDdlImport,
  type DdlImportPlan, type Dialect,
} from '@erdd/core'
import { readConfig } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { readTree, writeTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'
import type { ExportFormat } from './export.js'

export type ImportCtx = CommandCtx & {
  /** 위치 인자. 없으면 USAGE 다. */
  file?: string
  /** 없으면 확장자로 정한다. main.ts 가 값의 유효성은 이미 봤다. */
  format?: ExportFormat
  dialect?: Dialect
  dryRun: boolean
}

/**
 * 확장자로 형식을 정한다. **내용을 추정하지 않는다** — 틀린 파서로 읽으면 테이블이 하나도
 * 안 잡힌 채 "0건 가져왔습니다"로 조용히 끝나서, 사용자는 무엇이 잘못됐는지 알 수 없다.
 */
function formatFromExtension(path: string): ExportFormat | null {
  switch (extname(path).toLowerCase()) {
    case '.sql': case '.ddl': return 'ddl'
    case '.dbml': return 'dbml'
    default: return null
  }
}

function planSummary(plan: DdlImportPlan): {
  added: number; columns: number; indexes: number; relationships: number; groups: number
} {
  return {
    added: plan.tables.length,
    columns: plan.tables.reduce((n, t) => n + t.columns.length, 0),
    indexes: plan.tables.reduce((n, t) => n + t.indexes.length, 0),
    relationships: plan.relationships.length,
    groups: plan.groups.length,
  }
}

/**
 * DDL·DBML 파일을 로컬 파일 트리에 가져온다. **웹의 「DDL·DBML 가져오기」와 같은 경로다**
 * (`parseDdl`/`parseDbml` → `planDdlImport` → `applyDdlImport`) — 그래서 머지 동작도 같다:
 * 만들어질 이름이 기존 테이블과 겹치면 **그 테이블은 건너뛰고**(`skippedTables`) 기존 파일은
 * 손대지 않으며, DDL 에 없는 기존 테이블도 지우지 않는다.
 *
 * ⚠️ **신규 엔티티의 id 는 `uuidv7()` 로 파일에 바로 박는다**(HANDOFF 3.9 의 push 관례와 같다).
 * `filesToModel` 에도 `newId` 를 준다 — 안 주면 id 없는 사용자 파일이 `new:` 임시 id 를 받고,
 * 그 모델을 그대로 `modelToFiles` 로 되쓰면 **임시 id 가 파일에 새어 나간다.**
 *
 * ⚠️ **서버 반영은 하지 않는다.** `.erdd/base.json`·`sync.json` 을 건드리지 않으므로 가져온
 * 결과는 `status` 에 로컬 변경으로 보이고, 반영은 기존대로 `erdd push` 다.
 *
 * ⚠️ **`writeTree` 가 파일명을 물리명 기준으로 정규화한다**(`syncDown` 과 같은 동작) — 사용자가
 * 직접 지은 파일명은 이 명령을 지나면 `<물리명>.yaml` 로 재작성된다.
 */
export function importCommand(ctx: ImportCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.file === undefined || ctx.file === '') {
      throw new CliError('USAGE', '가져올 파일 경로가 필요합니다: erdd import <파일>')
    }
    const config = await readConfig(ctx.cwd)
    const path = resolve(ctx.cwd, ctx.file)

    const format = ctx.format ?? formatFromExtension(path)
    if (format === null) {
      throw new CliError(
        'USAGE',
        `${ctx.file}의 형식을 확장자로 정할 수 없습니다 — --format ddl 또는 --format dbml을 주세요`
          + '(확장자는 .sql·.ddl이면 ddl, .dbml이면 dbml입니다)',
      )
    }

    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new CliError('NOT_FOUND', `파일을 찾을 수 없습니다: ${path}`)
      }
      throw err
    }

    const dialect = ctx.dialect ?? detectDialect(text) ?? config.dialects[0]!

    // 신규 id 는 여기서부터 최종 값이다 — filesToModel 의 발급도 uuidv7 로 맞춰 임시 id 가
    // 모델에 들어오지 않게 한다(위 ⚠️).
    const result = filesToModel(await readTree(ctx.cwd), { newId: uuidv7 })
    if (!result.ok) {
      emit(
        ctx.json,
        [`파싱 오류 ${result.issues.length}건`, ...result.issues.map((i) => `  ${i.path}: ${i.message}`)].join('\n'),
        { ok: false, parseErrors: result.issues, integrityIssues: [], warnings: [] },
      )
      return 1
    }

    const parsed = format === 'ddl' ? parseDdl(text) : parseDbml(text)
    const plan = planDdlImport(result.model, parsed, dialect, config.namingRules)
    const summary = planSummary(plan)
    const warningLines = plan.warnings.map((w) => `  [${w.kind}] ${w.target}: ${w.message}`)
    const humanHead = [
      `${format} ${dialect} · 추가 ${summary.added}개 테이블`
        + `(컬럼 ${summary.columns} · 인덱스 ${summary.indexes} · 관계 ${summary.relationships}`
        + `${summary.groups > 0 ? ` · 그룹 ${summary.groups}` : ''})`,
      ...(plan.skippedTables.length > 0
        ? [`이미 있는 이름이라 건너뛴 테이블 ${plan.skippedTables.length}개: ${plan.skippedTables.join(', ')}`]
        : []),
      ...(plan.warnings.length > 0 ? [`경고 ${plan.warnings.length}건`, ...warningLines] : []),
    ]
    const payload = {
      ok: true,
      format, dialect, dryRun: ctx.dryRun,
      ...summary,
      skipped: plan.skippedTables,
      warnings: plan.warnings,
      written: [] as string[],
      deleted: [] as string[],
    }

    if (ctx.dryRun) {
      emit(ctx.json, [...humanHead, '--dry-run이라 파일을 쓰지 않았습니다'].join('\n'), payload)
      return 0
    }

    if (!ctx.yes) {
      for (const line of humanHead) note(line)
      // push의 confirmDeletes와 같은 문구다 — 아무도 취소하지 않았는데 "취소했습니다"라고 하면
      // 이 CLI의 주 소비자(에이전트)가 원인도 해결책도 알 수 없다.
      if (ctx.confirm === undefined) {
        throw new CliError('CANCELLED', '파일을 덮어씁니다 — 비대화형(--json)에서는 --yes를 함께 주세요')
      }
      if (!await ctx.confirm('로컬 파일에 반영할까요?')) {
        throw new CliError('CANCELLED', '사용자가 취소했습니다')
      }
    }

    const next = applyDdlImport(result.model, plan, uuidv7)
    const { tree, issues } = modelToFiles(next)
    for (const i of issues) note(`경고: ${i.path}: ${i.message}`)
    const { written, deleted } = await writeTree(ctx.cwd, tree)

    emit(ctx.json, [...humanHead, `파일 ${written.length}개를 썼습니다. erdd push로 서버에 반영하세요`].join('\n'), {
      ...payload, written, deleted,
    })
    return 0
  })
}
