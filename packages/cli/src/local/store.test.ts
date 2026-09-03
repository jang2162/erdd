import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { MAX_OPS_PER_MUTATION, type Op } from '@erdd/core'
import { FileStore, LAYOUT_FILE, LocalStoreError } from './store.js'
import { hasDraft, readDraft } from './draft.js'

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
    // (옛 `isSelfWrite` 단언이 있던 자리다. 그 판정은 `#base.signature` 로 합쳐졌고, 「손상은
    //  반드시 알린다」는 이제 server.test.ts 의 '파일이 깨지면 blocked 를 보낸다' 가 잠근다.)
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

  // ⚠️ Task 4 가 `save()` 로 되살린다 — 파일을 쓰는 것은 이제 save 뿐이다.
  it.skip('flush 하면 파일에 쓴다', async () => {
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
    // flush1 이 #chain 을 우회했다면 이 mutate 는 flush1 의 드래프트 쓰기를 기다리지 않고 먼저
    // 끝나 드래프트가 아직 없을 수 있다. #chain 을 지난다면 이 시점엔 이미 쓰여 있어야 한다.
    const mid = await readDraft(dir)
    expect(mid.kind).toBe('ok')
    if (mid.kind !== 'ok') return
    expect(Object.values(mid.draft.model.tables).map((t) => t.physicalName)).toEqual(['A'])
    const flush2 = store.flush()
    await Promise.all([flush1, flush2])
    const after = await readDraft(dir)
    expect(after.kind).toBe('ok')
    if (after.kind !== 'ok') return
    expect(Object.values(after.draft.model.tables).map((t) => t.physicalName).sort())
      .toEqual(['A', 'B'])
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
    // 편집을 드래프트에 남긴다 — 이 시점 dirty 는 true 다(파일에는 아직 아무것도 없다).
    await store.mutate([createTable('t1', 'A')])
    await store.flush()
    expect(store.dirty).toBe(true)

    // 외부 편집기가 파일을 깨뜨린다. (편집은 이제 파일을 만들지 않으므로 디렉터리를 직접 만든다.)
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
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
  })

  /**
   * 이 트랙의 **네 번째** 경합이었다. 옛 계약은 「편집과 밖의 변경이 **둘 다** 살아남는다」였고,
   * 로드가 겹친 편집 때문에 버려지면 밖에서 생긴 파일이 메모리 모델에 영영 못 들어왔다.
   *
   * ⚠️ **드래프트 도입으로 그 계약이 바뀌었다.** 미저장 편집이 있는 동안에는 밖의 변경을
   * **채택하지 않는다** — 자동 병합을 하지 않는 것이 설계 D2 이고, 대신 `external` 로 알려
   * 사용자가 「내 편집 유지 / 파일 다시 읽기」를 고른다. 그러므로 이 테스트가 잠그는 것은
   * 「둘 다 모델에 들어온다」가 아니라 **「밖의 변경이 조용히 묻히지 않는다」**로 옮겨졌다.
   * (원래 방어의 정신은 그대로다 — 잃어서는 안 되는 것은 **알림**이다.)
   */
  it('편집과 겹친 로드의 외부 변경은 묻히지 않고 external 로 알려진다(경합)', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A')])
    await store.flush()

    // 에이전트가 밖에서 새 테이블 파일을 쓴다.
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
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

    // 밖의 변경은 **채택되지 않는다** — 내 편집만 그대로다.
    expect(Object.values(store.state.model.tables).map((t) => t.physicalName).sort())
      .toEqual(['A', 'B'])
    // 그러나 조용하지 않다 — 사용자가 고를 수 있도록 알린다.
    expect(store.external).toBe(true)
    // 그리고 파일은 손대지 않았다(자동 병합도, 덮어쓰기도 없다).
    expect(await readFile(join(dir, 'erdd/tables/ORD.yaml'), 'utf8')).toContain('name: ORD')
  })

  it('flush() 가 쓰기에 실패하면 dirty 를 유지해 다음 flush 가 재시도한다', async () => {
    const dir = await project({})
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([createTable('t1', 'A')])
    // 드래프트의 임시 파일 자리에 디렉터리를 둔다 — writeFile 이 EISDIR 로 던져 flush() 가 실패한다.
    await mkdir(join(dir, '.erdd/draft.json.tmp'), { recursive: true })
    await expect(store.flush()).rejects.toThrow()
    expect(await hasDraft(dir)).toBe(false)
    // 실패했으니 #draftPending 이 꺼지면 안 된다 — 장애물을 치우면 다음 flush 가 실제로 써야 한다.
    await rm(join(dir, '.erdd/draft.json.tmp'), { recursive: true, force: true })
    await store.flush()
    expect(await hasDraft(dir)).toBe(true)
    expect(store.dirty).toBe(true)
  })
})

/**
 * ⚠️ **Task 4(`save()`)가 되살릴 둘이다.** 이 describe 는 「flush 가 파일을 쓴다」를 재던
 * 것인데, flush 의 대상이 드래프트로 바뀌어 그 주어가 사라졌다. 파일을 쓰는 것은 이제
 * `save()` 뿐이므로 다음 태스크에서 `store.flush()` → `await store.save()` 로 바꾸고 skip 을 뗀다.
 * **지우지 않는다** — 되살릴 것을 잊지 않기 위해서다.
 */
describe.skip('FileStore.flush', () => {
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

/** 픽스처 `MBR` 의 테이블 id. 파일에 id 가 **이미 있다**(신규 id 되쓰기를 타지 않는다). */
const MBR_ID = '018f6b0e-0000-7000-8000-000000000001'

/**
 * 물리명만 바꾸는 update op.
 *
 * ⚠️ 계획서는 `patch` 를 쓴다고 적었으나 실제 `UpdateOp` 는
 * `changes: Record<string, { from, to }>` 다(`packages/core/src/op.ts`). `applyOps` 는 `to` 만
 * 적용하고 `from` 은 검증하지 않는다 — 계획의 단언을 실제에 맞춰 정정한 것이다.
 */
const renameMbr = (to: string): Op => ({
  action: 'update',
  entity: 'table',
  entityId: MBR_ID,
  changes: { physicalName: { from: 'MBR', to } },
})

describe('FileStore 드래프트', () => {
  /**
   * 🔥 **이 사이클의 존재 이유다.** 편집이 파일을 건드리지 않는다는 것을 직접 잠근다.
   *
   * ⚠️ 픽스처의 테이블 파일에 `id` 가 **이미 있어야 한다** — 없으면 `#loadOnce` 의 신규 id
   * 되쓰기가 파일을 건드려, 이 테스트가 「편집이 안 썼다」가 아니라 「되쓰기가 썼다」를 재게 된다.
   */
  it('편집과 flush 는 erdd/ 를 건드리지 않는다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    const before = await stat(join(dir, 'erdd/tables/MBR.yaml'))
    const bodyBefore = await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')

    await store.mutate([renameMbr('MBR2')])
    await store.flush()

    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toBe(bodyBefore)
    expect((await stat(join(dir, 'erdd/tables/MBR.yaml'))).mtimeMs).toBe(before.mtimeMs)
    // 개명 결과가 새 파일로 새어 나가지도 않는다.
    await expect(readFile(join(dir, 'erdd/tables/MBR2.yaml'), 'utf8')).rejects.toThrow()
    // 대신 드래프트가 생겼다.
    expect(await hasDraft(dir)).toBe(true)
    expect(store.dirty).toBe(true)
  })

  it('드래프트에 담긴 모델이 편집 결과다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([renameMbr('MBR2')])
    await store.flush()

    const r = await readDraft(dir)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.draft.model.tables[MBR_ID]!.physicalName).toBe('MBR2')
    expect(r.draft.seq).toBe(1)
  })

  /**
   * 되돌리는 편집(A→B→A)에서 「미저장」이 남으면 표시가 거짓말을 하고 저장 버튼이 쓸 것 없는
   * 저장을 하게 된다. **그래서 `#dirty` 는 플래그가 아니라 내용 비교다.**
   */
  it('편집을 되돌리면 dirty 가 내려가고 드래프트 파일이 지워진다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const store = new FileStore(dir)
    await store.load()
    await store.mutate([renameMbr('MBR2')])
    await store.flush()
    expect(store.dirty).toBe(true)

    await store.mutate([{
      action: 'update', entity: 'table', entityId: MBR_ID,
      changes: { physicalName: { from: 'MBR2', to: 'MBR' } },
    }])
    await store.flush()
    expect(store.dirty).toBe(false)
    expect(await hasDraft(dir)).toBe(false)
  })

  it('adoptDraft 가 재시작을 넘어 편집을 되살린다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const first = new FileStore(dir)
    await first.load()
    await first.mutate([renameMbr('MBR2')])
    await first.flush()

    const second = new FileStore(dir)
    await second.load()
    await second.adoptDraft()
    expect(second.state.model.tables[MBR_ID]!.physicalName).toBe('MBR2')
    expect(second.dirty).toBe(true)
    // 파일은 여전히 옛 이름이다 — 저장하지 않았으므로.
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('name: MBR\n')
  })

  /**
   * `serve` 가 꺼진 사이 `git pull`·`git checkout` 이 파일을 바꾼 경우다. 조용히 얹으면 사용자는
   * 브랜치가 바뀐 줄 모른 채 저장해 남의 변경을 덮는다.
   */
  it('드래프트의 기준선이 지금 파일과 다르면 external 을 함께 세운다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const first = new FileStore(dir)
    await first.load()
    await first.mutate([renameMbr('MBR2')])
    await first.flush()

    await writeFile(
      join(dir, 'erdd/tables/MBR.yaml'), MBR.replace('logicalName: 회원', 'logicalName: 멤버'), 'utf8',
    )

    const second = new FileStore(dir)
    await second.load()
    await second.adoptDraft()
    expect(second.dirty).toBe(true)
    expect(second.external).toBe(true)
    expect(second.state.model.tables[MBR_ID]!.physicalName).toBe('MBR2')
  })

  it('손상 드래프트는 얹지 않고 파일 그대로 연다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    await mkdir(join(dir, '.erdd'), { recursive: true })
    await writeFile(join(dir, '.erdd/draft.json'), '{"model":{}}', 'utf8')

    const store = new FileStore(dir)
    await store.load()
    await store.adoptDraft()
    expect(store.state.model.tables[MBR_ID]!.physicalName).toBe('MBR')
    expect(store.dirty).toBe(false)
  })

  /**
   * 첫 `load()` 가 실패하면(파일 손상) 얹을 기준선이 없다. 들고 있다가 파일이 고쳐져 로드가
   * 성공하는 순간 얹는다 — 그때까지 편집은 어차피 잠겨 있다.
   */
  it('파일이 깨진 채로 기동하면 드래프트를 들고 있다가 복구 시 얹는다', async () => {
    const dir = await project({ 'erdd/tables/MBR.yaml': MBR })
    const first = new FileStore(dir)
    await first.load()
    await first.mutate([renameMbr('MBR2')])
    await first.flush()

    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: [불완전\n', 'utf8')
    const second = new FileStore(dir)
    expect((await second.load()).ok).toBe(false)
    await second.adoptDraft()
    expect(second.dirty).toBe(false)          // 아직 얹지 않았다

    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), MBR, 'utf8')
    expect((await second.load()).ok).toBe(true)
    expect(second.state.model.tables[MBR_ID]!.physicalName).toBe('MBR2')
    expect(second.dirty).toBe(true)
  })
})
