import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CHANGESET_EXT, changesetFileName, changesetStamp, composeChangeset, formatStatements, planChanges,
  stampToIso,
  type ChangesetSource, type ChangesPlan, type LocalChangesCreateResult, type LocalChangesStatus,
  type PlanInput, type ProjectModel,
} from '@erdd/core'
import type { ErddConfig } from '../config.js'

/**
 * 변경 기록 디렉터리. `erdd/` 아래라 커밋 대상이다. 트리 로더(`readTree`)는 `TOP_LEVEL_FILES` 와
 * `tables/` 만 읽으므로 여기를 모델로 오인하지 않는다.
 */
export const CHANGES_DIR = 'erdd/changes'

export type ChangesContext = {
  cwd: string
  model: ProjectModel
  config: Pick<ErddConfig, 'namingRules' | 'dialects'>
}

/** `.erddc` 만, 파일명 코드 단위 사전순으로. `README.md`·`.gitkeep` 같은 것은 건너뛴다. */
export async function readChangeSources(cwd: string): Promise<ChangesetSource[]> {
  let names: string[]
  try {
    names = await readdir(join(cwd, CHANGES_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const files = names.filter((n) => n.endsWith(CHANGESET_EXT)).sort()
  return Promise.all(files.map(async (n) => ({
    file: `${CHANGES_DIR}/${n}`,
    text: await readFile(join(cwd, CHANGES_DIR, n), 'utf8'),
  })))
}

export async function loadChangesPlan(ctx: ChangesContext): Promise<{ plan: ChangesPlan; input: PlanInput }> {
  const input: PlanInput = {
    sources: await readChangeSources(ctx.cwd),
    model: ctx.model,
    settings: { rules: ctx.config.namingRules, dialects: ctx.config.dialects },
  }
  return { plan: planChanges(input), input }
}

export function toLocalStatus(plan: ChangesPlan, unsaved: boolean): LocalChangesStatus {
  return {
    records: plan.records,
    pending: plan.pending === null ? null : { text: formatStatements(plan.pending), count: plan.pending.length },
    warnings: plan.warnings,
    error: plan.error,
    unsaved,
  }
}

/**
 * 새 기록을 쓴다. 판정·자기검증은 core 의 `composeChangeset` 이 하고 여기는 파일만 다룬다.
 * `wx` — 같은 이름이 이미 있으면(두 곳에서 동시에 만든 경우) 덮어쓰지 않고 실패한다.
 */
export async function writeChange(
  ctx: ChangesContext, opts: { name: string; baseline: boolean; now?: Date },
): Promise<LocalChangesCreateResult> {
  const { plan, input } = await loadChangesPlan(ctx)
  const stamp = changesetStamp(opts.now ?? new Date(), input.sources.map((s) => s.file))
  const composed = composeChangeset(plan, input, { name: opts.name, created: stampToIso(stamp), baseline: opts.baseline })
  if (!composed.ok) return composed
  const fileName = changesetFileName(stamp, opts.name)
  await mkdir(join(ctx.cwd, CHANGES_DIR), { recursive: true })
  await writeFile(join(ctx.cwd, CHANGES_DIR, fileName), composed.text, { encoding: 'utf8', flag: 'wx' })
  return { ok: true, file: `${CHANGES_DIR}/${fileName}`, statementCount: composed.statementCount }
}
