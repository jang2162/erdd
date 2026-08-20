import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_OPS_PER_MUTATION, type Op } from '@erdd/core'
import { FileStore, LocalStoreError } from './store.js'

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

  it('layout.yaml 을 읽지 못하는 IO 오류(디렉터리 등)는 던지지 않고 ok:false 로 알린다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    // layout.yaml 자리에 파일이 아니라 디렉터리를 둔다 — readFile 이 ENOENT 가 아닌
    // EISDIR 로 던진다. readLayout 의 재던짐이 fail() 을 거치지 않으면 load() 자체가 reject 된다.
    await mkdir(join(dir, 'erdd/layout.yaml'), { recursive: true })
    const store = new FileStore(dir)
    // reject 됐다면 이 await 가 던져 테스트가 실패한다 — load() 가 resolve 하는 것 자체가 증거다.
    const s = await store.load()
    expect(s.ok).toBe(false)
    expect(store.isSelfWrite).toBe(false)
  })

  it('신규 id 되쓰기의 쓰기 실패는 던지지 않고 ok:false 로 알린다', async () => {
    const dir = await project({
      'erdd/tables/ORD.yaml': ['name: ORD', 'logicalName: 주문', 'columns: []', ''].join('\n'),
    })
    // 대상 파일을 읽기 전용으로 만든다 — id 를 발급한 뒤 되쓰려는 writeFile 이 EACCES 로 던진다.
    await chmod(join(dir, 'erdd/tables/ORD.yaml'), 0o444)
    const store = new FileStore(dir)
    try {
      const s = await store.load()
      expect(s.ok).toBe(false)
      expect(store.isSelfWrite).toBe(false)
    } finally {
      await chmod(join(dir, 'erdd/tables/ORD.yaml'), 0o644)
    }
  })
})

const createTable = (id: string, name: string): Op => ({
  entity: 'table',
  action: 'create',
  entityId: id,
  data: {
    id, logicalName: name, physicalName: name, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  },
})

describe('FileStore.mutate', () => {
  it('op 을 적용하고 seq 를 올린다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const { seq } = await store.mutate([createTable('t1', 'MBR')])
    expect(seq).toBe(1)
    expect(store.state.model.tables['t1']!.physicalName).toBe('MBR')
  })

  it('flush 하면 파일에 쓴다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'MBR')])
    await store.flush()
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('name: MBR')
    expect(await readFile(join(dir, 'erdd/layout.yaml'), 'utf8')).toContain('t1')
  })

  it('연속 mutate 가 순서대로 적용된다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const results = await Promise.all([
      store.mutate([createTable('t1', 'A')]),
      store.mutate([createTable('t2', 'B')]),
      store.mutate([createTable('t3', 'C')]),
    ])
    expect(results.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(Object.keys(store.state.model.tables).sort()).toEqual(['t1', 't2', 't3'])
  })

  it('읽기 전용 상태에서는 mutate 를 거절한다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    await store.load()
    await expect(store.mutate([createTable('t9', 'X')])).rejects.toThrow()
  })

  it('op 상한을 넘기면 거절한다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const many = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, (_, i) => createTable(`t${i}`, `T${i}`))
    await expect(store.mutate(many)).rejects.toThrow()
  })

  it('무결성을 깨는 op 은 거절하고 모델을 되돌린다', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    const bad: Op = {
      entity: 'column', action: 'create', entityId: 'c1',
      data: {
        id: 'c1', tableId: '없는테이블', logicalName: 'x', physicalName: 'X', type: 'TEXT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 0,
        comment: null, domainId: null, custom: {},
      },
    }
    // applyOps 가 던지는 OpApplyError 를 LocalStoreError 로 바꿔 던지는 경로를 잠근다 —
    // 다음 태스크의 라우터가 LocalStoreError 만 400 으로 매핑하므로 타입이 바뀌면 500 이 된다.
    await expect(store.mutate([bad])).rejects.toThrow(LocalStoreError)
    expect(store.state.model.columns).toEqual({})
  })

  it('setModel 이 모델을 통째로 갈아끼운다(스냅샷 복원)', async () => {
    const store = new FileStore(await project({}))
    await store.load()
    await store.mutate([createTable('t1', 'MBR')])
    const snap = store.state.model
    await store.mutate([createTable('t2', 'ORD')])
    const { seq } = await store.setModel(snap)
    expect(seq).toBe(3)
    expect(Object.keys(store.state.model.tables)).toEqual(['t1'])
  })

  it('flush() 가 #chain 을 지난다 — 뒤에 온 mutate 는 flush 의 디스크 쓰기가 끝난 뒤에야 실행된다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A')])
    const flush1 = store.flush()
    await store.mutate([createTable('t2', 'B')])
    // flush1 이 #chain 을 우회했다면 이 mutate 는 flush1 의 writeTree 를 기다리지 않고 먼저
    // 끝나 A.yaml 이 아직 없을 수 있다. #chain 을 지난다면 이 시점엔 이미 다 쓰여 있어야 한다.
    expect(await readFile(join(dir, 'erdd/tables/A.yaml'), 'utf8')).toContain('name: A')
    const flush2 = store.flush()
    await Promise.all([flush1, flush2])
    expect(await readFile(join(dir, 'erdd/tables/B.yaml'), 'utf8')).toContain('name: B')
  })

  it('flush() 가 쓰기에 실패하면 dirty 를 유지해 다음 flush 가 재시도한다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A')])
    // layout.yaml 자리에 디렉터리를 둔다 — writeFile 이 EISDIR 로 던져 flush() 가 실패한다.
    await mkdir(join(dir, 'erdd/layout.yaml'), { recursive: true })
    await expect(store.flush()).rejects.toThrow()
    // 실패했으니 dirty 가 꺼지면 안 된다 — 장애물을 치우면 다음 flush 가 실제로 써야 한다.
    await rm(join(dir, 'erdd/layout.yaml'), { recursive: true, force: true })
    await store.flush()
    expect(await readFile(join(dir, 'erdd/layout.yaml'), 'utf8')).toContain('t1')
  })
})
