import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Dialect, NamingRules } from '@erdd/core'
import { createClient, type ApiClient } from '../client.js'
import { CONFIG_FILE, ensureGitignore, writeConfig, writeToken } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { run, type CommandCtx } from './context.js'

export type InitCtx = CommandCtx & {
  serverUrl?: string
  token?: string
  projectId?: string
  prompt?: (question: string) => Promise<string>
  choose?: (question: string, options: { id: string; label: string }[]) => Promise<string>
}

async function ask(ctx: InitCtx, question: string): Promise<string> {
  if (ctx.prompt === undefined) throw new CliError('USAGE', `${question} — 비대화형에서는 인자로 주세요`)
  return (await ctx.prompt(question)).trim()
}

export function init(ctx: InitCtx): Promise<number> {
  return run(ctx, async () => {
    if (existsSync(join(ctx.cwd, CONFIG_FILE)) && !ctx.yes) {
      note(`${CONFIG_FILE}이 이미 있습니다.`)
      const ok = ctx.confirm === undefined ? false : await ctx.confirm('덮어쓸까요?')
      if (!ok) throw new CliError('CANCELLED', '사용자가 취소했습니다')
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
      name: string; dialects: Dialect[]; namingRules: NamingRules
    }>('project.get', { projectId })

    await writeConfig(ctx.cwd, {
      serverUrl, projectId, dialects: project.dialects, namingRules: project.namingRules,
    })
    await writeToken(ctx.cwd, token)
    await ensureGitignore(ctx.cwd)

    emit(ctx.json, `${project.name}에 연결했습니다. erdd pull로 스키마를 받으세요.`, {
      configPath: CONFIG_FILE, projectId, projectName: project.name,
    })
    return 0
  })
}
