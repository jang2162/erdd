import { describe, expect, it } from 'vitest'
import { CHANGESET_BANNER, formatChangeset } from './format.js'
import { fmtIdent, fmtRaw, fmtString, fmtType } from './syntax.js'
import type { Changeset } from './types.js'

/** 줄 끝 꼬리표 규칙: 64열에 맞추고, 본문이 길면 두 칸 띄운다. */
const tag = (text: string, id: string) => `${text.padEnd(Math.max(64, text.length + 2))}@${id}`

describe('값 표기', () => {
  it('식별자는 안전하면 그대로, 아니면 큰따옴표 — 값 자리 키워드와 같은 이름도 감싼다', () => {
    expect(fmtIdent('MBR_NO')).toBe('MBR_NO')
    expect(fmtIdent('주문 상세')).toBe('"주문 상세"')
    expect(fmtIdent('first')).toBe('"first"')
    expect(fmtIdent('none')).toBe('"none"')
    expect(fmtIdent('FIRST')).toBe('FIRST')
    expect(fmtIdent('a"b')).toBe('"a\\"b"')
  })
  it('타입은 이름 + 괄호 하나까지 그대로, 공백이 있으면 큰따옴표', () => {
    expect(fmtType('VARCHAR(10)')).toBe('VARCHAR(10)')
    expect(fmtType('DECIMAL(10, 2)')).toBe('DECIMAL(10, 2)')
    expect(fmtType('INT UNSIGNED')).toBe('"INT UNSIGNED"')
  })
  it('문자열·기본값은 \\ 와 따옴표·줄바꿈만 이스케이프한다', () => {
    expect(fmtString("a'b\nc\\")).toBe("'a\\'b\\nc\\\\'")
    expect(fmtRaw("it's `x`")).toBe("`it's \\`x\\``")
  })
})

describe('formatChangeset', () => {
  it('머릿말 → 빈 줄 → 문장. 블록 앞뒤에만 빈 줄을 두고 줄 끝에 @id 를 단다', () => {
    const cs: Changeset = {
      header: { format: 1, name: '회원 등급 추가', created: '2026-09-23T04:12:00Z', baseline: false },
      statements: [
        { kind: 'dropIndex', index: { id: 'i9', name: 'IX_OLD', table: 'MBR', columns: [{ name: 'MBR_NM', direction: 'asc' }], unique: false } },
        { kind: 'renameTable', id: 't9', from: 'ORD_DTL', to: 'ORD_ITEM' },
        {
          kind: 'alterTable', id: 't2', name: 'MBR', actions: [
            {
              kind: 'addColumn', after: 'MBR_NM',
              column: { id: 'c5', name: 'GRD_CD', type: 'VARCHAR(10)', dialectTypes: {}, nullable: true, default: null, increment: false, comment: '등급코드', check: [] },
            },
            { kind: 'modifyColumn', id: 'c3', name: 'MBR_NM', changes: [{ field: 'type', from: 'VARCHAR(50)', to: 'VARCHAR(100)' }, { field: 'nullable', from: true, to: false }] },
            { kind: 'primaryKey', from: ['MBR_NO'], to: ['MBR_NO', 'GRD_CD'] },
          ],
        },
        { kind: 'addForeignKey', fk: { id: 'r1', name: 'FK_MBR_GRD', child: 'MBR', childColumns: ['GRD_CD'], parent: 'GRD', parentColumns: ['GRD_CD'], cardinality: '1:1', uniqueName: 'UQ_MBR_GRD_CD' } },
      ],
    }
    expect(formatChangeset(cs)).toBe([
      CHANGESET_BANNER,
      "changeset '회원 등급 추가' {",
      '  format: 1',
      "  created: '2026-09-23T04:12:00Z'",
      '}',
      '',
      tag('drop index IX_OLD on MBR (MBR_NM asc)', 'i9'),
      tag('rename table ORD_DTL -> ORD_ITEM', 't9'),
      '',
      tag('alter table MBR {', 't2'),
      tag("  add column GRD_CD VARCHAR(10) [null, comment: '등급코드', after: MBR_NM]", 'c5'),
      tag('  modify column MBR_NM {', 'c3'),
      '    type: VARCHAR(50) -> VARCHAR(100)',
      '    nullable: yes -> no',
      '  }',
      '  primary key: (MBR_NO) -> (MBR_NO, GRD_CD)',
      '}',
      '',
      tag('add foreign key FK_MBR_GRD MBR(GRD_CD) -> GRD(GRD_CD) [1:1, unique: UQ_MBR_GRD_CD]', 'r1'),
      '',
    ].join('\n'))
  })

  it('baseline 이면 머릿말에 baseline: true 를 싣고, 문장이 없으면 머릿말만 낸다', () => {
    const text = formatChangeset({ header: { format: 1, name: 'x', created: '2026-01-01T00:00:00Z', baseline: true }, statements: [] })
    expect(text).toBe(`${CHANGESET_BANNER}\nchangeset 'x' {\n  format: 1\n  created: '2026-01-01T00:00:00Z'\n  baseline: true\n}\n`)
  })
})
