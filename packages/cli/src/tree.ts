import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { TOP_LEVEL_FILES, TREE_ROOT, type FileTree } from '@erdd/core'
import { CliError } from './output.js'

const TABLES_DIR = `${TREE_ROOT}/tables`

/** 키 순서와 무관하게 값이 같은지 본다 — YAML 재작성으로 순서가 흔들려도 수정으로 잡지 않는다. */
function canonical(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (typeof x === 'object' && x !== null) {
      return Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, y]) => [k, walk(y)]))
    }
    return x
  }
  return JSON.stringify(walk(v))
}

export async function writeTree(
  cwd: string, tree: FileTree,
): Promise<{ written: string[]; deleted: string[] }> {
  const written: string[] = []
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(cwd, rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, stringifyYaml(content), 'utf8')
    written.push(rel)
  }

  // 소유한 경로에서만 지운다: erdd/tables/*.yaml 과 최상위 5개.
  const deleted: string[] = []
  const keep = new Set(Object.keys(tree))
  let existing: string[] = []
  try {
    existing = await readdir(join(cwd, TABLES_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  for (const name of existing) {
    if (!name.endsWith('.yaml')) continue
    const rel = `${TABLES_DIR}/${name}`
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
    else if (canonical(base[key]) !== canonical(current[key])) modified.push(key)
  }
  for (const key of Object.keys(base)) if (!(key in current)) deleted.push(key)
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() }
}
