import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { main } from './main.js'

afterEach(() => vi.restoreAllMocks())

describe('main', () => {
  it('알 수 없는 명령은 2로 끝난다', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['nope'], '/tmp')).toBe(2)
  })

  it('명령이 없으면 사용법을 stderr로 내고 2로 끝난다', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main([], '/tmp')).toBe(2)
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('사용법')
    expect(out).not.toHaveBeenCalled()
  })

  it('--help는 0으로 끝난다', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['--help'], '/tmp')).toBe(0)
  })

  it('config가 없는 곳에서 status는 1이고 NO_CONFIG를 낸다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['status', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
  })

  it('--json이면 사용법 오류도 stdout에 JSON 봉투로 낸다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['bogus', '--json'], '/tmp')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    out.length = 0
    expect(await main(['--json'], '/tmp')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })

  it('명령 뒤의 --help도 사용법으로 처리한다', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['pull', '--help'], '/tmp/erdd-none')).toBe(0)
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('사용법')
  })

  describe('--version', () => {
    // 기대값은 package.json 에서 읽는다 — 버전을 적어 두면 다음 릴리스에 테스트가 깨진다.
    const expected = (JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }).version

    function capture() {
      const out: string[] = []
      const err: string[] = []
      vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
      vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
      return { out, err }
    }

    it('--version·-v 는 stdout 에 버전 한 줄만 내고 0으로 끝난다', async () => {
      for (const flag of ['--version', '-v']) {
        const { out, err } = capture()
        expect(await main([flag], '/tmp/erdd-none')).toBe(0)
        expect(out.join('')).toBe(`${expected}\n`)
        expect(err).toEqual([])
        vi.restoreAllMocks()
      }
    })

    it('--json 과 함께면 {version} 객체를 낸다', async () => {
      const { out } = capture()
      expect(await main(['--json', '--version'], '/tmp/erdd-none')).toBe(0)
      expect(JSON.parse(out.join(''))).toEqual({ version: expected })
    })

    it('명령보다 먼저 처리한다 — 명령 뒤에 와도 명령을 실행하지 않는다', async () => {
      // config 가 없는 곳이라 명령이 돌면 NO_CONFIG(1)다.
      const { out } = capture()
      expect(await main(['status', '-v'], '/tmp/erdd-does-not-exist')).toBe(0)
      expect(out.join('')).toBe(`${expected}\n`)
    })

    it('--help 와 함께면 --help 가 이긴다', async () => {
      const { out, err } = capture()
      expect(await main(['--version', '--help'], '/tmp')).toBe(0)
      expect(out).toEqual([])
      expect(err.join('')).toContain('사용법')
    })

    it('도움말에 -v, --version 이 나온다', async () => {
      const { err } = capture()
      expect(await main(['--help'], '/tmp')).toBe(0)
      expect(err.join('')).toContain('-v, --version')
    })
  })

  it('값 없는 플래그의 다음 플래그를 값으로 삼키지 않는다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // --server에 값이 없다. --token을 값으로 삼키면 서버 URL이 "--token"이 되어
    // NETWORK 오류로 번지고, 삼키지 않으면 대화형 입력이 없어 USAGE로 끝난다.
    const code = await main(['init', '--json', '--server', '--token', 'erdd_pat_x'], '/tmp/erdd-none')
    expect(code).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })

  // --project 연결 갈래에서 --dialect 는 USAGE 다 — 기본값은 init --local·--create 에만 있다.
  it('도움말은 --dialect 의 init 기본값을 --local·--create 에만 적는다', async () => {
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
    expect(await main(['--help'], '/tmp')).toBe(0)
    expect(err.join('')).toContain('init --local·--create는 postgresql')
  })

  // --adopt 는 내용이 같을 때만 연결한다 — 도움말이 이를 빼면 이름만 같으면 연결되는 줄로 읽힌다.
  it('도움말은 --adopt 가 내용이 같을 때만 연결하고 다르면 --conflicts ours 가 필요하다고 적는다', async () => {
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
    expect(await main(['--help'], '/tmp')).toBe(0)
    expect(err.join('')).toContain('출처를 연결한다(내용이 같을 때만)')
    expect(err.join('')).toContain('로컬 값을 유지한 채 연결하려면 --conflicts ours 를 함께 준다')
  })

  it('도움말에 새 명령이 모두 나온다', async () => {
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
    expect(await main(['--help'], '/tmp')).toBe(0)
    for (const c of ['push', 'diff', 'skill install']) expect(err.join('')).toContain(c)
  })

  it('push·diff가 사용법 오류로 떨어지지 않고 명령으로 배선돼 있다', async () => {
    // config가 없는 곳이면 NO_CONFIG(1)여야 한다 — USAGE(2)면 switch에 배선되지 않은 것이다.
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    for (const cmd of ['push', 'diff']) {
      out.length = 0
      expect(await main([cmd, '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
      expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
    }
  })

  it('dict list 는 명령으로 배선돼 있고, 모르는 하위 명령은 USAGE로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['dict', 'list', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
    for (const argv of [['dict', 'nope', '--json'], ['dict', '--json']]) {
      out.length = 0
      expect(await main(argv, '/tmp/erdd-does-not-exist')).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }
  })

  it('dict pull 은 배선돼 있고, --conflicts·--library 값이 잘못되면 USAGE로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['dict', 'pull', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
    for (const argv of [
      ['dict', 'pull', '--conflicts', 'mine', '--json'],
      ['dict', 'pull', '--conflicts', '--json'],
      ['dict', 'pull', '--library', '--json'],
    ]) {
      out.length = 0
      expect(await main(argv, '/tmp/erdd-does-not-exist')).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }
  })

  it('dict push·requests 는 배선돼 있고, --kind·--name·--library·--status 값이 잘못되면 USAGE로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    for (const argv of [
      ['dict', 'push', '--library', '표준', '--kind', 'word,term', '--name', '고객', '--json'],
      ['dict', 'requests', '--status', 'rejected', '--json'],
    ]) {
      out.length = 0
      expect(await main(argv, '/tmp/erdd-does-not-exist')).toBe(1)
      expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
    }
    for (const argv of [
      ['dict', 'push', '--library', '표준', '--kind', 'table', '--json'],
      ['dict', 'push', '--library', '표준', '--kind', '--json'],
      ['dict', 'push', '--library', '표준', '--name', '--json'],
      ['dict', 'push', '--library', '--json'],
      ['dict', 'push', '--json'],
      ['dict', 'requests', '--status', 'open', '--json'],
      ['dict', 'requests', '--status', '--json'],
    ]) {
      out.length = 0
      expect(await main(argv, '/tmp/erdd-does-not-exist')).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }
  })

  it('serve --port 에 값이 빠지면 조용히 기본 포트로 떨어지지 않고 USAGE로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // --port 뒤에 다른 플래그가 와서 flagValue가 undefined를 돌려주는 경우 —
    // "플래그를 안 줬다"와 구분하지 못하면 기본 4300으로 조용히 떨어진다.
    const code = await main(['serve', '--port', '--no-open', '--json'], '/tmp/erdd-none')
    expect(code).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })

  it('skill install이 배선돼 있고 -m이 push의 요약으로 전달된다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-main-'))
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['skill', 'install'], dir)).toBe(0)
    expect(await readFile(join(dir, '.claude/skills/erdd/SKILL.md'), 'utf8')).toContain('name: erdd')
    // -m은 config가 없어 NO_CONFIG로 끝나지만, 플래그 파싱이 깨지면 USAGE(2)가 된다.
    expect(await main(['push', '-m', '요약', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
  })
  it('export 가 명령으로 배선돼 있다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['export', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
  })

  it('export 의 --format·--dialect 는 값이 틀리면 config 를 읽기 전에 USAGE 로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    for (const argv of [
      ['export', '--format', 'xml', '--json'],
      ['export', '--dialect', 'nope', '--json'],
      ['export', '--format', '--json'],       // 값이 빠졌다
      ['export', '--dialect', '--json'],
    ]) {
      out.length = 0
      expect(await main(argv, '/tmp/erdd-does-not-exist')).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }
  })

  it('export -o 에 값이 빠지면 조용히 stdout 으로 떨어지지 않고 USAGE 로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['export', '-o', '--json'], '/tmp/erdd-none')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })
  it('import 이 배선돼 있고 위치 인자·--dry-run 이 전달된다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    // (1) config 가 없으면 NO_CONFIG(1) — USAGE(2)면 switch 에 배선되지 않은 것이다.
    expect(await main(['import', 'x.sql', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')

    // (2) 파일 인자가 없으면 USAGE(2)
    out.length = 0
    expect(await main(['import', '--json'], '/tmp/erdd-does-not-exist')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')

    // (3) 위치 인자와 --dry-run 이 실제로 명령까지 간다
    const dir = await mkdtemp(join(tmpdir(), 'erdd-main-import-'))
    expect(await main(['init', '--local', '--json'], dir)).toBe(0)
    await writeFile(join(dir, 's.sql'), 'CREATE TABLE ORD (ORD_NO bigint NOT NULL, PRIMARY KEY (ORD_NO));', 'utf8')
    out.length = 0
    expect(await main(['import', 's.sql', '--dry-run', '--json', '--yes'], dir)).toBe(0)
    const parsed = JSON.parse(out.join('')) as { dryRun: boolean; added: number }
    expect(parsed).toMatchObject({ dryRun: true, added: 1 })
  })

  it('import 의 --format 도 값이 틀리면 USAGE 로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['import', 'x.sql', '--format', 'xml', '--json'], '/tmp/erdd-none')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })
  it('init --local 의 --dialect·--case 가 config 까지 간다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-main-init-'))
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['init', '--local', '--dialect', 'mysql', '--case', 'lower_snake', '--json'], dir)).toBe(0)
    const yaml = await readFile(join(dir, 'erdd.config.yaml'), 'utf8')
    expect(yaml).toContain('mysql')
    expect(yaml).toContain('lower_snake')
  })

  it('init 의 --dialect·--case 는 값이 틀리거나 --local 없이 오면 USAGE 로 끝난다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const dir = await mkdtemp(join(tmpdir(), 'erdd-main-init2-'))
    for (const argv of [
      ['init', '--local', '--dialect', 'nope', '--json'],
      ['init', '--local', '--case', 'Camel', '--json'],
      ['init', '--local', '--case', '--json'],             // 값이 빠졌다
    ]) {
      out.length = 0
      expect(await main(argv, dir)).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }

    // --local 없이 주면 USAGE 다 — 연결 모드는 서버 프로젝트 설정이 진실이다.
    // ⚠️ 연결 인자를 **전부** 함께 줘야 이 가드에 구분력이 생긴다. 인자를 빼면 대화형
    //   입력이 없어 어차피 USAGE(2)로 떨어져, 가드를 통째로 지워도 테스트가 통과한다
    //   (실측으로 확인했다). 여기서는 가드가 없으면 서버에 붙으러 가 NETWORK(1)가 된다.
    for (const argv of [
      ['init', '--server', 'http://127.0.0.1:1', '--token', 't', '--project', 'p1', '--dialect', 'mysql', '--json'],
      ['init', '--server', 'http://127.0.0.1:1', '--token', 't', '--project', 'p1', '--case', 'lower_snake', '--json'],
    ]) {
      out.length = 0
      expect(await main(argv, dir)).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }
  })

  it('init --create 는 --project·--local 과 함께 쓰면 USAGE, --dialect·--case 는 받는다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const dir = await mkdtemp(join(tmpdir(), 'erdd-main-create-'))
    // 연결 인자를 전부 줘야 가드에 구분력이 생긴다 — 가드가 없으면 서버에 붙으러 가 NETWORK(1)가 된다.
    const conn = ['--server', 'http://127.0.0.1:1', '--token', 't', '--org', '팀', '--name', 'P', '--json']
    for (const argv of [
      ['init', '--create', '--project', 'p1', ...conn],
      ['init', '--create', '--local', ...conn],
      ['init', '--create', '--org', '--name', 'P', '--server', 'http://127.0.0.1:1', '--token', 't', '--json'],  // --org 값이 빠졌다
      ['init', '--create', '--name', '--org', '팀', '--server', 'http://127.0.0.1:1', '--token', 't', '--json'], // --name 값이 빠졌다
    ]) {
      out.length = 0
      expect(await main(argv, dir)).toBe(2)
      expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    }
    // --create 는 --dialect·--case 를 받는다 — 가드를 통과해 서버에 붙으러 간다.
    out.length = 0
    expect(await main(['init', '--create', '--dialect', 'mysql', '--case', 'lower_snake', ...conn], dir)).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NETWORK')
  })
})
