#!/usr/bin/env -S npx tsx
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { DIALECTS, type Dialect } from '@erdd/core'
import { diff } from './commands/diff.js'
import { exportCommand, type ExportFormat } from './commands/export.js'
import { importCommand } from './commands/import.js'
import { init } from './commands/init.js'
import { pull } from './commands/pull.js'
import { push } from './commands/push.js'
import { serve } from './commands/serve.js'
import { skill } from './commands/skill.js'
import { status } from './commands/status.js'
import { validate } from './commands/validate.js'
import { CliError, emitError, note } from './output.js'

const USAGE = `사용법: erdd <명령> [옵션]

명령
  init         서버·토큰·프로젝트를 연결하고 erdd.config.yaml을 만든다
  pull         서버 스키마를 파일로 내려받는다
  push         로컬 파일의 변경을 서버에 반영한다
  diff         로컬 파일과 서버의 차이를 미리 본다
  status       연결 정보와 로컬 변경을 보여준다
  validate     서버 없이 파일을 검사한다
  export       로컬 파일을 DDL·DBML로 내보낸다(stdout 또는 -o 파일)
  import <파일> DDL·DBML 파일을 로컬 파일에 가져온다(머지 — 서버 반영은 push)
  serve        로컬 서버를 띄워 브라우저에서 편집한다(서버 연결 불필요)
  skill install 에이전트 스킬 문서를 프로젝트에 설치한다

옵션
  --json                기계용 JSON 출력
  --yes                 확인 프롬프트를 건너뛴다
  --strict              validate·diff에서 경고·충돌도 실패로 본다
  -m, --message <요약>  push의 Revision 요약
  --dir <경로>          skill install 전용 — 설치 위치
  --force               skill install 전용 — 기존 파일 덮어쓰기
  --server <url>        init 전용
  --token <token>       init 전용
  --project <id>        init 전용
  --local               init 전용 — 서버 연결 없이 로컬 전용 프로젝트를 만든다
  --format <ddl|dbml>   export·import 전용 — export 기본 ddl, import 기본 확장자 판별
  --dialect <방언>       export·import 전용 — 기본 erdd.config.yaml의 dialects[0]
  -o <경로>             export 전용 — 산출물을 쓸 파일(없으면 stdout)
  --dry-run             import 전용 — 계획만 보고 파일을 쓰지 않는다
  --port <번호>          serve 전용 — 기본 4300
  --no-open             serve 전용 — 브라우저를 자동으로 열지 않는다
  --help                이 도움말`

export function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const next = argv[i + 1]
  // 값 자리에 다음 플래그가 오면 값이 빠진 것이다 — 삼키면 엉뚱한 오류로 번진다.
  if (next === undefined || next.startsWith('--')) return undefined
  return next
}

/**
 * -m 같은 한 글자 플래그. flagValue와 같은 규칙 — 값 자리에 다음 "긴" 플래그(--로 시작)가
 * 오면 값이 빠진 것이다. 단일 대시로 시작하는 값(예: "-fix column")은 그대로 삼킨다 — 이
 * CLI의 단일 대시 토큰은 -m·-h뿐이고 -h는 배차 전에 이미 short-circuit되므로 혼동될 여지가
 * 없다. (한때 next.startsWith('-')로 단일 대시까지 거절했는데, 그러면 `-m "-fix column"`처럼
 * 하이픈으로 시작하는 요약이 조용히 사라지고 자동 요약으로 대체됐다.)
 */
export function shortFlagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`-${name}`)
  if (i < 0) return undefined
  const next = argv[i + 1]
  if (next === undefined || next.startsWith('--')) return undefined
  return next
}

/** 대화형 입력. --json일 때는 쓰지 않는다(stdout을 오염시키지 않기 위해). */
function interactive(json: boolean) {
  if (json) return {}
  const rl = () => createInterface({ input: process.stdin, output: process.stderr })
  return {
    prompt: async (q: string) => {
      const i = rl()
      try { return await i.question(`${q}: `) } finally { i.close() }
    },
    confirm: async (q: string) => {
      const i = rl()
      try { return /^y(es)?$/i.test((await i.question(`${q} [y/N] `)).trim()) } finally { i.close() }
    },
    choose: async (q: string, options: { id: string; label: string }[]) => {
      const i = rl()
      try {
        note(q)
        options.forEach((o, n) => note(`  ${n + 1}) ${o.label}`))
        const raw = await i.question('번호: ')
        const picked = options[Number(raw.trim()) - 1]
        if (picked === undefined) throw new Error('잘못된 번호입니다')
        return picked.id
      } finally { i.close() }
    },
  }
}

/**
 * 값이 정해진 플래그의 공통 처리. `flagValue`의 undefined는 "플래그를 안 줬다"와 "값이
 * 빠졌다"를 구분하지 못하므로 `argv.includes`로 존재 여부를 따로 본다 — 값을 빠뜨린
 * `--format`이 조용히 기본값으로 흘러가면 사용자는 자기가 적은 것이 무시된 줄 모른다.
 * (`--port`가 같은 이유로 같은 모양을 쓴다.)
 */
function enumFlag<T extends string>(
  argv: string[], name: string, allowed: readonly T[],
): { ok: true; value: T | undefined } | { ok: false; message: string } {
  if (!argv.includes(`--${name}`)) return { ok: true, value: undefined }
  const raw = flagValue(argv, name)
  if (raw === undefined || !(allowed as readonly string[]).includes(raw)) {
    return {
      ok: false,
      message: `--${name} 값이 올바르지 않습니다: ${raw ?? '(값 없음)'} — ${allowed.join(' | ')}`,
    }
  }
  return { ok: true, value: raw as T }
}

const EXPORT_FORMATS = ['ddl', 'dbml'] as const

/** --json이면 stdout에 오류 봉투를, 아니면 stderr에 사용법을 낸다. */
function usageError(json: boolean, message: string): number {
  if (json) emitError(true, new CliError('USAGE', message))
  else { note(message); note(USAGE) }
  return 2
}

export async function main(argv: string[], cwd: string): Promise<number> {
  const json = argv.includes('--json')
  if (argv.includes('--help') || argv.includes('-h')) {
    note(USAGE)
    return 0
  }
  const command = argv[0]
  if (command === undefined) return usageError(json, '명령이 필요합니다')
  const ctx = {
    cwd, json, yes: argv.includes('--yes'), strict: argv.includes('--strict'),
    ...interactive(json),
  }
  switch (command) {
    case 'init': return init({
      ...ctx,
      serverUrl: flagValue(argv, 'server'),
      token: flagValue(argv, 'token'),
      projectId: flagValue(argv, 'project'),
      local: argv.includes('--local'),
    })
    case 'pull': return pull(ctx)
    case 'push': return push({ ...ctx, message: flagValue(argv, 'message') ?? shortFlagValue(argv, 'm') })
    case 'diff': return diff(ctx)
    case 'status': return status(ctx)
    case 'validate': return validate(ctx)
    case 'export':
    case 'import': {
      const format = enumFlag<ExportFormat>(argv, 'format', EXPORT_FORMATS)
      if (!format.ok) return usageError(json, format.message)
      const dialect = enumFlag<Dialect>(argv, 'dialect', DIALECTS)
      if (!dialect.ok) return usageError(json, dialect.message)
      if (command === 'import') {
        // 파일은 명령 바로 뒤 자리다(`erdd skill install`과 같은 관례). 거기에 플래그가 오면
        // 위치 인자가 빠진 것이다 — 그대로 넘기면 "--json이라는 파일이 없다"로 번진다.
        const first = argv[1]
        const file = first !== undefined && !first.startsWith('-') ? first : undefined
        return importCommand({
          ...ctx, file, format: format.value, dialect: dialect.value,
          dryRun: argv.includes('--dry-run'),
        })
      }
      let out: string | undefined
      if (argv.includes('-o')) {
        out = shortFlagValue(argv, 'o')
        if (out === undefined) return usageError(json, '-o 값이 올바르지 않습니다: (값 없음)')
      }
      // export의 기본 형식은 ddl이다. import는 확장자로 정하므로 undefined를 그대로 넘긴다.
      return exportCommand({ ...ctx, format: format.value ?? 'ddl', dialect: dialect.value, out })
    }
    case 'serve': {
      // flagValue는 값이 빠지면(다음 토큰이 없거나 다른 --플래그면) undefined를 돌려주는데,
      // 이는 "플래그를 아예 안 줬다"와 구분되지 않는다 — argv.includes로 존재 여부를 따로
      // 봐야 "--port"만 쓰고 값을 빠뜨린 경우를 조용히 기본 포트로 흘리지 않는다.
      let port: number | undefined
      if (argv.includes('--port')) {
        const rawPort = flagValue(argv, 'port')
        port = rawPort === undefined ? NaN : Number(rawPort)
        if (!Number.isInteger(port) || port <= 0) {
          return usageError(json, `--port 값이 올바르지 않습니다: ${rawPort ?? '(값 없음)'}`)
        }
      }
      return serve({ ...ctx, port, open: !argv.includes('--no-open') })
    }
    case 'skill': return skill({
      ...ctx, sub: argv[1], dir: flagValue(argv, 'dir'), force: argv.includes('--force'),
    })
    default:
      return usageError(json, `알 수 없는 명령: ${command}`)
  }
}

// 직접 실행될 때만 프로세스를 끝낸다(테스트에서 import할 때는 아니다).
// import.meta.url은 Node가 심볼릭 링크를 따라간 실제 경로인데 process.argv[1]은 링크 경로
// 그대로다. node_modules/.bin/erdd로 설치해 실행하면 둘이 영영 달라 main()이 조용히 건너뛰어진다.
// 양쪽을 realpath로 정규화해 비교한다.
const invoked = process.argv[1]
if (invoked !== undefined) {
  let direct = false
  try {
    direct = fileURLToPath(import.meta.url) === realpathSync(resolve(invoked))
  } catch {
    direct = false   // argv[1]이 존재하지 않는 경로면 직접 실행이 아니다
  }
  if (direct) process.exit(await main(process.argv.slice(2), process.cwd()))
}
