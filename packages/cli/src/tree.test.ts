import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffTrees, readTree, writeTree } from './tree.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'erdd-tree-')) })

const TREE = {
  'erdd/tables/MBR.yaml': { id: 'tb1', name: 'MBR', columns: [] },
  'erdd/groups.yaml': { groups: [] },
  'erdd/words.yaml': { words: [] },
  'erdd/terms.yaml': { terms: [] },
  'erdd/domains.yaml': { domains: [] },
  'erdd/custom-fields.yaml': { customFields: [] },
}

describe('tree', () => {
  it('쓰고 읽으면 같다', async () => {
    await writeTree(dir, TREE)
    expect(await readTree(dir)).toEqual(TREE)
  })

  it('YAML로 쓴다', async () => {
    await writeTree(dir, TREE)
    const raw = await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')
    expect(raw).toContain('name: MBR')
    expect(raw).not.toContain('"name"')
  })

  it('이번 트리에 없는 테이블 파일을 지운다', async () => {
    await writeTree(dir, TREE)
    await writeFile(join(dir, 'erdd/tables/GONE.yaml'), 'id: x\n', 'utf8')
    const { deleted } = await writeTree(dir, TREE)
    expect(deleted).toEqual(['erdd/tables/GONE.yaml'])
    expect(await readdir(join(dir, 'erdd/tables'))).toEqual(['MBR.yaml'])
  })

  it('소유하지 않은 파일은 지우지 않는다', async () => {
    await writeTree(dir, TREE)
    await mkdir(join(dir, 'erdd/docs'), { recursive: true })
    await writeFile(join(dir, 'erdd/docs/note.md'), '메모\n', 'utf8')
    await writeFile(join(dir, 'erdd/README.md'), '읽어줘\n', 'utf8')
    const { deleted } = await writeTree(dir, TREE)
    expect(deleted).toEqual([])
    expect(await readFile(join(dir, 'erdd/docs/note.md'), 'utf8')).toBe('메모\n')
    expect(await readFile(join(dir, 'erdd/README.md'), 'utf8')).toBe('읽어줘\n')
  })

  it('diffTrees가 추가·수정·삭제를 가른다', () => {
    const base = { a: { v: 1 }, b: { v: 2 }, c: { v: 3 } }
    const cur = { a: { v: 1 }, b: { v: 9 }, d: { v: 4 } }
    expect(diffTrees(base, cur)).toEqual({ added: ['d'], modified: ['b'], deleted: ['c'] })
  })

  it('키 순서만 다른 파일은 수정으로 보지 않는다', () => {
    const base = { a: { x: 1, y: 2 } }
    const cur = { a: { y: 2, x: 1 } }
    expect(diffTrees(base, cur).modified).toEqual([])
  })
})
