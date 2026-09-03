import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NAMING_RULES, createEmptyModel, parseDdl, planDdlImport,
} from '@erdd/core'
import { computeAutoLayout } from './auto-layout.js'
import { applyDdlImport } from './ddl-import-edits.js'

const DDL = `
  CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
  CREATE TABLE ORD (
    ORD_NO bigint NOT NULL, MBR_NO bigint NOT NULL,
    PRIMARY KEY (ORD_NO),
    FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
  );`

/**
 * 동작은 전부 core 의 `ddl-apply.test.ts` 가 갖고 있다(그 파일이 여기서 옮겨 간 것이다).
 * 여기 남은 것은 **web 이 dagre 계층 배치를 주입한다**는 사실 하나다 — core 의 기본값은
 * 격자라, 주입을 빠뜨리면 좌표가 조용히 격자로 바뀌고 아무 테스트도 그것을 잡지 못한다.
 */
describe('applyDdlImport — web 은 dagre 배치를 주입한다', () => {
  it('좌표가 computeAutoLayout 의 결과와 같다(core 기본 격자가 아니다)', () => {
    let n = 0
    const model = createEmptyModel()
    const plan = planDdlImport(model, parseDdl(DDL), 'postgresql', DEFAULT_NAMING_RULES)
    const after = applyDdlImport(model, plan, () => `id${++n}`)

    // core 의 격자와 같은 입력(너비 260 · 높이 40 + 컬럼수*28 · FK 간선)으로 dagre 를 돌린다.
    const expected = computeAutoLayout(
      plan.tables.map((t) => ({ id: t.physicalName, width: 260, height: 40 + t.columns.length * 28 })),
      plan.relationships.map((r) => ({ source: r.parentPhysicalName, target: r.childPhysicalName })),
    )
    const actual = new Map(
      Object.values(after.tables).map((t) => [t.physicalName, t.position]),
    )
    expect(actual.get('MBR')).toEqual(expected.get('MBR'))
    expect(actual.get('ORD')).toEqual(expected.get('ORD'))

    // 격자(0,0)·(320,0)와 실제로 다르다 — 같으면 위 단언이 무엇도 구분하지 못한다.
    expect(actual.get('ORD')).not.toEqual({ x: 320, y: 0 })
    expect(actual.get('ORD')!.y).toBeGreaterThan(actual.get('MBR')!.y)
  })
})
