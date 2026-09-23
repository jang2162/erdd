import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_NAMING_RULES, DEFAULT_TABLE_OPTIONS,
  type Dialect, type NamingRules, type TableOptions,
} from '@erdd/core'
import { createClient, type ApiClient } from '../client.js'
import { CONFIG_FILE, ensureGitignore, writeConfig, writeToken } from '../config.js'
import { CliError, emit, note } from '../output.js'
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
  prompt?: (question: string) => Promise<string>
  choose?: (question: string, options: { id: string; label: string }[]) => Promise<string>
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

    const serverUrl = ctx.serverUrl ?? await ask(ctx, '서버 URL을 입력하세요')
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
      // 새 연결 = 새 프로젝트라 옛 config 의 구독을 잇지 않는다.
      dictionaries: [],
    })
    await writeToken(ctx.cwd, token)
    await ensureGitignore(ctx.cwd)

    emit(ctx.json, `${project.name}에 연결했습니다. erdd pull로 스키마를 받으세요.`, {
      configPath: CONFIG_FILE, projectId, projectName: project.name,
    })
    return 0
  })
}
