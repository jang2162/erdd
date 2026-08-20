import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileStore } from './store.js'

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'erdd-local-'))
  await writeFile(join(dir, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, body, 'utf8')
  }
  return dir
}

const MBR = [
  'id: 018f6b0e-0000-7000-8000-000000000001',
  'name: MBR',
  'logicalName: 회원',
  'columns:',
  '  - id: 018f6b0e-0000-7000-8000-000000000002',
  '    name: MBR_NO',
  '    logicalName: 회원번호',
  '    type: BIGINT',
  '    pk: true',
  '',
].join('\n')

describe('FileStore.load', () => {
  it('빈 디렉터리에서 빈 모델로 시작한다', async () => {
    const store = new FileStore(await project({}))
    const s = await store.load()
    expect(s.ok).toBe(true)
    expect(s.model.tables).toEqual({})
    expect(s.seq).toBe(0)
  })

  it('테이블 파일을 모델로 읽는다', async () => {
    const store = new FileStore(await project({ 'erdd/tables/MBR.yaml': MBR }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    expect(Object.values(s.model.tables)[0]!.physicalName).toBe('MBR')
  })

  it('layout.yaml 의 좌표와 메모를 모델에 꽂는다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': [
        'tables:',
        '  - id: 018f6b0e-0000-7000-8000-000000000001',
        '    name: MBR',
        '    position: { x: 120, y: 80 }',
        'notes:',
        '  - id: 018f6b0e-0000-7000-8000-000000000009',
        '    content: 메모',
        '    position: { x: 5, y: 6 }',
        "    color: '#fde68a'",
        '',
      ].join('\n'),
    }))
    const s = await store.load()
    expect(s.model.tables['018f6b0e-0000-7000-8000-000000000001']!.position).toEqual({ x: 120, y: 80 })
    expect(Object.values(s.model.notes)[0]!.content).toBe('메모')
  })

  it('layout.yaml 이 없어도 모델을 연다', async () => {
    const store = new FileStore(await project({ 'erdd/tables/MBR.yaml': MBR }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    // 좌표는 gridPositions 가 정한다 — 구체적 값이 아니라 "숫자로 정해졌다"만 잠근다.
    const pos = s.model.tables['018f6b0e-0000-7000-8000-000000000001']!.position
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true)
  })

  it('id 없는 신규 객체에 uuid 를 발급하고 파일에 되쓴다', async () => {
    const dir = await project({
      'erdd/tables/ORD.yaml': ['name: ORD', 'logicalName: 주문', 'columns: []', ''].join('\n'),
    })
    const s = await new FileStore(dir).load()
    expect(s.ok).toBe(true)
    const written = await readFile(join(dir, 'erdd/tables/ORD.yaml'), 'utf8')
    expect(written).toMatch(/id: [0-9a-f-]{36}/)
    // 되쓴 id 가 메모리 모델의 id 와 같아야 한다 — 다르면 다음 로드에서 다른 객체가 된다.
    expect(written).toContain(Object.keys(s.model.tables)[0]!)
  })

  it('layout.yaml 의 망가진 항목은 걸러 격자로 떨어뜨린다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': [
        'tables:',
        '  - id: 018f6b0e-0000-7000-8000-000000000001',
        '    name: MBR',
        '    position: { x: 몰라, y: 80 }',   // 숫자가 아니다
        'notes:',
        '  - id: n1',                          // content·position·color 가 없다
        '',
      ].join('\n'),
    }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    // 좌표만 잃고 격자로 떨어진다 — 파일 전체를 거절하지 않는다.
    const pos = s.model.tables['018f6b0e-0000-7000-8000-000000000001']!.position
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.y)).toBe(true)
    expect(s.model.notes).toEqual({})
  })

  it('layout.yaml 자체가 깨져도 모델은 연다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': 'tables: [불완전\n',
    }))
    const s = await store.load()
    expect(s.ok).toBe(true)
    expect(Object.values(s.model.tables)[0]!.physicalName).toBe('MBR')
  })

  it('YAML 이 깨지면 실패를 알리고 마지막 정상 모델을 유지한다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    const first = await store.load()
    expect(first.ok).toBe(true)

    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    const second = await store.load()
    expect(second.ok).toBe(false)
    // 모델은 직전 정상값 그대로다 — 성한 메모리 모델로 깨진 파일을 덮어쓰면 안 되므로
    // 호출자가 이 상태에서 쓰기를 막는다.
    expect(Object.values(second.model.tables)[0]!.physicalName).toBe('MBR')
    expect(store.state.ok).toBe(false)
  })

  it('참조 무결성이 깨져도 실패로 본다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': [
        'id: 018f6b0e-0000-7000-8000-000000000001',
        'name: MBR',
        'logicalName: 회원',
        'columns: []',
        'relations:',
        '  - to: NOPE',
        '    columns: { A: B }',
        '',
      ].join('\n'),
    }))
    const s = await store.load()
    expect(s.ok).toBe(false)
  })

  it('깨진 파일이 고쳐지면 다시 정상으로 돌아온다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    expect((await store.load()).ok).toBe(false)
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), MBR, 'utf8')
    expect((await store.load()).ok).toBe(true)
  })
})
