import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { MAX_OPS_PER_MUTATION, type Op } from '@erdd/core'
import { FileStore, LAYOUT_FILE, LocalStoreError } from './store.js'

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

  /**
   * layout.yaml 에는 **메모 본문**이 들어 있다 — 잃어도 되는 배치가 아니라 사용자 콘텐츠다.
   * 파싱 실패를 삼켜 빈 layout 으로 열면 메모가 화면에서 사라지고, 편집이 잠기지 않으므로
   * 다음 flush 가 `notes: []` 로 그 손실을 파일에 확정한다(최종 리뷰 C-1, 실증됨).
   */
  it('layout.yaml 을 파싱하지 못하면 편집을 잠그고, 메모가 파일에서 사라지지 않는다', async () => {
    const dir = await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': [
        'notes:',
        '  - id: 018f6b0e-0000-7000-8000-000000000009',
        '    content: 정산 배치는 매일 02:00 — 잃으면 안 되는 사용자 메모',
        '    position: { x: 5, y: 6 }',
        "    color: '#fde68a'",
        'tables: [불완전',   // 닫히지 않은 flow 시퀀스 — 파일 전체가 파싱되지 않는다
        '',
      ].join('\n'),
    })
    const store = new FileStore(dir)
    const s = await store.load()
    expect(s.ok).toBe(false)
    // 유니온 좁히기가 안 되는 자리라 ok 갈래를 빈 배열로 접어 비교한다.
    expect(s.ok ? [] : s.failures.map((f) => f.path)).toContain(LAYOUT_FILE)

    // 잠겼으므로 편집이 통과하면 안 된다 — 통과하면 300ms 뒤 flush 가 파일을 덮는다.
    await expect(store.mutate([createTable('t1', 'ORD')])).rejects.toThrow(LocalStoreError)
    await store.flush()
    expect(await readFile(join(dir, LAYOUT_FILE), 'utf8'))
      .toContain('잃으면 안 되는 사용자 메모')
  })

  it('빈 layout.yaml 은 손상이 아니다 — 빈 layout 으로 연다', async () => {
    const store = new FileStore(await project({
      'erdd/tables/MBR.yaml': MBR,
      'erdd/layout.yaml': '# 주석만 있는 파일\n',
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

  it('load() 진행 중에 커밋된 mutate 의 편집을 되돌리지 않는다(경합)', async () => {
    const store = new FileStore(await project({}))
    await store.load()

    // load() 를 시작만 하고 기다리지 않는다 — readTree 의 실제 파일 IO 로 곧장 양보한다.
    const loadPromise = store.load()
    // 그 사이에 mutate 를 끼워 넣는다. mutate 는 disk IO 가 없는 동기 계산이라 #chain 을
    // load() 보다 먼저 탄다 — 그래서 이 await 는 load() 의 IO 가 끝나기 한참 전에 이미 끝난다.
    const { seq: mutateSeq } = await store.mutate([createTable('t1', 'A')])
    await loadPromise

    // load() 가 늦게 끝났다고 그 사이 커밋된 편집이 사라지면 안 된다.
    expect(mutateSeq).toBe(1)
    expect(store.state.seq).toBe(1)
    expect(store.state.model.tables['t1']).toBeDefined()
  })

  it('load() 진행 중에 mutate 가 커밋돼도, 그 load() 가 찾은 파일 손상은 버려지지 않는다(경합)', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    // 자기 쓰기 서명을 남긴다 — 이 시점 isSelfWrite 는 true 다.
    await store.mutate([createTable('t1', 'A')])
    await store.flush()
    expect(store.isSelfWrite).toBe(true)

    // 외부 편집기가 파일을 깨뜨린다.
    await writeFile(join(dir, 'erdd/tables/A.yaml'), 'name: [불완전\n', 'utf8')

    // load() 를 시작만 하고(readTree 의 실제 파일 IO 로 곧장 양보한다) 기다리지 않는다.
    const loadPromise = store.load()
    // 그 사이에 또 다른 mutate 가 커밋된다 — seq 가 올라간다. load() 진입 시점의 seq 와
    // 지금 seq 가 달라지므로, "낡은 성공 결과를 버리는" 가드가 이 손상 발견까지 함께
    // 버리면 안 된다 — 실패는 모델을 덮지 않으므로 경합과 무관하게 언제나 반영돼야 한다.
    await store.mutate([createTable('t2', 'B')])
    await loadPromise

    // 손상이 "낡았다"고 버려지면 안 된다 — 파일이 깨졌으면 반드시 알리고 편집을 잠가야 한다.
    expect(store.state.ok).toBe(false)
    expect(store.isSelfWrite).toBe(false)
  })

  /**
   * 이 트랙의 **네 번째** 경합이다. 겹친 편집 때문에 로드를 통째로 버리면, 그 사이 밖에서
   * 생긴 `erdd/tables/*.yaml` 이 메모리 모델에 영영 들어오지 못한다 — 화면에 안 보이는 것은
   * 물론이고, 트리 전체를 다시 쓰던 옛 flush 는 그 파일을 **지웠다**(최종 리뷰 I-2).
   * 버리지 말고 다시 읽어 **편집과 밖의 변경이 둘 다** 살아남아야 한다.
   */
  it('편집과 겹쳐 버려진 로드의 외부 변경이 사라지지 않는다(경합)', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A')])
    await store.flush()

    // 에이전트가 밖에서 새 테이블 파일을 쓴다.
    await writeFile(join(dir, 'erdd/tables/ORD.yaml'), [
      'id: 018f6b0e-0000-7000-8000-0000000000aa',
      'name: ORD',
      'logicalName: 주문',
      'columns: []',
      '',
    ].join('\n'), 'utf8')

    // 감시가 그것을 잡아 load() 를 시작한다 — readTree 의 IO 로 곧장 양보한다.
    const loadPromise = store.load()
    // 그 사이 사용자가 드래그하듯 편집을 커밋한다(디스크 IO 가 없어 먼저 체인을 탄다).
    await store.mutate([createTable('t2', 'B')])
    await loadPromise

    // 메모리 모델이 셋을 전부 알아야 한다 — 밖의 ORD 도, 겹친 편집 B 도.
    expect(Object.values(store.state.model.tables).map((t) => t.physicalName).sort())
      .toEqual(['A', 'B', 'ORD'])

    await store.flush()
    // 디스크에서도 둘 다 살아 있어야 한다.
    expect(await readFile(join(dir, 'erdd/tables/ORD.yaml'), 'utf8')).toContain('name: ORD')
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

describe('FileStore.flush', () => {
  /**
   * 로컬 모드는 **에이전트·사람이 파일을 직접 쓰는 것**이 전제라 비정규 포맷이 예외가 아니라
   * 기본이다. flush 가 매번 트리 전체를 다시 쓰면 무관한 편집 한 번에 저장소가 통째로
   * 정규화돼 git diff 가 요란해진다(설계 §4 는 `diffTrees` 재사용을 지정했다 — 최종 리뷰 I-3).
   */
  it('바뀐 파일만 쓴다 — 손대지 않은 파일의 내용·mtime 이 그대로다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A'), createTable('t2', 'B')])
    await store.flush()

    // B.yaml 을 사람이 손으로 다듬은 형태로 바꾼다 — **값은 그대로**고 포맷과 주석만 다르다.
    // 정규화 재작성이 돌면 주석이 사라지고 들여쓰기가 바뀌므로 바이트 비교로 잡힌다.
    const bPath = join(dir, 'erdd/tables/B.yaml')
    const handwritten = `# 손으로 붙인 주석 — 재작성되면 사라진다\n${
      JSON.stringify(parseYaml(await readFile(bPath, 'utf8')), null, 4)}\n`
    await writeFile(bPath, handwritten, 'utf8')
    await store.load()
    const before = await stat(bPath)

    // A 만 고친다.
    await store.mutate([{
      action: 'update', entity: 'table', entityId: 't1',
      changes: { logicalName: { from: 'A', to: '가나' } },
    }])
    await store.flush()

    expect(await readFile(bPath, 'utf8')).toBe(handwritten)
    expect((await stat(bPath)).mtimeMs).toBe(before.mtimeMs)
    // 대조군 — 실제로 바뀐 파일은 쓰인다.
    expect(await readFile(join(dir, 'erdd/tables/A.yaml'), 'utf8')).toContain('가나')
  })

  it('모델에서 사라진 테이블의 파일은 여전히 지운다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A'), createTable('t2', 'B')])
    await store.flush()
    expect(await readFile(join(dir, 'erdd/tables/B.yaml'), 'utf8')).toContain('name: B')

    await store.mutate([{
      action: 'delete', entity: 'table', entityId: 't2', before: store.state.model.tables['t2'],
    }])
    await store.flush()
    await expect(readFile(join(dir, 'erdd/tables/B.yaml'), 'utf8')).rejects.toThrow()
  })
})
