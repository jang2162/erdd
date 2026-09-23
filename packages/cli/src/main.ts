#!/usr/bin/env -S npx tsx
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { DIALECTS, RESOURCE_KINDS, type Dialect, type NamingRules, type ResourceKind } from '@erdd/core'
import { dictList } from './commands/dict-list.js'
import { dictPull } from './commands/dict-pull.js'
import { dictPush } from './commands/dict-push.js'
import { REQUEST_STATUSES, dictRequests, type RequestStatus } from './commands/dict-requests.js'
import { diff } from './commands/diff.js'
import { exportCommand, type ExportFormat } from './commands/export.js'
import { importCommand } from './commands/import.js'
import { init } from './commands/init.js'
import { libraryExport, libraryImport, libraryList } from './commands/library.js'
import { pull } from './commands/pull.js'
import { push } from './commands/push.js'
import { serve } from './commands/serve.js'
import { skill } from './commands/skill.js'
import { status } from './commands/status.js'
import { validate } from './commands/validate.js'
import { changes } from './commands/changes.js'
import { CliError, emit, emitError, note } from './output.js'

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
  changes      변경 기록 상태 — 미기록 변경 미리보기(로컬 모드 전용)
  changes new <이름> 미기록 변경을 erdd/changes/ 에 기록한다
  dict <list|pull|push|requests>  공용 사전을 주고받는다
  library <list|export|import>  공용 라이브러리를 파일로 내보내고 가져온다(관리자)

옵션
  --json                기계용 JSON 출력
  --yes                 확인 프롬프트를 건너뛴다
  --strict              validate·diff에서 경고·충돌도 실패로 본다
  -m, --message <요약>  push의 Revision 요약, dict push의 승격 요청 메모
  --dir <경로>          skill install 전용 — 설치 위치
  --force               skill install 전용 — 기존 파일 덮어쓰기
  --server <url>        init·library 전용
  --token <token>       init 전용
  --project <id>        init 전용
  --local               init 전용 — 서버 연결 없이 로컬 전용 프로젝트를 만든다
  --create              init 전용 — 서버에 프로젝트를 만들어 연결한다(로컬 전용 프로젝트면 이관한다)
  --org <이름|id>        init --create 전용 — 프로젝트를 만들 조직
                        library import --create --scope org 전용 — 라이브러리를 만들 조직
  --case <대소문자>      init --local·--create 전용 — UPPER_SNAKE(기본) 또는 lower_snake
  --format <ddl|dbml>   export·import 전용 — export 기본 ddl, import 기본 확장자 판별
  --dialect <방언>       export·import·init --local·--create 전용
                        export·import는 기본이 erdd.config.yaml의 dialects[0], init --local·--create는 postgresql
  -o <경로>             export·library export 전용 — 산출물을 쓸 파일(없으면 stdout)
  --dry-run             import·dict pull·library import 전용 — 계획만 보고 파일을 쓰지 않는다
  --library <이름|id>   dict pull·push·library import 전용 — pull은 받을 라이브러리(구독에 없으면 더한다, 없으면 구독 전부)
                        push·library import 는 올릴/가져올 라이브러리
  --file <경로>          dict pull 전용 — 서버에서 내보낸 라이브러리 파일에서 받는다(서버 연결 불필요)
  --adopt               dict pull 전용 — 이름이 같은 로컬 항목에 출처를 연결한다(내용이 같을 때만)
                        내용이 달라도 로컬 값을 유지한 채 연결하려면 --conflicts ours 를 함께 준다
  --conflicts <theirs|ours>  dict pull 전용 — 충돌을 원본(theirs)·로컬(ours)로 정리한다(기본 보류)
  --kind <종류,…>        dict push 전용 — domain·word·term·customField 중 올릴 종류
  --create <이름>        library import 전용 — 새 라이브러리를 만들며 가져온다(init --create 와 다르다)
  --scope <global|org>  library import --create 전용
  --prune               library import 전용 — 파일에 없는 항목을 지운다(적힌 종류만)
  --include-stale       library import 전용 — 서버가 더 새로운 항목도 파일 값으로 덮는다
  --name <이름>          dict push 전용 — 올릴 항목 이름(반복 가능)
                        init --create 전용 — 서버에 만들 프로젝트 이름
  --include-name-match  dict push 전용 — 라이브러리에 같은 이름이 있는 항목도 올린다(기본 제외)
  --status <상태>        dict requests 전용 — pending·resolved·rejected·cancelled
  --port <번호>          serve 전용 — 기본 4300
  --no-open             serve 전용 — 브라우저를 자동으로 열지 않는다
  --check               changes 전용 — 미기록 변경이 있으면 종료 코드 1
  --baseline            changes new 전용 — 첫 기록을 「이미 DB 에 있음」으로 표시
  -v, --version         버전을 출력한다
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
 * CLI의 단일 대시 토큰은 -m·-o·-h·-v뿐이다. -h 는 어디에 있든 배차 전에 도움말로 끝나고(값 자리에
 * `-h` 를 적어도 도움말이다), -v 는 명령 자리에서만 버전이라 값 자리의 `-v` 는 값으로 삼킨다. 단일 대시를 거절하면
 * `-m "-fix column"`처럼 하이픈으로 시작하는 요약이 조용히 사라지고 자동 요약으로 대체된다.
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
const NAMING_CASES = ['UPPER_SNAKE', 'lower_snake'] as const

/** --json이면 stdout에 오류 봉투를, 아니면 stderr에 사용법을 낸다. */
function usageError(json: boolean, message: string): number {
  if (json) emitError(true, new CliError('USAGE', message))
  else { note(message); note(USAGE) }
  return 2
}

/**
 * 제품 버전 — `@erdd/cli` 의 package.json 을 런타임에 읽는다. CLI 는 빌드 없이 src/main.ts 를
 * 그대로 실행하고 게시본에도 src/ 와 package.json 이 함께 들어가므로 `../package.json` 은
 * 저장소와 설치본 양쪽에서 같은 파일이다. 소스에 적어 두면 릴리스 때 올릴 곳이 둘이 된다.
 */
function cliVersion(): string {
  return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
}

export async function main(argv: string[], cwd: string): Promise<number> {
  const json = argv.includes('--json')
  if (argv.includes('--help') || argv.includes('-h')) {
    note(USAGE)
    return 0
  }
  // --version·-v 는 명령 자리(--json 을 뺀 첫 토큰)에서만 받는다. 명령 뒤의 -v 는 값(`-o -v`)이거나
  // 다른 도구의 verbose 로 적은 것이라, 가로채면 명령이 돌지 않은 채 성공(0)으로 끝난다.
  const head = argv.find((a) => a !== '--json')
  if (head === '--version' || head === '-v') {
    const version = cliVersion()
    emit(json, version, { version })
    return 0
  }
  const command = argv[0]
  if (command === undefined) return usageError(json, '명령이 필요합니다')
  const ctx = {
    cwd, json, yes: argv.includes('--yes'), strict: argv.includes('--strict'),
    ...interactive(json),
  }
  switch (command) {
    case 'init': {
      const local = argv.includes('--local')
      const create = argv.includes('--create')
      if (create && argv.includes('--project')) return usageError(json, '--create와 --project는 함께 쓸 수 없습니다')
      if (create && local) return usageError(json, '--create와 --local은 함께 쓸 수 없습니다')
      // 값이 빠진 --org·--name 이 조용히 대화형 선택·입력으로 흐르면 사용자는 자기가 적은 것이
      // 무시된 줄 모른다.
      for (const name of ['org', 'name']) {
        if (argv.includes(`--${name}`) && flagValue(argv, name) === undefined) {
          return usageError(json, `--${name} 값이 빠졌습니다`)
        }
      }
      const dialect = enumFlag<Dialect>(argv, 'dialect', DIALECTS)
      if (!dialect.ok) return usageError(json, dialect.message)
      const namingCase = enumFlag<NamingRules['case']>(argv, 'case', NAMING_CASES)
      if (!namingCase.ok) return usageError(json, namingCase.message)
      // 연결 모드에서는 서버 프로젝트 설정이 진실이다 — 그 둘을 여기서 받으면 init이 만든
      // config가 첫 pull에 곧바로 덮여, 사용자는 자기가 준 값이 왜 사라졌는지 알 수 없다.
      if (!local && !create && (dialect.value !== undefined || namingCase.value !== undefined)) {
        return usageError(json, '--dialect·--case는 init --local·--create 전용입니다 — 기존 프로젝트에 연결할 때는 서버 프로젝트 설정을 따릅니다')
      }
      return init({
        ...ctx,
        serverUrl: flagValue(argv, 'server'),
        token: flagValue(argv, 'token'),
        projectId: flagValue(argv, 'project'),
        local,
        dialect: dialect.value,
        namingCase: namingCase.value,
        create,
        org: flagValue(argv, 'org'),
        name: flagValue(argv, 'name'),
      })
    }
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
    case 'dict': {
      // 하위 명령 자리에 플래그가 오면 하위 명령이 빠진 것이다(`erdd dict --json`).
      const sub = argv[1]?.startsWith('-') === true ? undefined : argv[1]
      if (sub === 'list') return dictList(ctx)
      if (sub === 'pull') {
        const conflicts = enumFlag<'theirs' | 'ours'>(argv, 'conflicts', ['theirs', 'ours'] as const)
        if (!conflicts.ok) return usageError(json, conflicts.message)
        if (argv.includes('--library') && flagValue(argv, 'library') === undefined) {
          return usageError(json, '--library 값이 올바르지 않습니다: (값 없음)')
        }
        if (argv.includes('--file') && flagValue(argv, 'file') === undefined) {
          return usageError(json, '--file 값이 올바르지 않습니다: (값 없음)')
        }
        return dictPull({
          ...ctx, library: flagValue(argv, 'library'), file: flagValue(argv, 'file'), adopt: argv.includes('--adopt'),
          conflicts: conflicts.value, dryRun: argv.includes('--dry-run'),
        })
      }
      if (sub === 'push') {
        if (argv.includes('--library') && flagValue(argv, 'library') === undefined) {
          return usageError(json, '--library 값이 올바르지 않습니다: (값 없음)')
        }
        const kinds = argv.includes('--kind') ? (flagValue(argv, 'kind') ?? '').split(',').filter(Boolean) : undefined
        if (kinds !== undefined && (kinds.length === 0 || !kinds.every((k) => (RESOURCE_KINDS as readonly string[]).includes(k)))) {
          return usageError(json, `--kind 값이 올바르지 않습니다: ${flagValue(argv, 'kind') ?? '(값 없음)'} — ${RESOURCE_KINDS.join(' | ')}`)
        }
        // --name 은 반복할 수 있다. 값이 빠진 --name 은 조용히 무시하지 않는다 — 전부 올라간다.
        const nameAt = argv.flatMap((a, i) => (a === '--name' ? [i] : []))
        if (nameAt.some((i) => argv[i + 1] === undefined || argv[i + 1]!.startsWith('--'))) {
          return usageError(json, '--name 값이 올바르지 않습니다: (값 없음)')
        }
        const names = nameAt.map((i) => argv[i + 1]!)
        return dictPush({
          ...ctx, library: flagValue(argv, 'library'), kinds: kinds as ResourceKind[] | undefined,
          names: names.length > 0 ? names : undefined, includeNameMatch: argv.includes('--include-name-match'),
          message: flagValue(argv, 'message') ?? shortFlagValue(argv, 'm'),
        })
      }
      if (sub === 'requests') {
        const status = enumFlag<RequestStatus>(argv, 'status', REQUEST_STATUSES)
        if (!status.ok) return usageError(json, status.message)
        return dictRequests({ ...ctx, status: status.value })
      }
      return usageError(json, `알 수 없는 dict 하위 명령: ${sub ?? '(없음)'} — list | pull | push | requests`)
    }
    case 'library': {
      const sub = argv[1]?.startsWith('-') === true ? undefined : argv[1]
      if (argv.includes('--server') && flagValue(argv, 'server') === undefined) return usageError(json, '--server 값이 빠졌습니다')
      const server = flagValue(argv, 'server')
      if (sub === 'list') return libraryList({ ...ctx, server })
      // 위치 인자는 하위 명령 바로 뒤다. 거기 플래그가 오면 빠진 것이다.
      const positional = argv[2] !== undefined && !argv[2].startsWith('-') ? argv[2] : undefined
      if (sub === 'export') {
        let out: string | undefined
        if (argv.includes('-o')) {
          out = shortFlagValue(argv, 'o')
          if (out === undefined) return usageError(json, '-o 값이 올바르지 않습니다: (값 없음)')
        }
        return libraryExport({ ...ctx, server, ref: positional, out })
      }
      if (sub === 'import') {
        const scope = enumFlag<'global' | 'org'>(argv, 'scope', ['global', 'org'] as const)
        if (!scope.ok) return usageError(json, scope.message)
        for (const name of ['library', 'create', 'org']) {
          if (argv.includes(`--${name}`) && flagValue(argv, name) === undefined) return usageError(json, `--${name} 값이 빠졌습니다`)
        }
        return libraryImport({
          ...ctx, server, file: positional, library: flagValue(argv, 'library'), create: flagValue(argv, 'create'),
          scope: scope.value, org: flagValue(argv, 'org'), prune: argv.includes('--prune'),
          includeStale: argv.includes('--include-stale'), dryRun: argv.includes('--dry-run'),
        })
      }
      return usageError(json, `알 수 없는 library 하위 명령: ${sub ?? '(없음)'} — list | export | import`)
    }
    case 'skill': return skill({
      ...ctx, sub: argv[1], dir: flagValue(argv, 'dir'), force: argv.includes('--force'),
    })
    case 'changes': {
      const sub = argv[1]
      if (sub === 'new') {
        const name = argv[2]
        if (name === undefined || name.startsWith('-')) {
          return usageError(json, '사용법: erdd changes new <이름> [--baseline]')
        }
        return changes({ ...ctx, sub: 'new', name, baseline: argv.includes('--baseline'), check: false })
      }
      if (sub !== undefined && !sub.startsWith('-')) return usageError(json, `알 수 없는 하위 명령: changes ${sub}`)
      if (argv.includes('--baseline')) return usageError(json, '--baseline 은 changes new 전용입니다')
      return changes({ ...ctx, sub: 'status', baseline: false, check: argv.includes('--check') })
    }
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
