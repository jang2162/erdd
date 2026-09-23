import { describe, expect, it } from 'vitest'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import type { Changeset, ColumnDef } from './types.js'

const col = (id: string, name: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  id, name, type: 'VARCHAR(10)', dialectTypes: {}, nullable: true, default: null,
  increment: false, comment: null, check: [], ...extra,
})

/** 문법이 표현하는 모든 문장·동작·값을 한 번씩 지나가는 기록. */
const ALL: Changeset = {
  header: { format: 1, name: "이름에 '따옴표'", created: '2026-09-23T04:12:00Z', baseline: true },
  statements: [
    { kind: 'dropForeignKey', fk: { id: 'r1', name: 'FK_A', child: 'ORD', childColumns: ['MBR_NO'], parent: 'MBR', parentColumns: ['MBR_NO'], cardinality: '1:1', uniqueName: 'UQ_ORD_MBR_NO' } },
    { kind: 'dropIndex', index: { id: 'i1', name: 'IX_A', table: 'ORD', columns: [{ name: 'A', direction: 'asc' }, { name: 'B', direction: 'desc' }], unique: true } },
    { kind: 'renameIndex', id: 'i2', table: 'ORD', from: 'IX_B', to: 'IX_C' },
    {
      kind: 'dropTable', table: {
        id: 't1', name: '주문 상세', comment: '줄\n바꿈',
        columns: [col('c1', 'first', { nullable: false, increment: true, type: 'BIGINT' })],
        primaryKey: ['first'],
        indexes: [{ id: 'i3', name: 'IX_D', table: '주문 상세', columns: [{ name: 'first', direction: 'desc' }], unique: false }],
      },
    },
    { kind: 'renameTable', id: 't2', from: 'OLD', to: 'NEW' },
    {
      kind: 'createTable', table: {
        id: 't3', name: 'T3', comment: null,
        columns: [
          col('c2', 'A', { type: 'INT UNSIGNED', default: "it's `x`\\", check: ['Y', 'N'], dialectTypes: { postgresql: 'TEXT', mssql: 'NVARCHAR(10)' }, comment: 'c' }),
          col('c3', 'none', { type: 'DECIMAL(10, 2)' }),
        ],
        primaryKey: [], indexes: [],
      },
    },
    {
      kind: 'alterTable', id: 't4', name: 'MBR', actions: [
        { kind: 'dropColumn', column: col('c4', 'X') },
        { kind: 'renameColumn', id: 'c5', from: 'A', to: 'B' },
        { kind: 'addColumn', column: col('c6', 'C'), after: null },
        { kind: 'addColumn', column: col('c7', 'D'), after: 'first' },
        {
          kind: 'modifyColumn', id: 'c8', name: 'E', changes: [
            { field: 'type', from: 'VARCHAR(1)', to: 'DECIMAL(10, 2)' },
            { field: 'dialects', from: {}, to: { mysql: 'TEXT' } },
            { field: 'nullable', from: true, to: false },
            { field: 'default', from: null, to: "'a'" },
            { field: 'increment', from: false, to: true },
            { field: 'comment', from: 'x', to: null },
            { field: 'check', from: [], to: ['1'] },
            { field: 'position', from: 'A', to: null },
          ],
        },
        { kind: 'primaryKey', from: [], to: ['B', 'C'] },
        { kind: 'tableComment', from: null, to: "회원 '기본'" },
      ],
    },
    { kind: 'addIndex', index: { id: 'i4', name: 'IX_E', table: 'MBR', columns: [{ name: 'B', direction: 'asc' }], unique: false } },
    { kind: 'addForeignKey', fk: { id: 'r2', name: 'FK_B', child: 'MBR', childColumns: ['B', 'C'], parent: 'NEW', parentColumns: ['X', 'Y'], cardinality: '1:N', uniqueName: null } },
  ],
}

/** 파서가 붙이는 줄 번호를 걷어 원본과 비교한다. */
const stripLines = <T>(v: T): T => JSON.parse(JSON.stringify(v, (k, x: unknown) => (k === 'line' ? undefined : x))) as T

describe('parseChangeset', () => {
  it('직렬화한 것을 그대로 되읽는다 — 모든 문장·동작·값', () => {
    const r = parseChangeset(formatChangeset(ALL))
    if (!r.ok) throw new Error(`${r.line}: ${r.message}`)
    expect(stripLines(r.changeset)).toEqual(ALL)
  })

  it('문장과 동작에 원본의 줄 번호를 붙인다', () => {
    const text = formatChangeset(ALL)
    const r = parseChangeset(text)
    if (!r.ok) throw new Error(r.message)
    const lines = text.split('\n')
    const alter = r.changeset.statements.find((s) => s.kind === 'alterTable')!
    expect(lines[alter.line! - 1]).toContain('alter table MBR {')
    if (alter.kind === 'alterTable') expect(lines[alter.actions[1]!.line! - 1]).toContain('rename column A -> B')
  })

  it('CRLF·BOM·들여쓰기가 달라도 읽는다', () => {
    const text = `﻿${formatChangeset(ALL)}`.replace(/\n/g, '\r\n').replace(/\r\n {2}column/g, '\r\n\tcolumn')
    const r = parseChangeset(text)
    if (!r.ok) throw new Error(`${r.line}: ${r.message}`)
    expect(stripLines(r.changeset)).toEqual(ALL)
  })

  it('배너 주석이 없는 파일 앞의 BOM 도 벗긴다', () => {
    const text = '﻿' + "changeset 'x' {\n  format: 1\n  created: 'c'\n}\nrename table A -> B  @t1\n"
    const r = parseChangeset(text)
    if (!r.ok) throw new Error(`${r.line}: ${r.message}`)
    expect(r.changeset.statements).toEqual([{ kind: 'renameTable', id: 't1', from: 'A', to: 'B', line: 5 }])
  })

  it('머릿말이 없으면 1행에서 멈춘다', () => {
    expect(parseChangeset('')).toMatchObject({ ok: false, line: 1 })
    expect(parseChangeset('rename table A -> B  @t1\n')).toMatchObject({ ok: false, line: 1 })
  })

  it('모르는 문장·빠진 @id·더 새 format·닫히지 않은 문자열은 그 줄에서 멈춘다', () => {
    const head = "changeset 'x' {\n  format: 1\n  created: '2026-01-01T00:00:00Z'\n}\n"
    expect(parseChangeset(`${head}truncate table A  @t1\n`)).toMatchObject({ ok: false, line: 5 })
    expect(parseChangeset(`${head}rename table A -> B\n`)).toMatchObject({ ok: false, line: 5 })
    const future = parseChangeset("changeset 'x' {\n  format: 2\n  created: 'x'\n}\n")
    expect(future).toMatchObject({ ok: false })
    if (!future.ok) expect(future.message).toContain('CLI 를 올리세요')
    expect(parseChangeset(`${head}alter table A {  @t1\n  comment: 'a -> 'b'\n}\n`)).toMatchObject({ ok: false, line: 6 })
  })

  it('// 주석 줄과 빈 줄은 건너뛴다', () => {
    const r = parseChangeset("// 머리 주석\n\nchangeset 'x' {\n  format: 1\n  created: 'c'\n}\n// 문장 사이 주석\nrename table A -> B  @t1\n")
    if (!r.ok) throw new Error(r.message)
    expect(r.changeset.statements).toEqual([{ kind: 'renameTable', id: 't1', from: 'A', to: 'B', line: 8 }])
  })
})
