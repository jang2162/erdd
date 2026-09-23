import { describe, expect, it } from 'vitest'
import {
  exportLibraryFile, formatLibraryFileIssues, libraryItemsOf, parseLibraryFile, stringifyLibraryFile,
  MAX_LIBRARY_FILE_ITEMS, type LibraryFileDoc,
} from './library-file.js'
import type { LibraryItem } from './resource-sync.js'

const DOMAIN_PAYLOAD = {
  name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
  dialectTypes: { postgresql: 'numeric(15,2)', mysql: null, oracle: null, mssql: null },
  defaultValue: '0', allowedValues: [], description: null,
}
const ITEMS: LibraryItem[] = [
  { id: '0003', kind: 'term', version: 2, payload: { logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: '0001', description: null } },
  { id: '0002', kind: 'word', version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null } },
  { id: '0001', kind: 'domain', version: 3, payload: DOMAIN_PAYLOAD },
]
const LIB = { id: 'lib-1', name: '표준', description: '설명' }

describe('exportLibraryFile / parseLibraryFile', () => {
  it('내보낸 파일을 배포 엄격도로 다시 읽으면 항목이 같다(왕복 항등)', () => {
    const { text, danglingDomainRefs } = exportLibraryFile(LIB, ITEMS)
    expect(danglingDomainRefs).toBe(0)
    const parsed = parseLibraryFile(text, 'distribution')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    expect(parsed.doc.library).toEqual(LIB)
    expect(libraryItemsOf(parsed.doc)).toEqual([...ITEMS].sort((a, b) => (a.id < b.id ? -1 : 1)))
  })

  it('입력 순서를 섞어도 바이트가 같다(결정성)', () => {
    const a = exportLibraryFile(LIB, ITEMS).text
    const b = exportLibraryFile(LIB, [ITEMS[1]!, ITEMS[2]!, ITEMS[0]!]).text
    expect(b).toBe(a)
    // payload 키 순서가 달라도 같다
    const shuffled = ITEMS.map((i) => ({ ...i, payload: Object.fromEntries(Object.entries(i.payload).reverse()) }))
    expect(exportLibraryFile(LIB, shuffled).text).toBe(a)
  })

  it('종류 안에서 id 코드 단위 오름차순으로 쓴다 — 종류당 1개뿐이면 못 잡는 회귀(kind-내부 정렬)를 고정', () => {
    // word 가 2개, 종류 순서(domain→word)와 id 순서가 어긋난다(도메인 id 가 word 항목들 사이에 낀다).
    const domain5: LibraryItem = { id: '0005', kind: 'domain', version: 1, payload: DOMAIN_PAYLOAD }
    const word9: LibraryItem = { id: '0009', kind: 'word', version: 1, payload: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null } }
    const word2: LibraryItem = { id: '0002', kind: 'word', version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null } }
    const a = exportLibraryFile(LIB, [domain5, word9, word2]).text
    const b = exportLibraryFile(LIB, [word2, domain5, word9]).text
    expect(b).toBe(a)   // 입력 순서가 달라도 바이트가 같다
    const parsed = parseLibraryFile(a, 'distribution')
    if (!parsed.ok) throw new Error('parse')
    expect(parsed.doc.kinds.word!.map((e) => e.id)).toEqual(['0002', '0009'])   // 실제로 id 오름차순
  })

  it('네 종류 키를 언제나 모두 쓴다(빈 종류는 [])', () => {
    const text = exportLibraryFile(LIB, [ITEMS[1]!]).text
    const parsed = parseLibraryFile(text, 'distribution')
    if (!parsed.ok) throw new Error('parse')
    expect(parsed.doc.kinds).toEqual({ domain: [], word: [expect.anything()], term: [], customField: [] })
  })

  it('삭제된 도메인을 가리키는 용어는 domainId: null 로 쓰고 건수를 센다', () => {
    const { text, danglingDomainRefs } = exportLibraryFile(LIB, [ITEMS[0]!])
    expect(danglingDomainRefs).toBe(1)
    const parsed = parseLibraryFile(text, 'distribution')
    if (!parsed.ok) throw new Error('parse')
    expect(parsed.doc.kinds.term![0]!.fields.domainId).toBeNull()
  })

  it('옛 행(englishName 없음)도 배포 파일에서는 완전값이다', () => {
    const old: LibraryItem = { id: 'w', kind: 'word', version: 1, payload: { logicalName: '회원', abbreviation: 'MBR', description: null } }
    const parsed = parseLibraryFile(exportLibraryFile(LIB, [old]).text, 'distribution')
    if (!parsed.ok) throw new Error('parse')
    expect(parsed.doc.kinds.word![0]!.fields).toEqual({ logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null })
  })
})

describe('parseLibraryFile — 원천 파일', () => {
  const head = 'format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\n'

  it('빠진 키는 채우지 않는다(말하지 않음)', () => {
    const parsed = parseLibraryFile(`${head}words:\n  - { logicalName: 고객, abbreviation: CUST }\n`, 'source')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    expect(parsed.doc.kinds.word![0]!.fields).toEqual({ logicalName: '고객', abbreviation: 'CUST' })
    expect(parsed.doc.kinds).not.toHaveProperty('domain')   // 키 부재 = 그 종류를 말하지 않음
  })

  it('빈 목록과 키 부재를 구별한다', () => {
    const parsed = parseLibraryFile(`${head}customFields: []\n`, 'source')
    if (!parsed.ok) throw new Error('parse')
    expect(parsed.doc.kinds).toEqual({ customField: [] })
  })

  it('도메인 dialectTypes 는 부분만 적어도 된다', () => {
    const parsed = parseLibraryFile(`${head}domains:\n  - { name: 금액, logicalType: DECIMAL, dialectTypes: { mysql: decimal } }\n`, 'source')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    expect(parsed.doc.kinds.domain![0]!.fields.dialectTypes).toEqual({ mysql: 'decimal' })
  })

  it('용어는 domainName 으로 도메인을 가리킬 수 있다 — domainId 와 함께는 안 된다', () => {
    const ok = parseLibraryFile(`${head}terms:\n  - { logicalName: 고객번호, physicalName: CUST_NO, domainName: 식별번호 }\n`, 'source')
    if (!ok.ok) throw new Error(JSON.stringify(ok.issues))
    expect(ok.doc.kinds.term![0]).toEqual({ domainName: '식별번호', fields: { logicalName: '고객번호', physicalName: 'CUST_NO' } })
    const both = parseLibraryFile(`${head}terms:\n  - { logicalName: 고객번호, physicalName: CUST_NO, domainName: 식별번호, domainId: null }\n`, 'source')
    expect(both.ok).toBe(false)
  })

  it('BOM 과 CRLF 가 있어도 읽는다', () => {
    const text = `﻿${head}words:\n  - { logicalName: 고객 }\n`.replace(/\n/g, '\r\n')
    expect(parseLibraryFile(text, 'source').ok).toBe(true)
  })
})

describe('parseLibraryFile — 오류', () => {
  const head = 'format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\n'
  const issuesOf = (text: string, strictness: 'source' | 'distribution' = 'source') => {
    const r = parseLibraryFile(text, strictness)
    if (r.ok) throw new Error('오류가 나야 한다')
    return r.issues
  }

  it('모르는 formatVersion 은 오류로 멈춘다', () => {
    expect(issuesOf('format: erdd-library\nformatVersion: 2\nlibrary: { name: x }\n')).toEqual([
      expect.objectContaining({ path: 'formatVersion' }),
    ])
  })

  it('다른 format 이면 ERDD 라이브러리 파일이 아니라고 한다', () => {
    expect(issuesOf('format: something\nformatVersion: 1\n')[0]!.path).toBe('format')
  })

  it('파일 밖을 가리키는 domainId 는 오류다', () => {
    const issues = issuesOf(`${head}terms:\n  - { logicalName: 고객번호, physicalName: CUST_NO, domainId: nope }\n`)
    expect(issues).toEqual([expect.objectContaining({ path: 'terms[0] (고객번호): domainId' })])
  })

  it('같은 종류·같은 이름(trim)이 둘이면 오류다 — 커스텀 항목은 target 까지 같을 때만', () => {
    expect(issuesOf(`${head}words:\n  - { logicalName: 고객 }\n  - { logicalName: ' 고객 ' }\n`)).toHaveLength(1)
    const cf = (target: string) => `{ name: 비고, target: ${target}, type: text }`
    expect(parseLibraryFile(`${head}customFields:\n  - ${cf('table')}\n  - ${cf('column')}\n`, 'source').ok).toBe(true)
  })

  it('strict payload 의 모르는 키는 위치와 함께 오류다', () => {
    const issues = issuesOf(`${head}words:\n  - { logicalName: 고객, abbrevation: CUST }\n`)
    expect(issues).toEqual([expect.objectContaining({ path: 'words[0] (고객)', message: expect.stringContaining('abbrevation') })])
  })

  it('원천 파일도 필수 키는 있어야 한다', () => {
    expect(issuesOf(`${head}terms:\n  - { logicalName: 고객번호 }\n`)).toEqual([
      expect.objectContaining({ path: 'terms[0] (고객번호): physicalName' }),
    ])
  })

  it('배포 엄격도에서는 library.id 와 항목 id·version 이 필수다', () => {
    const issues = issuesOf(`${head}words:\n  - { logicalName: 고객, abbreviation: C, englishName: null, description: null }\n`, 'distribution')
    expect(issues.map((i) => i.path)).toEqual(['library.id', 'words[0] (고객): id', 'words[0] (고객): version'])
  })

  it('오류를 모아서 낸다', () => {
    const issues = issuesOf(`${head}words:\n  - { logicalName: 1 }\n  - { logicalName: 고객, x: 1 }\n`)
    expect(issues.length).toBeGreaterThanOrEqual(2)
  })

  it('별칭 폭탄은 오류로 거절한다(매달리지 않는다)', () => {
    const bomb = ['a: &a [x,x,x,x,x,x,x,x,x,x]', ...'bcdefgh'.split('').map((c, i) =>
      `${c}: &${c} [${Array(10).fill(`*${'abcdefgh'[i]}`).join(',')}]`)].join('\n')
    expect(parseLibraryFile(bomb, 'source').ok).toBe(false)
  })

  it('중복 키는 오류다', () => {
    expect(parseLibraryFile(`${head}library: { name: 또 }\n`, 'source').ok).toBe(false)
  })

  it(`항목이 ${MAX_LIBRARY_FILE_ITEMS}건을 넘으면 항목 검증 전에 거절한다`, () => {
    const words = Array.from({ length: MAX_LIBRARY_FILE_ITEMS + 1 }, (_, i) => `  - { logicalName: w${i} }`).join('\n')
    const issues = issuesOf(`${head}words:\n${words}\n`)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain(String(MAX_LIBRARY_FILE_ITEMS))
  })

  it('formatLibraryFileIssues 는 20건까지 보이고 나머지는 「외 N건」', () => {
    const lines = formatLibraryFileIssues(Array.from({ length: 25 }, (_, i) => ({ path: `p${i}`, message: 'm' })))
    expect(lines).toHaveLength(21)
    expect(lines[20]).toBe('… 외 5건')
    expect(lines[0]).toBe('p0 — m')
  })
})

describe('stringifyLibraryFile', () => {
  it('원천 문서를 쓰고 다시 읽으면 같다 — 적힌 종류만 쓴다', () => {
    const doc: LibraryFileDoc = {
      library: { name: '엑셀', description: '' },
      kinds: {
        domain: [{ id: 'domain:2', fields: { name: '금액', logicalType: 'DECIMAL', dialectTypes: { mysql: 'decimal' } } }],
        term: [{ domainName: '식별번호', fields: { logicalName: '고객번호', physicalName: 'CUST_NO' } }],
      },
    }
    const parsed = parseLibraryFile(stringifyLibraryFile(doc), 'source')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    expect(parsed.doc).toEqual(doc)
  })
})

describe('libraryItemsOf', () => {
  it('종류·입력(문서 안) 순서와 무관하게 id 코드 단위 오름차순으로 합친다 — 전역 정렬 고정', () => {
    // exportLibraryFile 을 거치지 않고 문서를 직접 구성한다 — libraryItemsOf 자체의 정렬만 단독으로 잠근다.
    // 종류 순서(domain→word)와 id 순서가 어긋난다: domain 0005 가 word 0002·0009 사이에 낀다.
    const doc: LibraryFileDoc = {
      library: { id: 'lib-1', name: '표준', description: '' },
      kinds: {
        domain: [{ id: '0005', version: 1, fields: DOMAIN_PAYLOAD }],
        word: [
          { id: '0009', version: 1, fields: { logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null } },
          { id: '0002', version: 1, fields: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null } },
        ],
      },
    }
    expect(libraryItemsOf(doc).map((i) => i.id)).toEqual(['0002', '0005', '0009'])
  })
})
