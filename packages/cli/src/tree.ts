import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { TOP_LEVEL_FILES, TREE_ROOT, type FileTree } from '@erdd/core'
import { CliError } from './output.js'

const TABLES_DIR = `${TREE_ROOT}/tables`

/**
 * 키 순서와 무관하게 값이 같은지 본다 — YAML 재작성으로 순서가 흔들려도 수정으로 잡지 않는다.
 *
 * `undefined`를 받으면 `JSON.stringify`가 `undefined`를 내므로 반환 타입도 그렇게 적는다
 * (`lib.es5.d.ts`의 `stringify(value: any): string`이 감추는 사실이다). 지금 두 호출자는
 * 모두 키가 있는지 먼저 확인하고 비교만 하므로 이 갈래에 닿지 않는다.
 *
 * `path`는 오류 문구에만 쓴다. 순환 참조는 파일 하나에서 생기고, 어느 파일인지 모르면
 * 사용자가 할 수 있는 일이 없다.
 */
export function canonical(v: unknown, path: string): string | undefined {
  /**
   * 지금 내려온 길 위의 객체들. YAML anchor/alias는 `&a {self: *a}`처럼 자기 조상을 가리키는
   * 값을 만들 수 있고, 그러면 walk가 무한 재귀해 RangeError가 난다. 그 오류는 push의 임계
   * 경로(reserveIds)에서 run()의 catch-all에 걸려 `code:"NETWORK"`가 되는데, code로 분기하는
   * 이 CLI의 주 소비자(에이전트)는 그것을 전송 실패로 읽고 같은 명령을 영원히 재시도한다 —
   * 파일이 그대로면 영원히 실패한다. 무엇을 하면 되는지 아는 자리에서 세운다.
   *
   * 빠져나올 때 지운다. "이미 본 것 전부"로 두면 순환이 아닌 공유 참조(두 도메인이 같은
   * dialectTypes 매핑을 alias로 나눠 쓰는 것 같은)까지 걸려, 지금 멀쩡히 도는 파일이 막힌다.
   */
  const onPath = new WeakSet<object>()
  const walk = (x: unknown): unknown => {
    if (typeof x !== 'object' || x === null) return x
    if (onPath.has(x)) {
      throw new CliError(
        'VALIDATION',
        `${path}에 순환 참조가 있습니다 — YAML anchor/alias(\`&이름\` … \`*이름\`)가 자기 자신을 가리킵니다. `
          + '별칭을 풀어 내용을 그대로 적어 주세요',
      )
    }
    onPath.add(x)
    const out = Array.isArray(x)
      ? x.map(walk)
      : Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, y]) => [k, walk(y)]))
    onPath.delete(x)
    return out
  }
  return JSON.stringify(walk(v))
}

export async function writeTree(
  cwd: string, tree: FileTree,
): Promise<{ written: string[]; deleted: string[] }> {
  const keep = new Set(Object.keys(tree))

  // ── 삭제를 먼저 한다 ──
  // 대소문자 무시 파일시스템(macOS APFS, Windows NTFS)은 기존 디렉터리 엔트리 이름을
  // 보존한다. 물리명이 MBR → mbr로 개명되면, 먼저 쓸 경우 writeFile은 기존 MBR.yaml
  // 엔트리에 내용을 쓰고 readdir은 여전히 MBR.yaml을 돌려주므로, 뒤따르는 삭제 패스가
  // "keep에 없는 파일"로 보고 방금 쓴 것을 지운다. 쓰기 전에 지우면 그 창이 사라진다.
  const deleted: string[] = []
  let entries: Dirent[] = []
  try {
    entries = await readdir(join(cwd, TABLES_DIR), { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  for (const entry of entries) {
    // .yaml로 끝나는 디렉터리가 있으면 rm이 EISDIR로 던져 최상위 정리까지 건너뛴다.
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const rel = `${TABLES_DIR}/${entry.name}`
    if (keep.has(rel)) continue
    await rm(join(cwd, rel))
    deleted.push(rel)
  }
  for (const rel of TOP_LEVEL_FILES) {
    if (keep.has(rel)) continue
    try {
      await rm(join(cwd, rel))
      deleted.push(rel)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  // ── 그 다음 쓴다 ──
  const written: string[] = []
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(cwd, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, stringifyYaml(content), 'utf8')
    written.push(rel)
  }

  return { written: written.sort(), deleted: deleted.sort() }
}

export async function readTree(cwd: string): Promise<FileTree> {
  const tree: FileTree = {}
  const load = async (rel: string): Promise<void> => {
    let raw: string
    try {
      raw = await readFile(join(cwd, rel), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    try {
      tree[rel] = parseYaml(raw)
    } catch (err) {
      throw new CliError('VALIDATION', `${rel}을 읽지 못했습니다: ${(err as Error).message}`)
    }
  }
  for (const rel of TOP_LEVEL_FILES) await load(rel)
  let names: string[] = []
  try {
    names = await readdir(join(cwd, TABLES_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  for (const name of names.sort()) {
    if (name.endsWith('.yaml')) await load(`${TABLES_DIR}/${name}`)
  }
  return tree
}

export function diffTrees(
  base: FileTree, current: FileTree,
): { added: string[]; modified: string[]; deleted: string[] } {
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  for (const key of Object.keys(current)) {
    if (!(key in base)) added.push(key)
    else if (canonical(base[key], key) !== canonical(current[key], key)) modified.push(key)
  }
  for (const key of Object.keys(base)) if (!(key in current)) deleted.push(key)
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() }
}
