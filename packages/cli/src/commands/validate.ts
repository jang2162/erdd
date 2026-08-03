import { computeWarnings, filesToModel, validateModelIntegrity } from '@erdd/core'
import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { readTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

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
    const warnings = computeWarnings(result.model, config.namingRules, config.dialects)
    const ok = integrityIssues.length === 0 && (!ctx.strict || warnings.length === 0)

    const human = [
      integrityIssues.length === 0 ? '정합성 문제 없음' : `정합성 오류 ${integrityIssues.length}건`,
      ...integrityIssues.map((i) => `  ${JSON.stringify(i)}`),
      warnings.length === 0 ? '명명 경고 없음' : `명명 경고 ${warnings.length}건`,
      ...warnings.map((w) => `  ${w.message}`),
    ].join('\n')

    emit(ctx.json, human, {
      ok,
      parseErrors: [], integrityIssues, warnings,
    })
    return ok ? 0 : 1
  })
}
