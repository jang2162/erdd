import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import {
  createEmptyModel, DEFAULT_NAMING_RULES, DEFAULT_TABLE_OPTIONS, modelToFiles,
  NamingRulesStrictSchema, TableOptionsStrictSchema,
  type Dialect, type NamingRules, type TableOptions,
} from '@erdd/core'
import { createClient, type ApiClient } from '../client.js'
import {
  CONFIG_FILE, ensureGitignore, readConfig, writeBase, writeConfig, writeSync, writeToken,
  type DictionaryRef,
} from '../config.js'
import { CliError, emit, note } from '../output.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
import { readTree, writeTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

export type InitCtx = CommandCtx & {
  serverUrl?: string
  token?: string
  projectId?: string
  /**
   * --local 전용. 연결 모드에서는 서버 프로젝트 설정이 진실이라 이 둘을 받지 않는다
   * (main.ts가 함께 준 것을 USAGE로 세운다).
   */
  dialect?: Dialect
  namingCase?: NamingRules['case']
  /** --create: 서버에 프로젝트를 만들고 연결한다. 로컬 전용 config 가 있으면 그것을 이관한다. */
  create?: boolean
  /** --create 전용 — 프로젝트를 만들 조직(이름 또는 id). */
  org?: string
  /** --create 전용 — 서버에 만들 프로젝트 이름. */
  name?: string
  prompt?: (question: string) => Promise<string>
  choose?: (question: string, options: { id: string; label: string }[]) => Promise<string>
}

/**
 * config 에 쓰는 서버 URL 의 한 모양. `createClient` 가 끝 슬래시를 떼므로 `https://x/` 와 `https://x` 는
 * 같은 서버다 — 저장값이 갈리면 재-init 이 같은 서버를 다른 서버로 읽어 구독을 지운다.
 */
function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

async function ask(ctx: InitCtx, question: string): Promise<string> {
  if (ctx.prompt === undefined) throw new CliError('USAGE', `${question} — 비대화형에서는 인자로 주세요`)
  return (await ctx.prompt(question)).trim()
}

export function init(ctx: InitCtx): Promise<number> {
  return run(ctx, async () => {
    const configExists = existsSync(join(ctx.cwd, CONFIG_FILE))
    // --local 은 --yes 로도 덮어쓰지 않는다 — 연결된 초기화와 달리 재확인할 서버 프로젝트가
    // 없어서, 뒤덮으면 기존 로컬 config(방언·명명 규칙)를 조용히 잃는다.
    if (configExists && ctx.local === true) {
      throw new CliError('CANCELLED', `${CONFIG_FILE}이 이미 있습니다. 지우고 다시 실행하세요`)
    }
    if (ctx.create === true) return createAndConnect(ctx, configExists)
    if (configExists && !ctx.yes) {
      note(`${CONFIG_FILE}이 이미 있습니다.`)
      const ok = ctx.confirm === undefined ? false : await ctx.confirm('덮어쓸까요?')
      if (!ok) throw new CliError('CANCELLED', '사용자가 취소했습니다')
    }

    if (ctx.local === true) {
      // 서버 왕복이 전부 없다. 방언과 대소문자 규칙만 여기서 정하고, 나머지 명명 규칙
      // (separator·logicalSeparator·maxLengthBytes·템플릿)은 기본값으로 시작해 이후 GUI 의
      // 설정 화면이나 erdd.config.yaml 직접 편집으로 바꾼다.
      await writeConfig(ctx.cwd, {
        serverUrl: null,
        projectId: null,
        dialects: [ctx.dialect ?? 'postgresql'],
        namingRules: { ...DEFAULT_NAMING_RULES, case: ctx.namingCase ?? DEFAULT_NAMING_RULES.case },
        tableOptions: { ...DEFAULT_TABLE_OPTIONS },
        dictionaries: [],
      })
      await ensureGitignore(ctx.cwd)
      emit(ctx.json, '로컬 전용 프로젝트를 만들었습니다. erdd serve로 여세요', { local: true })
      return 0
    }

    const serverUrl = normalizeServerUrl(ctx.serverUrl ?? await ask(ctx, '서버 URL을 입력하세요'))
    const token = ctx.token ?? await ask(ctx, '액세스 토큰을 입력하세요')
    const client: ApiClient = ctx.client ?? createClient(serverUrl, token)

    // 토큰이 실제로 통하는지 먼저 확인한다 — 잘못된 토큰으로 config를 만들지 않는다.
    await client.query('auth.me', {})

    let projectId = ctx.projectId
    if (projectId === undefined) {
      if (ctx.choose === undefined) throw new CliError('USAGE', '--project를 주거나 대화형으로 실행하세요')
      const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
      if (orgs.length === 0) throw new CliError('NOT_FOUND', '접근 가능한 조직이 없습니다')
      const orgId = await ctx.choose('조직을 고르세요', orgs.map((o) => ({ id: o.id, label: o.name })))
      const projects = await client.query<{ id: string; name: string }[]>('project.list', { orgId })
      if (projects.length === 0) throw new CliError('NOT_FOUND', '접근 가능한 프로젝트가 없습니다')
      projectId = await ctx.choose('프로젝트를 고르세요', projects.map((p) => ({ id: p.id, label: p.name })))
    }

    const project = await client.query<{
      name: string; dialects: Dialect[]; namingRules: NamingRules; tableOptions?: TableOptions
    }>('project.get', { projectId })

    await writeConfig(ctx.cwd, {
      serverUrl, projectId, dialects: project.dialects, namingRules: project.namingRules,
      tableOptions: project.tableOptions ?? { ...DEFAULT_TABLE_OPTIONS },
      dictionaries: configExists ? await keptSubscriptions(ctx.cwd, serverUrl, projectId) : [],
    })
    await writeToken(ctx.cwd, token)
    await ensureGitignore(ctx.cwd)

    emit(ctx.json, `${project.name}에 연결했습니다. erdd pull로 스키마를 받으세요.`, {
      configPath: CONFIG_FILE, projectId, projectName: project.name,
    })
    return 0
  })
}

/**
 * 재-init 이 이어받을 구독. **같은 서버의 같은 프로젝트로 다시 연결할 때만** 잇는다 — 토큰을
 * 갈아 끼우려는 재-init 이 구독을 지우면 사용자는 인자 없는 dict pull 이 왜 아무것도 받지 않는지
 * 모른다. 다른 프로젝트면 그 구독은 옛 프로젝트의 선택이라 비운다.
 * 옛 config 가 깨져 있으면 이을 것이 없다 — 재-init 은 그 config 를 덮어 고치는 길이라 막지 않는다.
 */
async function keptSubscriptions(cwd: string, serverUrl: string, projectId: string): Promise<DictionaryRef[]> {
  let old
  try {
    old = await readConfig(cwd)
  } catch (err) {
    if (err instanceof CliError) return []
    throw err
  }
  // 옛 config 는 정규화 전에 저장됐을 수 있어 양쪽을 같은 모양으로 맞춰 비교한다.
  const sameServer = old.serverUrl !== null && normalizeServerUrl(old.serverUrl) === serverUrl
  return sameServer && old.projectId === projectId ? old.dictionaries : []
}

/** 서버 `project.create` 의 입력 스키마로 config 값을 먼저 읽어, 틀린 키를 사람이 읽는 문구로 알린다. */
function assertServerSettings(field: 'namingRules' | 'tableOptions', schema: z.ZodType, value: unknown): void {
  const result = schema.safeParse(value)
  if (result.success) return
  const key = result.error.issues[0]?.path[0]
  throw new CliError('VALIDATION', `${CONFIG_FILE}의 ${key === undefined ? field : `${field}.${String(key)}`}가 올바르지 않습니다`)
}

/**
 * 서버에 빈 프로젝트를 만들고 연결한다. 로컬 전용 config 가 있으면 그 규칙으로 만들고 `erdd/` 는
 * 건드리지 않는다 — 기준선을 **빈 모델**로 두므로 다음 `erdd push` 가 로컬 스키마 전부를 「추가」로 올린다.
 * `pull` 로 빈 서버 상태를 받아 덮은 뒤 되얹던 수동 절차를 대체한다.
 */
async function createAndConnect(ctx: InitCtx, configExists: boolean): Promise<number> {
  const existing = configExists ? await readConfig(ctx.cwd) : null
  if (existing !== null && existing.projectId !== null) {
    throw new CliError('VALIDATION', '이미 서버 프로젝트에 연결돼 있습니다 — 다른 프로젝트로 바꾸려면 erdd init --project <id> --yes')
  }
  if (existing !== null && (ctx.dialect !== undefined || ctx.namingCase !== undefined)) {
    throw new CliError('USAGE', `로컬 프로젝트를 이관할 때는 ${CONFIG_FILE}의 방언·명명 규칙을 씁니다 — --dialect·--case를 빼세요`)
  }
  // 서버 입력은 strict 스키마(모든 키 필수)다. 이관 쪽은 readConfig 가 옛 config 의 누락 키
  // (logicalSeparator·템플릿·테이블 옵션)를 이미 채워 두었다.
  const settings = existing ?? {
    dialects: [ctx.dialect ?? 'postgresql'] as Dialect[],
    namingRules: { ...DEFAULT_NAMING_RULES, case: ctx.namingCase ?? DEFAULT_NAMING_RULES.case },
    tableOptions: { ...DEFAULT_TABLE_OPTIONS },
  }
  // readConfig 는 형(문자열·숫자)만 보고 enum·양의 정수는 보지 않는다. 손으로 틀린 값을 적은 config 를
  // 서버에 보내면 zod 이슈 JSON 이 그대로 오류 문구가 된다 — 서버와 같은 스키마로 먼저 읽을 수 있게 멈춘다.
  assertServerSettings('namingRules', NamingRulesStrictSchema, settings.namingRules)
  assertServerSettings('tableOptions', TableOptionsStrictSchema, settings.tableOptions)

  // 기준선(빈 모델)과 erdd/ 가 어긋나지 않게 한다. 비어 있으면 빈 서버를 pull 한 것처럼 빈 트리를
  // 쓴다 — 안 쓰면 base 만 파일을 갖고 erdd/ 는 비어, push·diff 가 「erdd/ 아래에 파일이 없습니다」로
  // 막힌다. 파일이 있으면(이관) 한 바이트도 건드리지 않는다. 서버에 만들기 **전에** 읽는다 —
  // 읽다 실패하면(YAML 오류) 반쯤 만들어진 서버 프로젝트가 남는다.
  const writeEmptyTree = Object.keys(await readTree(ctx.cwd)).length === 0

  const name = ctx.name ?? await ask(ctx, '서버에 만들 프로젝트 이름을 입력하세요')
  if (name === '') throw new CliError('USAGE', '프로젝트 이름이 비었습니다')
  if (existing !== null && !ctx.yes) {
    const ok = ctx.confirm === undefined ? false : await ctx.confirm(`이 로컬 프로젝트를 서버 프로젝트 "${name}"로 연결합니다. 계속할까요?`)
    if (!ok) {
      throw new CliError('CANCELLED', ctx.confirm === undefined
        ? '확인이 필요합니다 — 비대화형(--json)에서는 --yes를 함께 주세요' : '사용자가 취소했습니다')
    }
  }

  const serverUrl = normalizeServerUrl(ctx.serverUrl ?? await ask(ctx, '서버 URL을 입력하세요'))
  const token = ctx.token ?? await ask(ctx, '액세스 토큰을 입력하세요')
  const client: ApiClient = ctx.client ?? createClient(serverUrl, token)
  // 토큰이 실제로 통하는지 먼저 확인한다 — 잘못된 토큰으로 config를 만들지 않는다.
  await client.query('auth.me', {})

  const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
  let orgId: string
  if (ctx.org !== undefined) {
    const hit = orgs.filter((o) => o.id === ctx.org || o.name === ctx.org)
    if (hit.length !== 1) {
      throw new CliError(hit.length === 0 ? 'NOT_FOUND' : 'USAGE',
        hit.length === 0 ? `조직 ${ctx.org}을(를) 찾지 못했습니다` : `이름이 ${ctx.org}인 조직이 여럿입니다 — id로 지정하세요`)
    }
    orgId = hit[0]!.id
  } else {
    if (ctx.choose === undefined) throw new CliError('USAGE', '--org를 주거나 대화형으로 실행하세요')
    if (orgs.length === 0) throw new CliError('NOT_FOUND', '접근 가능한 조직이 없습니다')
    orgId = await ctx.choose('조직을 고르세요', orgs.map((o) => ({ id: o.id, label: o.name })))
  }

  let project: { id: string; name: string }
  try {
    project = await client.mutate('project.create', {
      orgId, name, dialects: settings.dialects,
      namingRules: settings.namingRules, tableOptions: settings.tableOptions,
    })
  } catch (err) {
    if (err instanceof CliError && err.code === 'FORBIDDEN') {
      // 이관 중에는 --project 로 연결하라고 보내지 않는다 — 그 연결에는 기준선이 없어 다음 pull 이
      // erdd/ 를 서버의 빈 상태로 덮는다. 커밋해 두고 되얹는 수동 절차가 그 함정을 피한다.
      throw new CliError('FORBIDDEN', existing !== null
        ? '프로젝트 생성 권한이 없습니다 — 조직 관리자에게 빈 프로젝트를 만들어 달라고 한 뒤, erdd/ 를 git 에 커밋하고 매뉴얼 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 절차를 따르세요'
        : '프로젝트 생성 권한이 없습니다 — 조직 관리자에게 프로젝트를 만들어 달라고 한 뒤 erdd init --project <id> 로 연결하세요')
    }
    throw err
  }

  // 기준선 = 빈 서버 프로젝트. push 가 요구하는 base 를 pull 없이 세운다.
  // ⚠️ config 를 **마지막에** 쓴다 — config 가 커밋 지점이다. 먼저 쓰면 그 뒤에서 끊겼을 때 base 없이
  // 연결된 config 가 남고, 사용자의 자연스러운 다음 수(erdd pull)가 erdd/ 를 서버의 빈 상태로 덮는다.
  // 이 순서면 중간 실패는 「로컬 전용(또는 없는) config + 쓸모없는 base」로 남는다 — 로컬 모드는
  // base 를 읽지 않고, 재실행이 전부 다시 쓴다. 남는 것은 서버의 빈 프로젝트 하나뿐이다.
  const emptyTree = modelToFiles(createEmptyModel()).tree
  await writeToken(ctx.cwd, token)
  if (writeEmptyTree) await writeTree(ctx.cwd, emptyTree)
  await writeBase(ctx.cwd, emptyTree)
  await writeSync(ctx.cwd, { revisionSeq: 0, pulledAt: new Date().toISOString() })
  await ensureGitignore(ctx.cwd)
  await writeConfig(ctx.cwd, {
    serverUrl, projectId: project.id, dialects: settings.dialects,
    namingRules: settings.namingRules, tableOptions: settings.tableOptions,
    dictionaries: existing?.dictionaries ?? [],
  })

  // push 는 저장된 파일만 올린다 — 미저장 편집은 serve 에서 저장해야 이관에 실린다.
  if (existing !== null && await hasDraft(ctx.cwd)) note(UNSAVED_NOTICE)
  emit(ctx.json, existing !== null
    ? `서버 프로젝트 ${project.name}을(를) 만들어 연결했습니다. erdd diff로 확인한 뒤 erdd push로 올리세요.`
    : `서버 프로젝트 ${project.name}을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.`,
  { configPath: CONFIG_FILE, projectId: project.id, projectName: project.name, migrated: existing !== null })
  return 0
}
