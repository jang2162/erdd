import { describe, expect, it } from 'vitest'
import type { MergeConflict } from '@erdd/core'
import { renderConflicts } from './conflict-report.js'

const field = (over: Partial<MergeConflict>): MergeConflict => ({
  path: 'erdd/tables/MBR.yaml', kind: 'column', entityId: 'c2', label: '컬럼 MBR.MBR_NM',
  field: 'logicalName', reason: 'field',
  base: '회원명', local: '회원 이름', server: '회원성명', changedFields: [], ...over,
})

describe('renderConflicts', () => {
  it('파일별로 묶고 세 값을 줄바꿈해 보여준다', () => {
    const out = renderConflicts([
      field({}),
      field({
        kind: 'table', entityId: 'tb1', label: '테이블 MBR', field: 'comment',
        base: null, local: '서비스 가입 회원', server: '가입 회원 마스터',
      }),
    ])
    expect(out).toBe([
      '충돌 2건 — push를 중단했습니다.',
      '',
      'erdd/tables/MBR.yaml',
      '  컬럼 MBR.MBR_NM · logicalName',
      '    기준  회원명',
      '    로컬  회원 이름',
      '    서버  회원성명',
      '  테이블 MBR · comment',
      '    기준  (없음)',
      '    로컬  서비스 가입 회원',
      '    서버  가입 회원 마스터',
      '',
      'erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.',
    ].join('\n'))
  })

  it('경로 오름차순, 같은 파일 안에서는 라벨 오름차순이다', () => {
    const out = renderConflicts([
      field({ path: 'erdd/words.yaml', kind: 'word', entityId: 'w1', label: '단어 회원', field: 'abbreviation' }),
      field({ label: '컬럼 MBR.ZZZ' }),
      field({ label: '컬럼 MBR.AAA' }),
    ])
    const order = out.split('\n').filter((l) => l.startsWith('  ') && !l.startsWith('    '))
    expect(order).toEqual([
      '  컬럼 MBR.AAA · logicalName',
      '  컬럼 MBR.ZZZ · logicalName',
      '  단어 회원 · abbreviation',
    ])
  })

  it('엔티티 통째 충돌은 사유와 상대편 변경 필드를 쓰고 없는 쪽을 (삭제됨)으로 표시한다', () => {
    const out = renderConflicts([field({
      kind: 'index', entityId: 'ix2', label: '인덱스 ORD.IX_ORD_01',
      field: '*', reason: 'local-delete',
      base: 'ORD.IX_ORD_01', local: null, server: 'ORD.IX_ORD_01',
      changedFields: ['name'],
    })])
    expect(out).toContain('  인덱스 ORD.IX_ORD_01 · 로컬에서 삭제, 서버에서 수정 (name)')
    expect(out).toContain('    로컬  (삭제됨)')
  })

  it('서버 삭제 충돌의 사유 문구는 반대다', () => {
    const out = renderConflicts([field({
      field: '*', reason: 'server-delete', local: 'MBR.MBR_NM', server: null, changedFields: ['name'],
    })])
    expect(out).toContain('· 로컬에서 수정, 서버에서 삭제 (name)')
    expect(out).toContain('    서버  (삭제됨)')
  })
})
