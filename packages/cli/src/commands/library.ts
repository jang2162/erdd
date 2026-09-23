import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import {
  RESOURCE_KIND_LABEL, dictIssueText, formatLibraryFileIssues, libraryDocFromDictSheets, parseLibraryFile,
  resourceDisplayName, stringifyLibraryFile, type LibraryImportSummary,
} from '@erdd/core'
import { createClient, type ApiClient } from '../client.js'
import { readConfig, resolveToken } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { readDictSheetsFile } from '../xlsx.js'
import { run, type CommandCtx } from './context.js'
import { guardFeature, resolveLibrary, type LibraryRow } from './dict-shared.js'

export type LibraryCtx = CommandCtx & { server?: string }
type ListedLibrary = LibraryRow & { orgName: string | null }

/**
 * 라이브러리 관리 명령은 프로젝트 없이 돈다 — 관리자가 CI·빈 디렉터리에서 부른다. 서버 주소는
 * --server, 없으면 erdd.config.yaml 의 serverUrl. 토큰은 다른 명령과 같은 resolveToken 순서다.
 */
async function libraryClient(ctx: LibraryCtx): Promise<ApiClient> {
  if (ctx.client !== undefined) return ctx.client
  let serverUrl = ctx.server
  if (serverUrl === undefined) {
    try {
      serverUrl = (await readConfig(ctx.cwd)).serverUrl ?? undefined
    } catch (err) {
      if (!(err instanceof CliError && err.code === 'NO_CONFIG')) throw err
    }
  }
  if (serverUrl === undefined) {
    throw new CliError('USAGE', '서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요')
  }
  return createClient(serverUrl, await resolveToken(ctx.cwd))
}

async function listAll(client: ApiClient): Promise<ListedLibrary[]> {
  const globals = await guardFeature(() => client.query<LibraryRow[]>('resource.library.list', { scope: 'global' }))
  const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
  const rows: ListedLibrary[] = globals.map((r) => ({ ...r, orgName: null }))
  for (const org of orgs) {
    const libs = await guardFeature(() => client.query<LibraryRow[]>('resource.library.list', { scope: 'org', orgId: org.id }))
    rows.push(...libs.map((r) => ({ ...r, orgName: org.name })))
  }
  return rows
}

export function libraryList(ctx: LibraryCtx): Promise<number> {
  return run(ctx, async () => {
    const rows = await listAll(await libraryClient(ctx))
    const human = rows.length === 0 ? '볼 수 있는 라이브러리가 없습니다' : rows.map((r) =>
      `  ${r.name} — ${r.scope === 'global' ? '전역' : `조직 ${r.orgName}`} · 항목 ${r.itemCount}${r.canWrite ? ' · 쓰기 가능' : ''} · ${r.id}`,
    ).join('\n')
    emit(ctx.json, human, rows)
    return 0
  })
}

export function libraryExport(ctx: LibraryCtx & { ref: string | undefined; out?: string }): Promise<number> {
  return run(ctx, async () => {
    if (ctx.ref === undefined) throw new CliError('USAGE', '사용법: erdd library export <이름|id> [-o 파일]')
    const client = await libraryClient(ctx)
    const lib = resolveLibrary(await listAll(client), ctx.ref)
    const res = await guardFeature(() => client.query<{ libraryId: string; name: string; text: string; danglingDomainRefs: number }>(
      'resource.library.export', { libraryId: lib.id }))
    if (res.danglingDomainRefs > 0) note(`삭제된 도메인을 가리키던 용어 ${res.danglingDomainRefs}건은 도메인 없이 내보냈습니다`)
    if (ctx.out !== undefined) {
      await writeFile(resolve(ctx.cwd, ctx.out), res.text, 'utf8')
      emit(ctx.json, `내보냈습니다 — ${ctx.out}`, { libraryId: res.libraryId, file: ctx.out, danglingDomainRefs: res.danglingDomainRefs })
    } else if (ctx.json) {
      emit(true, '', res)
    } else {
      process.stdout.write(res.text)
    }
    return 0
  })
}

export type LibraryImportCtx = LibraryCtx & {
  file: string | undefined
  library?: string
  create?: string
  scope?: 'global' | 'org'
  org?: string
  prune: boolean
  includeStale: boolean
  dryRun: boolean
}
type ImportResponse = { libraryId: string | null; applied: boolean; stateHash: string; summary: LibraryImportSummary }

const num = (n: number): string => n.toLocaleString('en-US')

function render(title: string, s: LibraryImportSummary, opts: { prune: boolean; includeStale: boolean }): string {
  const c = s.counts
  const removable = c.remove - c.removeBlocked
  const deleted = opts.prune ? removable : 0
  const lines = [title]
  let summary = `  추가 ${num(c.add)} · 갱신 ${num(c.update + (opts.includeStale ? c.stale : 0))} · 그대로 ${num(c.unchanged)} · 삭제 ${num(deleted)}`
  if (!opts.prune && removable > 0) summary += ` (--prune 이 없어 파일에 없는 ${num(removable)}건은 남김)`
  lines.push(summary)
  const stale = s.entries.filter((e) => e.status === 'stale')
  if (stale.length > 0) {
    lines.push(`  오래된 파일 ${stale.length} — ${opts.includeStale ? '덮어씀' : '건너뜀 (--include-stale 로 덮어쓰기)'}:`)
    for (const e of stale) lines.push(`    ${RESOURCE_KIND_LABEL[e.kind]} ${e.name}  (서버 v${e.currentVersion}, 파일 v${e.fileVersion})`)
  }
  for (const w of s.warnings) lines.push(`  경고: ${w}`)
  return lines.join('\n')
}

async function readSourceText(ctx: LibraryImportCtx, client: ApiClient, libraryId: string | null): Promise<string> {
  const path = resolve(ctx.cwd, ctx.file!)
  if (extname(path).toLowerCase() === '.xlsx') {
    const sheets = await readDictSheetsFile(path)
    // 대상 라이브러리의 도메인 이름 — 용어의 「기본 도메인」이 파일에도 대상에도 없을 때만 경고하기 위해서다.
    const existing = libraryId === null ? [] : await client.query<{ kind: string; payload: Record<string, unknown> }[]>(
      'resource.items.list', { libraryId })
    const targetDomainNames = existing.filter((i) => i.kind === 'domain').map((i) => resourceDisplayName('domain', i.payload))
    const r = libraryDocFromDictSheets(sheets, { name: basename(path, extname(path)), targetDomainNames })
    if (!r.ok) {
      throw new CliError('VALIDATION', [`Excel 오류 ${r.issues.length}건 — 아무것도 반영하지 않았습니다`,
        ...r.issues.slice(0, 20).map((i) => `  ${dictIssueText(i)}`)].join('\n'))
    }
    for (const w of r.warnings) note(`경고: ${dictIssueText(w)}`)
    return stringifyLibraryFile(r.doc)
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new CliError('VALIDATION', `파일을 읽지 못했습니다: ${ctx.file} — ${(err as Error).message}`)
  }
  const parsed = parseLibraryFile(text, 'source')
  if (!parsed.ok) {
    throw new CliError('VALIDATION', [`라이브러리 파일 오류 ${parsed.issues.length}건 — 아무것도 반영하지 않았습니다`,
      ...formatLibraryFileIssues(parsed.issues).map((l) => `  ${l}`)].join('\n'))
  }
  return text
}

export function libraryImport(ctx: LibraryImportCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.file === undefined) throw new CliError('USAGE', '사용법: erdd library import <파일> (--library <이름|id> | --create <이름> --scope <global|org>)')
    if ((ctx.library === undefined) === (ctx.create === undefined)) {
      throw new CliError('USAGE', '--library 와 --create 중 정확히 하나를 주세요')
    }
    if (ctx.create !== undefined && ctx.scope === undefined) throw new CliError('USAGE', '--create 에는 --scope <global|org> 가 필요합니다')
    if (ctx.create !== undefined && ctx.scope === 'org' && ctx.org === undefined) throw new CliError('USAGE', '--scope org 에는 --org <이름|id> 가 필요합니다')

    const client = await libraryClient(ctx)
    let target: Record<string, unknown>
    let title: string
    let libraryId: string | null = null
    if (ctx.library !== undefined) {
      const lib = resolveLibrary(await listAll(client), ctx.library)
      if (!lib.canWrite) throw new CliError('FORBIDDEN', `${lib.name} 에 쓸 권한이 없습니다`)
      libraryId = lib.id
      target = { libraryId: lib.id }
      title = `${lib.name} (${lib.scope === 'global' ? '전역' : '조직'})`
    } else {
      let orgId: string | undefined
      if (ctx.scope === 'org') {
        const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
        const hit = orgs.find((o) => o.id === ctx.org) ?? orgs.filter((o) => o.name === ctx.org)
        if (Array.isArray(hit)) {
          if (hit.length !== 1) throw new CliError(hit.length === 0 ? 'NOT_FOUND' : 'USAGE', `조직 ${ctx.org}을(를) ${hit.length === 0 ? '찾지 못했습니다' : '하나로 고를 수 없습니다 — id 로 지정하세요'}`)
          orgId = hit[0]!.id
        } else orgId = hit.id
      }
      target = { create: { scope: ctx.scope, ...(orgId !== undefined ? { orgId } : {}), name: ctx.create, description: '' } }
      title = `${ctx.create} (${ctx.scope === 'global' ? '전역' : '조직'}, 새로 만듦)`
    }

    const text = await readSourceText(ctx, client, libraryId)
    const opts = { prune: ctx.prune, includeStale: ctx.includeStale }
    const call = (extra: Record<string, unknown>) => guardFeature(() => client.mutate<ImportResponse>(
      'resource.library.import', { target, text, ...opts, ...extra }))

    if (ctx.yes && !ctx.dryRun) {
      const res = await applyOrExplain(() => call({ dryRun: false }))
      emit(ctx.json, render(title, res.summary, opts), res)
      return 0
    }
    const preview = await call({ dryRun: true })
    if (ctx.dryRun) {
      emit(ctx.json, `${render(title, preview.summary, opts)}\n미리보기입니다 — 반영하지 않았습니다`, preview)
      return 0
    }
    note(render(title, preview.summary, opts))
    const ok = ctx.confirm !== undefined && await ctx.confirm('가져올까요?')
    if (!ok) throw new CliError('CANCELLED', '취소했습니다 — 아무것도 반영하지 않았습니다')
    const res = await applyOrExplain(() => call({ dryRun: false, expectedStateHash: preview.stateHash }))
    emit(ctx.json, `${render(title, res.summary, opts)}\n반영했습니다`, res)
    return 0
  })
}

/** 적용 실패는 전부 아니면 전무라서 「아무것도 반영하지 않았습니다」를 명시한다. */
async function applyOrExplain<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (err instanceof CliError) throw new CliError(err.code, `${err.message} — 아무것도 반영하지 않았습니다`, { ...err.details })
    throw err
  }
}
