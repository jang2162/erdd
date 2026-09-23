import { describe, expect, it } from 'vitest'
import type { RawSheet } from './excel-import.js'
import { libraryDocFromDictSheets } from './library-excel.js'
import { parseLibraryFile, stringifyLibraryFile } from './library-file.js'
import { planLibraryImport } from './library-import.js'
import type { LibraryItem } from './resource-sync.js'

const words: RawSheet = { key: 'words', headers: ['논리명', '약어'], rows: [['고객', 'CSTMR']] }
const terms: RawSheet = { key: 'terms', headers: ['용어', '물리명', '기본 도메인'], rows: [['고객번호', 'CUST_NO', '식별번호']] }

describe('libraryDocFromDictSheets', () => {
  it('있던 시트만 종류 키가 되고, 커스텀 항목 키는 없다', () => {
    const r = libraryDocFromDictSheets([words], { name: '엑셀', targetDomainNames: [] })
    if (!r.ok) throw new Error('ok 여야 한다')
    expect(Object.keys(r.doc.kinds)).toEqual(['word'])
    expect(r.doc.kinds.word).toEqual([{ fields: { logicalName: '고객', abbreviation: 'CSTMR' } }])
  })

  it('만든 문서는 원천 파일로 직렬화·파싱된다', () => {
    const r = libraryDocFromDictSheets([words, terms], { name: '엑셀', targetDomainNames: ['식별번호'] })
    if (!r.ok) throw new Error('ok')
    expect(parseLibraryFile(stringifyLibraryFile(r.doc), 'source').ok).toBe(true)
  })

  it('없는 컬럼의 기존 값은 건드리지 않는다(영문명·설명 없음)', () => {
    const existing: LibraryItem[] = [{ id: 'w1', kind: 'word', version: 1,
      payload: { logicalName: '고객', abbreviation: 'CUST', englishName: 'CUSTOMER', description: '설명' } }]
    const r = libraryDocFromDictSheets([words], { name: 'x', targetDomainNames: [] })
    if (!r.ok) throw new Error('ok')
    const plan = planLibraryImport(existing, r.doc, 'lib')
    expect(plan.entries[0]!.payload).toEqual({ logicalName: '고객', abbreviation: 'CSTMR', englishName: 'CUSTOMER', description: '설명' })
  })

  it('도메인 시트 없이 용어만 올려도 기존 용어의 도메인 연결이 유지된다', () => {
    const existing: LibraryItem[] = [
      { id: 'd1', kind: 'domain', version: 1, payload: { name: '식별번호', category: null, logicalType: 'BIGINT', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null }, defaultValue: null, allowedValues: [], description: null } },
      { id: 't1', kind: 'term', version: 1, payload: { logicalName: '고객번호', physicalName: 'CUST_NO', domainId: 'd1', description: null } },
    ]
    const r = libraryDocFromDictSheets([terms], { name: 'x', targetDomainNames: ['식별번호'] })
    if (!r.ok) throw new Error('ok')
    expect(r.warnings).toEqual([])
    const plan = planLibraryImport(existing, r.doc, 'lib')
    expect(plan.entries).toEqual([expect.objectContaining({ status: 'unchanged', targetId: 't1' })])
  })

  it('같은 파일의 도메인은 파일 id 로 잇는다', () => {
    const domains: RawSheet = { key: 'domains', headers: ['이름', '논리 타입'], rows: [['식별번호', 'BIGINT']] }
    const r = libraryDocFromDictSheets([domains, terms], { name: 'x', targetDomainNames: [] })
    if (!r.ok) throw new Error('ok')
    const domainId = r.doc.kinds.domain![0]!.id
    expect(r.doc.kinds.term![0]).toEqual({ fields: { logicalName: '고객번호', physicalName: 'CUST_NO', domainId } })
  })

  it('오류 행이 있으면 ok: false 다', () => {
    const bad: RawSheet = { key: 'terms', headers: ['용어', '물리명'], rows: [['고객번호', '']] }
    const r = libraryDocFromDictSheets([bad], { name: 'x', targetDomainNames: [] })
    expect(r.ok).toBe(false)
  })
})
