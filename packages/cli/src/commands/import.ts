import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { uuidv7 } from 'uuidv7'
import {
  applyDdlImport, detectDialect, dialectFromDatabaseType, filesToModel, modelToFiles,
  parseDbml, parseDdl, planDdlImport,
  type DdlImportPlan, type Dialect, type ParsedDbml, type ParsedDdl,
} from '@erdd/core'
import { readConfig, writeConfig, type ErddConfig } from '../config.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
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

/**
 * 어느 방언으로 읽을지와 **왜 그렇게 정했는지**. 근거를 함께 내는 이유는 조용히 고르지 않기
 * 위해서다 — 방언은 `fromDialectType` 의 타입 매핑을 가르므로 잘못 고르면 컬럼 타입이 조용히
 * 달라진다.
 *
 * ⚠️ **DDL 과 DBML 의 감지기가 다르다.** `detectDialect` 는 **DDL 텍스트 전용**이다 — DBML 의
 * 속성 문법(`[pk, increment, …]`)이 그 함수의 mssql 대괄호 식별자 시그니처를 **항상** 때려서,
 * DBML 에 태우면 다른 단서가 없는 한 언제나 mssql 이 나온다(실측: mysql 프로젝트가 낸 DBML 을
 * 되읽자 mssql 로 읽혔다). DBML 은 웹 다이얼로그와 같이 `Project { database_type }` 을 본다.
 */
function resolveDialect(
  explicit: Dialect | undefined, format: ExportFormat, text: string,
  parsed: ParsedDdl | ParsedDbml, config: ErddConfig,
): { dialect: Dialect; source: string } {
  if (explicit !== undefined) return { dialect: explicit, source: '--dialect' }
  if (format === 'ddl') {
    const detected = detectDialect(text)
    if (detected !== null) return { dialect: detected, source: '본문에서 감지' }
  } else {
    const dt = (parsed as ParsedDbml).databaseType
    const fromType = dt === null || dt === undefined ? null : dialectFromDatabaseType(dt)
    if (fromType !== null) return { dialect: fromType, source: 'Project의 database_type' }
  }
  return { dialect: config.dialects[0]!, source: 'erdd.config.yaml의 dialects[0]' }
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
    // 미저장 편집은 `erdd/` 에 없다 — 이 명령이 보는 것과 화면이 보는 것이 다르다.
    if (await hasDraft(ctx.cwd)) note(UNSAVED_NOTICE)
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
    const { dialect, source: dialectSource } = resolveDialect(ctx.dialect, format, text, parsed, config)
    const plan = planDdlImport(result.model, parsed, dialect, config.namingRules)
    const summary = planSummary(plan)

    // 테이블 옵션 반영 판정(설계 §5.5-3). **공통 규칙을 웹과 CLI 가 같이 쓴다**(3.19 의 정신):
    //   비어 있다 → 반영 / 채택값과 같다 → 아무 일도 없음 / 값이 있고 다르다 → 반영하지 않고 알림.
    // ⚠️ 조용히 정하지 않는다 — 무엇을 했는지 사람용 출력과 --json 에 함께 싣는다
    // (`dialectSource` 를 싣는 것과 같은 정신).
    const currentOption = config.tableOptions[dialect]
    const tableOptionsApplied = plan.tableOptions !== null && currentOption.trim() === ''
    const tableOptionsConflict = plan.tableOptions !== null
      && currentOption.trim() !== '' && currentOption !== plan.tableOptions
    const optionLines = tableOptionsApplied
      ? [
          `테이블 옵션 '${plan.tableOptions!}'을 erdd.config.yaml 의 ${dialect} 칸에 반영합니다`,
          // ⚠️ 이 한 줄이 없으면 사용자는 서버에도 들어간 줄 안다.
          ...(config.projectId !== null
            ? ['  (서버 프로젝트 설정에는 반영되지 않습니다 — 다음 erdd pull 이 이 값을 덮어씁니다)']
            : []),
        ]
      : tableOptionsConflict
        ? [`테이블 옵션 '${plan.tableOptions!}'은 erdd.config.yaml 의 ${dialect} 칸`
            + `('${currentOption}')과 달라 반영하지 않았습니다 — 바꾸려면 그 파일을 직접 고치세요`]
        : []
    const warningLines = plan.warnings.map((w) => `  [${w.kind}] ${w.target}: ${w.message}`)
    const humanHead = [
      `${format} · 방언 ${dialect}(${dialectSource}) · 추가 ${summary.added}개 테이블`
        + `(컬럼 ${summary.columns} · 인덱스 ${summary.indexes} · 관계 ${summary.relationships}`
        + `${summary.groups > 0 ? ` · 그룹 ${summary.groups}` : ''})`,
      ...(plan.skippedTables.length > 0
        ? [`이미 있는 이름이라 건너뛴 테이블 ${plan.skippedTables.length}개: ${plan.skippedTables.join(', ')}`]
        : []),
      ...(plan.warnings.length > 0 ? [`경고 ${plan.warnings.length}건`, ...warningLines] : []),
      ...optionLines,
    ]
    const payload = {
      ok: true,
      format, dialect, dialectSource, dryRun: ctx.dryRun,
      ...summary,
      skipped: plan.skippedTables,
      warnings: plan.warnings,
      tableOptions: plan.tableOptions,
      tableOptionsApplied,
      written: [] as string[],
      deleted: [] as string[],
    }

    if (ctx.dryRun) {
      emit(ctx.json, [...humanHead, '--dry-run이라 파일을 쓰지 않았습니다'].join('\n'), {
        ...payload, tableOptionsApplied: false,
      })
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

    // ⚠️ **설정 반영은 `applyDdlImport` 밖의 두 번째 동작이다** — 프로젝트 설정은 op 로그 밖이라
    // 실행 취소·되돌리기가 닿지 않는다(설계 §5.5-3).
    if (tableOptionsApplied) {
      await writeConfig(ctx.cwd, {
        ...config,
        tableOptions: { ...config.tableOptions, [dialect]: plan.tableOptions! },
      })
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
