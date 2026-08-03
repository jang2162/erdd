#!/usr/bin/env -S npx tsx
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { init } from './commands/init.js'
import { pull } from './commands/pull.js'
import { status } from './commands/status.js'
import { validate } from './commands/validate.js'
import { note } from './output.js'

const USAGE = `사용법: erdd <명령> [옵션]

명령
  init       서버·토큰·프로젝트를 연결하고 erdd.config.yaml을 만든다
  pull       서버 스키마를 파일로 내려받는다
  status     연결 정보와 로컬 변경을 보여준다
  validate   서버 없이 파일을 검사한다

옵션
  --json                기계용 JSON 출력
  --yes                 확인 프롬프트를 건너뛴다
  --strict              validate에서 명명 경고도 실패로 본다
  --server <url>        init 전용
  --token <token>       init 전용
  --project <id>        init 전용
  --help                이 도움말`

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const next = argv[i + 1]
  // 값 자리에 다음 플래그가 오면 값이 빠진 것이다 — 삼키면 엉뚱한 오류로 번진다.
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

export async function main(argv: string[], cwd: string): Promise<number> {
  const command = argv[0]
  if (command === undefined || command === '--help' || command === '-h') {
    note(USAGE)
    return command === undefined ? 2 : 0
  }
  const json = argv.includes('--json')
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
    })
    case 'pull': return pull(ctx)
    case 'status': return status(ctx)
    case 'validate': return validate(ctx)
    default:
      note(`알 수 없는 명령: ${command}\n`)
      note(USAGE)
      return 2
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
