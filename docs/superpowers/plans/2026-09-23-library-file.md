# 공용 라이브러리 파일 내보내기·가져오기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 공용 라이브러리를 `.erdd-lib.yaml` 로 내보내고, 라이브러리 파일·Excel 로 서버 라이브러리에 갱신 병합하며, 서버 없는 로컬 프로젝트가 `erdd dict pull --file` 로 받아 3-way 재동기화한다.

**Architecture:** 판정은 전부 core 순수 함수다 — 파일 파싱·직렬화(`library-file.ts`), 갱신 병합 계획·쓰기 목록(`library-import.ts`), Excel → 원천 파일(`library-excel.ts`), 워크북 → 시트 격자(`excel-workbook.ts`). 서버는 라이브러리 행 락 안에서 계획을 다시 세워 한 트랜잭션으로 쓰고, CLI·웹은 같은 함수로 미리보기·검증한다. 로컬 `dict pull --file` 은 기존 `planResync` 를 파일 항목에 그대로 돌린다.

**Tech Stack:** TypeScript, zod 4, `yaml` 2.8, drizzle-orm + PostgreSQL, tRPC 11, React 19 + TanStack Query, exceljs 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-23-library-file-design.md`

**작업 위치:** 워크트리 `.worktrees/feat-library-file`, 브랜치 `feat/library-file`(로컬 `main` 기준). 포트·격리 DB 는
`docs/guides/setup.md` 의 할당표에서 비어 있는 트랙을 쓴다.

## Global Constraints

- 응답·커밋 메시지·주석·화면 문구·CLI 문구는 **한국어**. 커밋 말미 트레일러 2줄(`Co-Authored-By: …`, `Claude-Session: …`).
- 커밋은 **경로를 명시**한다(`git add <경로들> && git commit …` 한 명령, 또는 `git commit -- <경로들>`). `git add -A`·`commit -a` 금지.
- 🔥 서버 테스트는 **test DB 를 직접 가리켜** 돌린다: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/<test DB>' pnpm --filter @erdd/server exec vitest run <파일>`. **`.env` 를 로드하지 마라** — 개발 DB 가 비워진다. `DATABASE_URL` 이 없으면 서버 스위트는 **조용히 건너뛴다**(통과가 아니다).
- 타입 검사는 출력이 아니라 종료 코드로 판정한다: `pnpm -s -r typecheck; echo "exit=$?"` → `exit=0`.
- 코드 주석이 규칙을 가리킬 때는 **`docs/guides/` 의 절 제목**으로 가리킨다(`파일:줄번호` 금지, `ops/`·`plans/` 인용 금지).
- 정렬 동률 깨기·결정적 순서에는 **코드 단위 비교**(`a < b ? -1 : …`)를 쓴다. `localeCompare` 금지.
- 파일 상한 `MAX_LIBRARY_FILE_ITEMS = 50_000`, 확장자 `.erdd-lib.yaml`, `format: erdd-library`, `formatVersion: 1`.
- 새로 토큰에 여는 프로시저는 정확히 셋: `resource.library.list`·`resource.library.export`·`resource.library.import`.
- 구분력 실증은 **커밋 뒤에** 한다(`docs/guides/worktree-workflow.md` 「구분력 실증은 반드시 커밋 뒤에 한다」). 새 파일은 `git checkout` 으로 복구되지 않는다 — 스크래치에 복사해 두고 diff 로 복구를 확인한다.
- 브리프의 기대값이 실제와 어긋나면 **프로덕션 코드를 기대값에 맞추지 말고** 관찰을 명령 출력과 함께 보고한다.

## Review Focus

1. **내보낸 파일을 그대로 다시 가져오기** — 전 항목 `unchanged`, 버전·`updatedAt` 불변, 「바뀐 항목이 없습니다」. (Task 2 · Task 5 에 테스트)
2. **컬럼이 빠진 Excel(영문명·설명 없음)을 기존 라이브러리에 다시 가져오기** — 빠진 컬럼의 기존 값이 그대로 남는다. 도메인 시트 없이 용어 시트만 올려도 기존 용어의 도메인 연결이 유지된다. (Task 3 에 테스트)
3. **Windows 에서 고친 파일(BOM + CRLF)** — 정상 파싱. (Task 1 에 테스트)
4. **악의적·깨진 YAML(별칭 폭탄, 중복 키)** — 멈추거나 매달리지 않고 파일 오류로 거절. (Task 1 에 테스트)
5. **`--prune` 이 남는 용어가 가리키는 도메인을 지우려는 경우** — 도메인을 지우지 않고 경고한다(참조가 끊긴 용어를 만들지 않는다). (Task 2 에 테스트)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/core/src/library-file.ts` (신규) | 포맷 상수, `parseLibraryFile`(엄격도 둘), `stringifyLibraryFile`, `exportLibraryFile`, `libraryItemsOf`, `formatLibraryFileIssues` |
| `packages/core/src/library-import.ts` (신규) | `planLibraryImport`, `materializeLibraryImport`, `summarizeLibraryImport` |
| `packages/core/src/excel-workbook.ts` (신규) | `dictSheetsFromWorkbook` — 웹 `excel-file.ts` 에서 옮긴 워크북 → `RawSheet[]` |
| `packages/core/src/library-excel.ts` (신규) | `libraryDocFromDictSheets` — Excel 시트 → 원천 파일 문서 |
| `packages/core/src/index.ts` | 위 공개 API export |
| `packages/core/package.json` | `yaml` 의존성 |
| `apps/web/src/editor/excel-file.ts` | `readDictSheets` 가 core `dictSheetsFromWorkbook` 을 부른다 |
| `apps/server/src/services/library-import.ts` (신규) | `libraryStateHash`, `runLibraryImport`, 쓰기 |
| `apps/server/src/routers/resource.ts` | `library.list`(canWrite + 토큰 개방), `library.export`, `library.import` |
| `apps/server/src/testing/locks.ts` (신규) | `waitForLockWaiter` (promotion 테스트에서 옮김) |
| `packages/cli/src/xlsx.ts` (신규) | 노드용 `readDictSheetsFile` |
| `packages/cli/src/commands/library.ts` (신규) | `erdd library list|export|import` |
| `packages/cli/src/config.ts` | `DictionaryRef.file` |
| `packages/cli/src/commands/dict-file.ts` (신규) | 구독 경로 정규화, 배포 파일 읽기 |
| `packages/cli/src/commands/dict-pull.ts`·`dict-list.ts`·`dict-push.ts` | `--file`·파일 구독 |
| `packages/cli/src/main.ts` | 명령 배차·도움말 |
| `apps/web/src/components/library-import-dialog.tsx` (신규) | 가져오기 다이얼로그 |
| `apps/web/src/components/resource-library-manager.tsx` | 내보내기·가져오기·파일에서 만들기 버튼 |
| 문서 | `docs/guides/shared-resources.md`, `docs/guides/cli.md`, `docs/manual/{user-guide,cli-guide,local-guide}.md` |

---

### Task 1: core 라이브러리 파일 포맷

**Files:**
- Create: `packages/core/src/library-file.ts`
- Create: `packages/core/src/library-file.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`

**Interfaces:**
- Consumes: `RESOURCE_KINDS`, `RESOURCE_COLLECTION_BY_KIND`, `RESOURCE_PAYLOAD_SCHEMAS`, `resourceDisplayName`, `ResourceKind` (`resource.ts`), `DomainSchema` (`model.ts`), `LibraryItem` (`resource-sync.ts`)
- Produces:
  ```ts
  export const LIBRARY_FILE_FORMAT = 'erdd-library'
  export const LIBRARY_FILE_VERSION = 1
  export const LIBRARY_FILE_EXTENSION = '.erdd-lib.yaml'
  export const MAX_LIBRARY_FILE_ITEMS = 50_000
  export type LibraryFileEntry = { id?: string; version?: number; domainName?: string; fields: Record<string, unknown> }
  export type LibraryFileMeta = { id?: string; name: string; description: string }
  export type LibraryFileDoc = { library: LibraryFileMeta; kinds: Partial<Record<ResourceKind, LibraryFileEntry[]>> }
  export type LibraryFileStrictness = 'source' | 'distribution'
  export type LibraryFileIssue = { path: string; message: string }
  export function parseLibraryFile(text: string, strictness: LibraryFileStrictness):
    { ok: true; doc: LibraryFileDoc } | { ok: false; issues: LibraryFileIssue[] }
  export function stringifyLibraryFile(doc: LibraryFileDoc): string
  export function exportLibraryFile(library: { id: string; name: string; description: string },
    items: readonly LibraryItem[]): { text: string; danglingDomainRefs: number }
  export function libraryItemsOf(doc: LibraryFileDoc): LibraryItem[]   // 배포 파일 전용, id 오름차순
  export function formatLibraryFileIssues(issues: readonly LibraryFileIssue[], max?: number): string[]
  ```

**규칙(spec 1절 + 이 계획의 보정):**
- 원천 파일의 **빠진 payload 키는 「말하지 않음」** 이다(부분 필드). 그래서 원천 파일의 `fields` 는 **입력 그대로**(zod 출력이 아님)를 싣는다 — zod 4 는 `.partial()` 안의 `.default()` 를 채워 넣어(`englishName: null`) 말하지 않은 키를 만들어 낸다.
- 배포 파일의 `fields` 는 **zod 출력**(완전값, 기본값 채움)이다.
- 원천 파일의 필수 키: 도메인 `name`·`logicalType`, 단어 `logicalName`, 용어 `logicalName`·`physicalName`, 커스텀 항목 `name`·`target`·`type`.
- 용어 `domainName`(원천 전용): 도메인을 **이름으로** 가리킨다. 해석은 가져오기 계획이 한다(파일 도메인 → 대상 라이브러리 도메인 순).

- [ ] **Step 1: `yaml` 의존성을 core 에 더한다**

```bash
pnpm --filter @erdd/core add yaml@^2.8.1
```

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `packages/core/src/library-file.test.ts`

```ts
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
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/library-file.test.ts`
Expected: FAIL — `Cannot find module './library-file.js'`

- [ ] **Step 4: 구현한다** — `packages/core/src/library-file.ts`

```ts
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { z } from 'zod'
import { DomainSchema } from './model.js'
import {
  RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, RESOURCE_PAYLOAD_SCHEMAS, resourceDisplayName,
  type ResourceKind,
} from './resource.js'
import type { LibraryItem } from './resource-sync.js'

/**
 * 공용 라이브러리 파일(`.erdd-lib.yaml`) — 서버 라이브러리의 내보내기·가져오기와
 * 로컬 `erdd dict pull --file` 이 주고받는 포맷이다(guides/shared-resources.md 「파일 내보내기·가져오기」).
 *
 * 엄격도가 둘이다. **배포 파일**(서버가 내보낸 것)은 라이브러리 id·항목 id·version 이 있고 payload 가
 * 완전값이다. **원천 파일**(사람·스크립트·Excel 이 만든 것)은 그것들을 생략할 수 있고, payload 의
 * 빠진 키는 「말하지 않음」이다 — 가져오기가 그 키의 기존 값을 건드리지 않는다.
 */
export const LIBRARY_FILE_FORMAT = 'erdd-library'
export const LIBRARY_FILE_VERSION = 1
export const LIBRARY_FILE_EXTENSION = '.erdd-lib.yaml'
export const MAX_LIBRARY_FILE_ITEMS = 50_000

export type LibraryFileEntry = {
  id?: string
  version?: number
  /** 용어 전용·원천 파일 전용 — 도메인을 이름으로 가리킨다. 해석은 가져오기 계획이 한다. */
  domainName?: string
  /** payload 필드. 배포 파일은 완전값, 원천 파일은 적힌 키만. 용어의 domainId 는 이 파일 안 도메인 id. */
  fields: Record<string, unknown>
}
export type LibraryFileMeta = { id?: string; name: string; description: string }
/** `kinds` 에 키가 있는 종류만 파일에 적혀 있던 것이다(빈 목록 포함) — 가져오기의 삭제 판정이 쓴다. */
export type LibraryFileDoc = { library: LibraryFileMeta; kinds: Partial<Record<ResourceKind, LibraryFileEntry[]>> }
export type LibraryFileStrictness = 'source' | 'distribution'
export type LibraryFileIssue = { path: string; message: string }

const TOP_KEYS: readonly string[] = [
  'format', 'formatVersion', 'library', ...RESOURCE_KINDS.map((k) => RESOURCE_COLLECTION_BY_KIND[k]),
]
const LIBRARY_KEYS: readonly string[] = ['id', 'name', 'description']
const DIALECT_KEYS = ['postgresql', 'mysql', 'oracle', 'mssql'] as const
const DIST_REQUIRED = '배포 파일에는 필수입니다 — 서버에서 내보낸 파일만 받을 수 있습니다'

/**
 * 원천 파일 검증용 스키마. 도메인의 dialectTypes 도 부분을 허용한다. **검증에만 쓰고 출력은 버린다** —
 * zod 4 는 `.partial()` 안의 `.default()` 를 채워, 말하지 않은 키(`englishName`)를 만들어 낸다.
 */
const SOURCE_SCHEMAS: Record<ResourceKind, z.ZodType> = {
  domain: RESOURCE_PAYLOAD_SCHEMAS.domain
    .extend({ dialectTypes: DomainSchema.shape.dialectTypes.partial() }).partial(),
  word: RESOURCE_PAYLOAD_SCHEMAS.word.partial(),
  term: RESOURCE_PAYLOAD_SCHEMAS.term.partial(),
  customField: RESOURCE_PAYLOAD_SCHEMAS.customField.partial(),
}
const REQUIRED_SOURCE_FIELDS: Record<ResourceKind, readonly string[]> = {
  domain: ['name', 'logicalType'], word: ['logicalName'],
  term: ['logicalName', 'physicalName'], customField: ['name', 'target', 'type'],
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const TYPE_LABEL: Record<string, string> = {
  string: '문자열', number: '숫자', int: '정수', boolean: '참/거짓', array: '목록', object: '객체', null: 'null',
}
function zodIssueText(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': return `${TYPE_LABEL[issue.expected] ?? issue.expected}이어야 합니다`
    case 'unrecognized_keys': return `모르는 키입니다: ${issue.keys.join(', ')}`
    case 'invalid_value': return `다음 중 하나여야 합니다: ${issue.values.map(String).join(', ')}`
    default: return issue.message
  }
}

function nameKey(kind: ResourceKind, fields: Record<string, unknown>): string {
  const name = resourceDisplayName(kind, fields).trim()
  return kind === 'customField' ? `${kind}\0${name}\0${String(fields.target)}` : `${kind}\0${name}`
}

export function parseLibraryFile(
  text: string, strictness: LibraryFileStrictness,
): { ok: true; doc: LibraryFileDoc } | { ok: false; issues: LibraryFileIssue[] } {
  let raw: unknown
  try {
    // 별칭 폭탄은 maxAliasCount 가, 중복 키는 기본 uniqueKeys 가 오류로 만든다.
    raw = parseYaml(text.replace(/^﻿/, ''), { maxAliasCount: 100 })
  } catch (err) {
    return { ok: false, issues: [{ path: '(파일)', message: `YAML 을 읽지 못했습니다 — ${(err as Error).message}` }] }
  }
  return parseLibraryValue(raw, strictness)
}

function parseLibraryValue(
  raw: unknown, strictness: LibraryFileStrictness,
): { ok: true; doc: LibraryFileDoc } | { ok: false; issues: LibraryFileIssue[] } {
  const fail = (path: string, message: string) => ({ ok: false as const, issues: [{ path, message }] })
  if (!isRec(raw)) return fail('(파일)', '최상위가 객체가 아닙니다')
  // 사용자가 고른 가져오기라서 모르는 포맷·버전을 조용히 삼키지 않는다(DDL 머릿말과 반대).
  if (raw.format !== LIBRARY_FILE_FORMAT) {
    return fail('format', `${LIBRARY_FILE_FORMAT} 이어야 합니다 — ERDD 라이브러리 파일이 아닙니다`)
  }
  if (raw.formatVersion !== LIBRARY_FILE_VERSION) {
    return fail('formatVersion',
      `이 ERDD 가 읽을 수 있는 버전은 ${LIBRARY_FILE_VERSION} 입니다(파일: ${String(raw.formatVersion)}) — ERDD 를 업그레이드하세요`)
  }
  let total = 0
  for (const kind of RESOURCE_KINDS) {
    const list = raw[RESOURCE_COLLECTION_BY_KIND[kind]]
    if (Array.isArray(list)) total += list.length
  }
  if (total > MAX_LIBRARY_FILE_ITEMS) {
    return fail('(파일)', `항목이 ${total}건입니다 — 한 파일에 ${MAX_LIBRARY_FILE_ITEMS}건까지 가져올 수 있습니다. 나눠서 가져오세요`)
  }

  const issues: LibraryFileIssue[] = []
  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) issues.push({ path: key, message: '모르는 키입니다' })

  const library: LibraryFileMeta = { name: '', description: '' }
  const lib = raw.library
  if (!isRec(lib)) issues.push({ path: 'library', message: '객체여야 합니다' })
  else {
    for (const key of Object.keys(lib)) if (!LIBRARY_KEYS.includes(key)) issues.push({ path: `library.${key}`, message: '모르는 키입니다' })
    if (lib.id !== undefined && (typeof lib.id !== 'string' || lib.id === '')) {
      issues.push({ path: 'library.id', message: '비어 있지 않은 문자열이어야 합니다' })
    } else if (lib.id === undefined && strictness === 'distribution') {
      issues.push({ path: 'library.id', message: DIST_REQUIRED })
    }
    if (typeof lib.name !== 'string' || lib.name.trim() === '') {
      issues.push({ path: 'library.name', message: '비어 있지 않은 문자열이어야 합니다' })
    }
    if (lib.description !== undefined && lib.description !== null && typeof lib.description !== 'string') {
      issues.push({ path: 'library.description', message: '문자열이어야 합니다' })
    }
    if (typeof lib.id === 'string' && lib.id !== '') library.id = lib.id
    if (typeof lib.name === 'string') library.name = lib.name
    if (typeof lib.description === 'string') library.description = lib.description
  }

  const kinds: LibraryFileDoc['kinds'] = {}
  const idAt = new Map<string, string>()
  const nameAt = new Map<string, string>()
  const domainIds = new Set<string>()
  for (const kind of RESOURCE_KINDS) {
    const key = RESOURCE_COLLECTION_BY_KIND[kind]
    if (!(key in raw)) continue
    const list = raw[key]
    if (!Array.isArray(list)) { issues.push({ path: key, message: '목록이어야 합니다' }); continue }
    const entries: LibraryFileEntry[] = []
    list.forEach((el: unknown, i) => {
      const at = `${key}[${i}]`
      if (!isRec(el)) { issues.push({ path: at, message: '객체여야 합니다' }); return }
      const { id, version, domainName, ...rest } = el
      const name = resourceDisplayName(kind, rest)
      const where = name === '' ? at : `${at} (${name})`

      if (id !== undefined && (typeof id !== 'string' || id === '')) {
        issues.push({ path: `${where}: id`, message: '비어 있지 않은 문자열이어야 합니다' })
      } else if (id === undefined && strictness === 'distribution') {
        issues.push({ path: `${where}: id`, message: DIST_REQUIRED })
      }
      if (version !== undefined && !(Number.isInteger(version) && (version as number) >= 1)) {
        issues.push({ path: `${where}: version`, message: '1 이상의 정수여야 합니다' })
      } else if (version !== undefined && id === undefined) {
        issues.push({ path: `${where}: version`, message: 'version 은 id 와 함께 적어야 합니다' })
      } else if (version === undefined && strictness === 'distribution') {
        issues.push({ path: `${where}: version`, message: DIST_REQUIRED })
      }
      if (domainName !== undefined) {
        if (kind !== 'term') issues.push({ path: `${where}: domainName`, message: '용어에만 쓸 수 있습니다' })
        else if (strictness === 'distribution') issues.push({ path: `${where}: domainName`, message: '배포 파일에는 쓸 수 없습니다 — domainId 로 가리키세요' })
        else if (typeof domainName !== 'string') issues.push({ path: `${where}: domainName`, message: '문자열이어야 합니다' })
        else if ('domainId' in rest) issues.push({ path: `${where}: domainName`, message: 'domainId 와 함께 쓸 수 없습니다' })
      }

      const schema = strictness === 'distribution' ? RESOURCE_PAYLOAD_SCHEMAS[kind] : SOURCE_SCHEMAS[kind]
      const parsed = schema.safeParse(rest)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            path: issue.path.length === 0 ? where : `${where}: ${issue.path.join('.')}`,
            message: zodIssueText(issue),
          })
        }
      }
      if (strictness === 'source') {
        for (const field of REQUIRED_SOURCE_FIELDS[kind]) {
          if (!(field in rest)) issues.push({ path: `${where}: ${field}`, message: '필수 필드가 없습니다' })
        }
      }
      if (typeof id === 'string' && id !== '') {
        const prev = idAt.get(id)
        if (prev !== undefined) issues.push({ path: `${where}: id`, message: `${prev} 와 id 가 같습니다` })
        else idAt.set(id, at)
        if (kind === 'domain') domainIds.add(id)
      }
      if (name.trim() !== '') {
        const nk = nameKey(kind, rest)
        const prev = nameAt.get(nk)
        if (prev !== undefined) issues.push({ path: where, message: `같은 이름이 ${prev} 에도 있습니다` })
        else nameAt.set(nk, at)
      }
      entries.push({
        ...(typeof id === 'string' && id !== '' ? { id } : {}),
        ...(typeof version === 'number' ? { version } : {}),
        ...(typeof domainName === 'string' ? { domainName } : {}),
        fields: strictness === 'distribution' && parsed.success
          ? parsed.data as Record<string, unknown>
          : { ...rest },
      })
    })
    kinds[kind] = entries
  }

  ;(kinds.term ?? []).forEach((entry, i) => {
    const target = entry.fields.domainId
    if (typeof target === 'string' && !domainIds.has(target)) {
      const name = resourceDisplayName('term', entry.fields)
      issues.push({ path: `terms[${i}] (${name}): domainId`, message: `이 파일에 id 가 ${target} 인 도메인이 없습니다` })
    }
  })

  return issues.length > 0 ? { ok: false, issues } : { ok: true, doc: { library, kinds } }
}

/** payload 키를 스키마 순서로 늘어놓는다 — 저장소(jsonb)의 키 순서와 무관하게 같은 바이트를 낸다. */
function orderedFields(kind: ResourceKind, fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(RESOURCE_PAYLOAD_SCHEMAS[kind].shape)) {
    if (!(key in fields)) continue
    const value = fields[key]
    if (kind === 'domain' && key === 'dialectTypes' && isRec(value)) {
      out[key] = Object.fromEntries(DIALECT_KEYS.filter((d) => d in value).map((d) => [d, value[d]]))
    } else out[key] = value
  }
  return out
}

export function stringifyLibraryFile(doc: LibraryFileDoc): string {
  const out: Record<string, unknown> = {
    format: LIBRARY_FILE_FORMAT,
    formatVersion: LIBRARY_FILE_VERSION,
    library: {
      ...(doc.library.id !== undefined ? { id: doc.library.id } : {}),
      name: doc.library.name,
      description: doc.library.description,
    },
  }
  for (const kind of RESOURCE_KINDS) {
    const entries = doc.kinds[kind]
    if (entries === undefined) continue
    out[RESOURCE_COLLECTION_BY_KIND[kind]] = entries.map((e) => ({
      ...(e.id !== undefined ? { id: e.id } : {}),
      ...(e.version !== undefined ? { version: e.version } : {}),
      ...orderedFields(kind, e.fields),
      ...(e.domainName !== undefined ? { domainName: e.domainName } : {}),
    }))
  }
  // lineWidth 0 — 긴 설명을 접지 않는다(접으면 diff 가 시끄럽다).
  return stringifyYaml(out, { lineWidth: 0 })
}

/**
 * 서버 라이브러리를 배포 파일로 쓴다. 종류는 `RESOURCE_KINDS` 순, 종류 안은 id 코드 단위 오름차순,
 * 타임스탬프 없음 — 같은 라이브러리 상태면 바이트가 같다. 네 종류 키를 언제나 모두 쓴다.
 *
 * 항목 삭제가 용어의 도메인 참조를 정리하지 않으므로, 삭제된 도메인을 가리키는 용어는 `domainId: null`
 * 로 쓰고 그 수를 돌려준다 — 파일의 「domainId 는 파일 안만 가리킨다」를 어기지 않기 위해서다.
 */
export function exportLibraryFile(
  library: { id: string; name: string; description: string }, items: readonly LibraryItem[],
): { text: string; danglingDomainRefs: number } {
  const domainIds = new Set(items.filter((i) => i.kind === 'domain').map((i) => i.id))
  let danglingDomainRefs = 0
  const kinds: LibraryFileDoc['kinds'] = {}
  for (const kind of RESOURCE_KINDS) {
    kinds[kind] = items.filter((i) => i.kind === kind).sort(byId).map((item) => {
      // 옛 행(키 누락)도 완전값으로 쓴다 — 기본값을 채운 스키마 출력을 쓴다.
      const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(item.payload)
      const fields: Record<string, unknown> = { ...(parsed.success ? parsed.data as Record<string, unknown> : item.payload) }
      if (kind === 'term' && typeof fields.domainId === 'string' && !domainIds.has(fields.domainId)) {
        fields.domainId = null
        danglingDomainRefs += 1
      }
      return { id: item.id, version: item.version, fields }
    })
  }
  return {
    text: stringifyLibraryFile({ library: { id: library.id, name: library.name, description: library.description }, kinds }),
    danglingDomainRefs,
  }
}

/** 배포 파일의 항목을 재동기화 입력(`planResync`)으로 — id 코드 단위 오름차순(결정성). */
export function libraryItemsOf(doc: LibraryFileDoc): LibraryItem[] {
  const out: LibraryItem[] = []
  for (const kind of RESOURCE_KINDS) {
    for (const e of doc.kinds[kind] ?? []) {
      if (e.id === undefined || e.version === undefined) {
        throw new Error('libraryItemsOf 는 배포 파일에만 쓴다 — id·version 이 없는 항목이 있다')
      }
      out.push({ id: e.id, kind, version: e.version, payload: e.fields })
    }
  }
  return out.sort(byId)
}

export function formatLibraryFileIssues(issues: readonly LibraryFileIssue[], max = 20): string[] {
  const lines = issues.slice(0, max).map((i) => `${i.path} — ${i.message}`)
  if (issues.length > max) lines.push(`… 외 ${issues.length - max}건`)
  return lines
}
```

`packages/core/src/index.ts` 끝에 더한다:

```ts
export {
  LIBRARY_FILE_FORMAT, LIBRARY_FILE_VERSION, LIBRARY_FILE_EXTENSION, MAX_LIBRARY_FILE_ITEMS,
  parseLibraryFile, stringifyLibraryFile, exportLibraryFile, libraryItemsOf, formatLibraryFileIssues,
} from './library-file.js'
export type {
  LibraryFileEntry, LibraryFileMeta, LibraryFileDoc, LibraryFileStrictness, LibraryFileIssue,
} from './library-file.js'
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/library-file.test.ts`
Expected: PASS. 어긋나는 단언(예: zod 4 의 이슈 코드 이름, `yaml` 의 별칭 한도 오류 형태)은 **구현을 단언에 맞추지 말고** 관찰을 보고한다.

- [ ] **Step 6: 타입 검사**

Run: `pnpm --filter @erdd/core exec tsc --noEmit; echo "exit=$?"`
Expected: `exit=0`

- [ ] **Step 7: 커밋**

```bash
git add packages/core/src/library-file.ts packages/core/src/library-file.test.ts packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml && git commit -m "feat(core): 공용 라이브러리 파일 포맷 — 파싱(원천·배포)·결정적 직렬화·내보내기

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 8: 구분력 실증(커밋 뒤)** — `exportLibraryFile` 의 `.sort(byId)` 를 지우면 「입력 순서를 섞어도 바이트가 같다」가, 원천 `fields: { ...rest }` 를 `parsed.data` 로 바꾸면 「빠진 키는 채우지 않는다」가 실패하는지 본다. 되돌린 뒤 `git status` clean 확인.

---

### Task 2: core 갱신 병합 계획

**Files:**
- Create: `packages/core/src/library-import.ts`
- Create: `packages/core/src/library-import.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `LibraryFileDoc`, `LibraryFileEntry` (Task 1), `LibraryItem` (`resource-sync.ts`), `deepEqual`, `resourceDisplayName`, `RESOURCE_KINDS`, `RESOURCE_KIND_LABEL`
- Produces:
  ```ts
  export type LibraryImportStatus = 'add' | 'update' | 'unchanged' | 'stale' | 'remove'
  export type LibraryImportEntry = {
    status: LibraryImportStatus; kind: ResourceKind; name: string
    targetId: string | null            // add 면 null
    fileRef: string | null             // `${kind}:${index}` — remove 면 null
    currentVersion: number | null; fileVersion: number | null
    currentPayload: Record<string, unknown> | null   // add 면 null
    payload: Record<string, unknown>   // add·update·stale·unchanged: 적용 후 값(새 항목 참조는 자리표시), remove: 현재 값
    changedFields: string[]
    referencedBy: number               // remove 인 도메인만 — 남는 용어가 가리키는 수. 0 이 아니면 지우지 않는다
  }
  export type LibraryImportPlan = { entries: LibraryImportEntry[]; warnings: string[] }
  export function planLibraryImport(existing: readonly LibraryItem[], doc: LibraryFileDoc,
    targetLibraryId: string | null): LibraryImportPlan
  export type LibraryImportWrites = {
    inserts: { id: string; kind: ResourceKind; payload: Record<string, unknown> }[]
    updates: { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }[]
    removes: string[]
  }
  export function materializeLibraryImport(plan: LibraryImportPlan,
    opts: { prune: boolean; includeStale: boolean }, newId: () => string): LibraryImportWrites
  export type LibraryImportSummary = {
    counts: Record<LibraryImportStatus, number> & { removeBlocked: number }
    warnings: string[]
    entries: { status: Exclude<LibraryImportStatus, 'unchanged'>; kind: ResourceKind; name: string
      currentVersion: number | null; fileVersion: number | null; referencedBy: number
      changes: { field: string; from: unknown; to: unknown }[] }[]
  }
  export function summarizeLibraryImport(plan: LibraryImportPlan, existing: readonly LibraryItem[]): LibraryImportSummary
  ```

**규칙(spec 2절 + 이 계획의 보정):**
- 매칭: ① `doc.library.id === targetLibraryId` 면 항목 id(종류도 같아야) ② 나머지는 `(종류, 표시 이름 trim[, target])` — 기존 동명 다수면 `existing` 순서 첫 미점유 항목 + 경고 ③ 한 기존 항목은 한 파일 항목에만.
- 병합: 기존 payload 에 **파일에 적힌 키만** 덮는다. 도메인 `dialectTypes` 는 한 단계 병합. `add` 는 기본값 + 적힌 키.
- 용어 도메인 참조: `domainId`(파일 id) → 매칭 대상 id 또는 새 항목 자리표시. `domainName` → 파일 도메인 이름 → 대상 라이브러리 도메인 이름 순, 없으면 `null` + 경고.
- 상태: 병합 결과가 기존과 같으면 `unchanged`, **id 로 매칭**됐고 `fileVersion < currentVersion` 이면 `stale`, 아니면 `update`.
- `remove`: 파일에 **그 종류 키가 있고** 매칭되지 않은 기존 항목. **남는 용어가 가리키는 도메인은 지우지 않는다**(`referencedBy > 0` + 경고) — spec 에 없던 보정, 참조가 끊긴 용어를 만들지 않기 위해서다.
- 매칭 색인은 `Map` — 5만 × 5만 선형 탐색을 하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/library-import.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { exportLibraryFile, parseLibraryFile, type LibraryFileDoc } from './library-file.js'
import {
  materializeLibraryImport, planLibraryImport, summarizeLibraryImport, type LibraryImportPlan,
} from './library-import.js'
import type { LibraryItem } from './resource-sync.js'

const LIB = 'lib-1'
const word = (id: string, logicalName: string, abbreviation: string, version = 1, extra: Record<string, unknown> = {}): LibraryItem =>
  ({ id, kind: 'word', version, payload: { logicalName, abbreviation, englishName: null, description: null, ...extra } })
const domain = (id: string, name: string, version = 1): LibraryItem => ({
  id, kind: 'domain', version,
  payload: { name, category: null, logicalType: 'VARCHAR(10)', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null }, defaultValue: null, allowedValues: [], description: null },
})
const term = (id: string, logicalName: string, domainId: string | null, version = 1): LibraryItem =>
  ({ id, kind: 'term', version, payload: { logicalName, physicalName: logicalName.toUpperCase(), domainId, description: null } })

const source = (kinds: LibraryFileDoc['kinds'], id?: string): LibraryFileDoc =>
  ({ library: { ...(id !== undefined ? { id } : {}), name: '파일', description: '' }, kinds })
const statusOf = (plan: LibraryImportPlan) => plan.entries.map((e) => `${e.status}:${e.name}`)
let seq = 0
const newId = () => `new-${++seq}`

describe('planLibraryImport — 매칭', () => {
  it('같은 라이브러리 id 면 항목 id 로 매칭한다(이름이 바뀌어도)', () => {
    const plan = planLibraryImport([word('w1', '고객', 'CUST')],
      source({ word: [{ id: 'w1', version: 1, fields: { logicalName: '손님', abbreviation: 'CUST' } }] }, LIB), LIB)
    expect(plan.entries).toEqual([expect.objectContaining({ status: 'update', targetId: 'w1', changedFields: ['logicalName'] })])
  })

  it('다른 라이브러리 id 면 id 를 보지 않고 이름으로 매칭한다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'CUST')],
      source({ word: [{ id: 'w1', version: 1, fields: { logicalName: '손님', abbreviation: 'CUST' } }] }, 'other'), LIB)
    expect(statusOf(plan)).toEqual(['add:손님', 'remove:고객'])
  })

  it('id 매칭이 먼저 자리를 차지하고 이름 매칭은 남은 항목만 본다', () => {
    const existing = [word('w1', '고객', 'A'), word('w2', '고객2', 'B')]
    const plan = planLibraryImport(existing, source({ word: [
      { fields: { logicalName: '고객', abbreviation: 'X' } },           // 이름으로는 w1 이지만
      { id: 'w1', version: 1, fields: { logicalName: '고객', abbreviation: 'A' } },   // w1 은 id 매칭이 가져간다
    ] }, LIB), LIB)
    expect(plan.entries.map((e) => [e.status, e.targetId])).toEqual([['add', null], ['unchanged', 'w1'], ['remove', 'w2']])
  })

  it('기존 동명이 여럿이면 먼저 만든(existing 순서) 항목과 맞추고 경고한다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'A'), word('w2', '고객', 'B')],
      source({ word: [{ fields: { logicalName: '고객', abbreviation: 'A' } }] }), LIB)
    expect(plan.entries[0]).toMatchObject({ status: 'unchanged', targetId: 'w1' })
    expect(plan.warnings).toEqual([expect.stringContaining('같은 이름이 2개')])
  })

  it('커스텀 항목은 target 까지 같아야 매칭한다', () => {
    const cf = (id: string, target: string): LibraryItem =>
      ({ id, kind: 'customField', version: 1, payload: { name: '비고', target, type: 'text', options: [], required: false, defaultValue: null } })
    const plan = planLibraryImport([cf('c1', 'table')],
      source({ customField: [{ fields: { name: '비고', target: 'column', type: 'text' } }] }), LIB)
    expect(statusOf(plan)).toEqual(['add:비고', 'remove:비고'])
  })
})

describe('planLibraryImport — 병합·상태', () => {
  it('적힌 키만 덮는다 — 빠진 키의 기존 값은 그대로(Excel 컬럼 누락)', () => {
    const plan = planLibraryImport([word('w1', '고객', 'CUST', 1, { englishName: 'CUSTOMER', description: '설명' })],
      source({ word: [{ fields: { logicalName: '고객', abbreviation: 'CSTMR' } }] }), LIB)
    expect(plan.entries[0]).toMatchObject({
      status: 'update', changedFields: ['abbreviation'],
      payload: { logicalName: '고객', abbreviation: 'CSTMR', englishName: 'CUSTOMER', description: '설명' },
    })
  })

  it('dialectTypes 는 한 단계 병합한다', () => {
    const plan = planLibraryImport([domain('d1', '코드')],
      source({ domain: [{ fields: { name: '코드', logicalType: 'VARCHAR(10)', dialectTypes: { mysql: 'varchar(10)' } } }] }), LIB)
    expect(plan.entries[0]!.payload.dialectTypes).toEqual({ postgresql: null, mysql: 'varchar(10)', oracle: null, mssql: null })
  })

  it('add 는 기본값 위에 적힌 키를 얹는다', () => {
    const plan = planLibraryImport([], source({ word: [{ fields: { logicalName: '고객' } }] }), LIB)
    expect(plan.entries[0]).toMatchObject({ status: 'add', payload: { logicalName: '고객', abbreviation: '', englishName: null, description: null } })
  })

  it('stale — id 매칭이고 파일 버전이 서버보다 낮고 내용이 다를 때만', () => {
    const existing = [word('w1', '고객', 'NEW', 4), word('w2', '주문', 'ORD', 4)]
    const plan = planLibraryImport(existing, source({ word: [
      { id: 'w1', version: 2, fields: { logicalName: '고객', abbreviation: 'OLD' } },
      { id: 'w2', version: 2, fields: { logicalName: '주문', abbreviation: 'ORD' } },     // 내용 같으면 unchanged
    ] }, LIB), LIB)
    expect(plan.entries.map((e) => e.status)).toEqual(['stale', 'unchanged'])
  })

  it('이름 매칭은 파일 version 이 낮아도 stale 이 아니다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'NEW', 4)],
      source({ word: [{ id: 'x', version: 1, fields: { logicalName: '고객', abbreviation: 'OLD' } }] }, 'other'), LIB)
    expect(plan.entries[0]!.status).toBe('update')
  })

  it('내보낸 파일을 그대로 다시 가져오면 전부 unchanged 다', () => {
    const existing = [domain('d1', '금액', 3), word('w1', '고객', 'CUST', 2), term('t1', '고객금액', 'd1', 5)]
    const parsed = parseLibraryFile(exportLibraryFile({ id: LIB, name: 'x', description: '' }, existing).text, 'source')
    if (!parsed.ok) throw new Error('parse')
    const plan = planLibraryImport(existing, parsed.doc, LIB)
    expect(plan.entries.every((e) => e.status === 'unchanged')).toBe(true)
    expect(materializeLibraryImport(plan, { prune: true, includeStale: true }, newId))
      .toEqual({ inserts: [], updates: [], removes: [] })
  })

  it('다른 라이브러리에서 온 파일도 재매핑 뒤 같으면 unchanged 다(용어의 도메인 참조)', () => {
    const existing = [domain('d1', '금액'), term('t1', '금액합계', 'd1')]
    const plan = planLibraryImport(existing, source({
      domain: [{ id: 'fd', fields: { name: '금액', logicalType: 'VARCHAR(10)' } }],
      term: [{ fields: { logicalName: '금액합계', physicalName: '금액합계'.toUpperCase(), domainId: 'fd' } }],
    }, 'other'), LIB)
    expect(plan.entries.map((e) => e.status)).toEqual(['unchanged', 'unchanged'])
  })
})

describe('planLibraryImport — 용어의 도메인', () => {
  it('새로 추가될 도메인은 자리표시로 가리키고 materialize 가 같은 id 로 푼다', () => {
    const plan = planLibraryImport([], source({
      domain: [{ id: 'fd', fields: { name: '금액', logicalType: 'DECIMAL' } }],
      term: [{ fields: { logicalName: '금액합계', physicalName: 'AMT_SUM', domainId: 'fd' } }],
    }), LIB)
    const writes = materializeLibraryImport(plan, { prune: false, includeStale: false }, newId)
    const dom = writes.inserts.find((i) => i.kind === 'domain')!
    expect(writes.inserts.find((i) => i.kind === 'term')!.payload.domainId).toBe(dom.id)
  })

  it('domainName 은 파일 도메인 → 대상 라이브러리 도메인 순으로 찾고, 없으면 비우고 경고한다', () => {
    const existing = [domain('d1', '식별번호'), term('t1', '고객번호', 'd1')]
    const plan = planLibraryImport(existing, source({ term: [
      { domainName: '식별번호', fields: { logicalName: '고객번호', physicalName: '고객번호'.toUpperCase() } },
      { domainName: '없는도메인', fields: { logicalName: '주문번호', physicalName: 'ORD_NO' } },
    ] }), LIB)
    expect(plan.entries[0]).toMatchObject({ status: 'unchanged' })
    expect(plan.entries[1]!.payload.domainId).toBeNull()
    expect(plan.warnings).toEqual([expect.stringContaining('없는도메인')])
  })

  it('용어가 도메인을 말하지 않으면(domainId·domainName 둘 다 없음) 기존 연결을 건드리지 않는다', () => {
    const plan = planLibraryImport([domain('d1', '식별번호'), term('t1', '고객번호', 'd1')],
      source({ term: [{ fields: { logicalName: '고객번호', physicalName: 'CUST_NO' } }] }), LIB)
    expect(plan.entries[0]!.payload.domainId).toBe('d1')
  })
})

describe('planLibraryImport — 삭제', () => {
  it('종류 키가 없으면 그 종류는 삭제 후보가 아니고, [] 면 후보다', () => {
    const existing = [word('w1', '고객', 'C'), domain('d1', '금액')]
    expect(statusOf(planLibraryImport(existing, source({ word: [] }), LIB))).toEqual(['remove:고객'])
  })

  it('남는 용어가 가리키는 도메인은 지우지 않고 경고한다', () => {
    const existing = [domain('d1', '금액'), term('t1', '금액합계', 'd1')]
    const plan = planLibraryImport(existing, source({ domain: [] }), LIB)   // 용어는 말하지 않음 = 남는다
    expect(plan.entries).toEqual([expect.objectContaining({ status: 'remove', targetId: 'd1', referencedBy: 1 })])
    expect(plan.warnings).toEqual([expect.stringContaining('금액')])
    expect(materializeLibraryImport(plan, { prune: true, includeStale: false }, newId).removes).toEqual([])
  })

  it('prune 이 아니면 아무것도 지우지 않는다', () => {
    const plan = planLibraryImport([word('w1', '고객', 'C')], source({ word: [] }), LIB)
    expect(materializeLibraryImport(plan, { prune: false, includeStale: false }, newId).removes).toEqual([])
    expect(materializeLibraryImport(plan, { prune: true, includeStale: false }, newId).removes).toEqual(['w1'])
  })
})

describe('materializeLibraryImport', () => {
  it('update 는 version + 1, stale 은 includeStale 일 때만', () => {
    const plan = planLibraryImport([word('w1', '고객', 'NEW', 4), word('w2', '주문', 'ORD', 1)], source({ word: [
      { id: 'w1', version: 2, fields: { logicalName: '고객', abbreviation: 'OLD' } },
      { id: 'w2', version: 1, fields: { logicalName: '주문', abbreviation: 'ORDER' } },
    ] }, LIB), LIB)
    expect(materializeLibraryImport(plan, { prune: false, includeStale: false }, newId).updates.map((u) => [u.id, u.version])).toEqual([['w2', 2]])
    expect(materializeLibraryImport(plan, { prune: false, includeStale: true }, newId).updates.map((u) => [u.id, u.version])).toEqual([['w1', 5], ['w2', 2]])
  })
})

describe('summarizeLibraryImport', () => {
  it('unchanged 는 건수만, 나머지는 필드별 전후 값과 함께', () => {
    const existing = [word('w1', '고객', 'CUST'), word('w2', '주문', 'ORD')]
    const plan = planLibraryImport(existing, source({ word: [
      { fields: { logicalName: '고객', abbreviation: 'CSTMR' } }, { fields: { logicalName: '주문', abbreviation: 'ORD' } },
    ] }), LIB)
    const summary = summarizeLibraryImport(plan, existing)
    expect(summary.counts).toMatchObject({ update: 1, unchanged: 1, add: 0, remove: 0, stale: 0, removeBlocked: 0 })
    expect(summary.entries).toEqual([expect.objectContaining({
      status: 'update', name: '고객', changes: [{ field: 'abbreviation', from: 'CUST', to: 'CSTMR' }],
    })])
  })

  it('용어의 도메인 변경은 id 가 아니라 도메인 이름으로 보인다', () => {
    const existing = [domain('d1', '금액'), term('t1', '합계', 'd1')]
    const plan = planLibraryImport(existing, source({
      domain: [{ id: 'fd', fields: { name: '수량', logicalType: 'INT' } }],
      term: [{ fields: { logicalName: '합계', physicalName: '합계'.toUpperCase(), domainId: 'fd' } }],
    }), LIB)
    const change = summarizeLibraryImport(plan, existing).entries.find((e) => e.kind === 'term')!.changes[0]
    expect(change).toEqual({ field: 'domainId', from: '금액', to: '수량' })
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/library-import.test.ts`
Expected: FAIL — `Cannot find module './library-import.js'`

- [ ] **Step 3: 구현한다** — `packages/core/src/library-import.ts`

```ts
import { deepEqual } from './equal.js'
import type { LibraryFileDoc, LibraryFileEntry } from './library-file.js'
import { RESOURCE_KINDS, RESOURCE_KIND_LABEL, resourceDisplayName, type ResourceKind } from './resource.js'
import type { LibraryItem } from './resource-sync.js'

/**
 * 파일 → 서버 라이브러리 갱신 병합의 판정. 서버 적용·웹 미리보기·CLI --dry-run 이 모두 이것을 부른다
 * (guides/shared-resources.md 「파일 내보내기·가져오기」). 소비처가 판정을 다시 구현하면 갈라진다.
 */
export type LibraryImportStatus = 'add' | 'update' | 'unchanged' | 'stale' | 'remove'
export type LibraryImportEntry = {
  status: LibraryImportStatus
  kind: ResourceKind
  name: string
  targetId: string | null
  fileRef: string | null
  currentVersion: number | null
  fileVersion: number | null
  currentPayload: Record<string, unknown> | null
  payload: Record<string, unknown>
  changedFields: string[]
  referencedBy: number
}
export type LibraryImportPlan = { entries: LibraryImportEntry[]; warnings: string[] }
export type LibraryImportWrites = {
  inserts: { id: string; kind: ResourceKind; payload: Record<string, unknown> }[]
  updates: { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }[]
  removes: string[]
}

/** 이번에 새로 만들 항목의 자리표시 — 어떤 실제 id 와도 같지 않다. materialize 가 발급 id 로 푼다. */
const NEW_REF = '\0new:'
const newRef = (fileRef: string): string => `${NEW_REF}${fileRef}`

const DEFAULTS: Record<ResourceKind, Record<string, unknown>> = {
  domain: {
    category: null, dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null,
  },
  word: { abbreviation: '', englishName: null, description: null },
  term: { domainId: null, description: null },
  customField: { options: [], required: false, defaultValue: null },
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 적힌 키만 덮는다. 도메인 dialectTypes 는 한 단계 병합 — 원천 파일은 방언 일부만 적을 수 있다. */
function merge(kind: ResourceKind, base: Record<string, unknown>, fields: Record<string, unknown>) {
  const out = { ...base, ...fields }
  if (kind === 'domain' && isRec(fields.dialectTypes)) {
    out.dialectTypes = { ...(isRec(base.dialectTypes) ? base.dialectTypes : {}), ...fields.dialectTypes }
  }
  return out
}

function matchKey(kind: ResourceKind, payload: Record<string, unknown>): string {
  const name = resourceDisplayName(kind, payload).trim()
  return kind === 'customField' ? `${kind}\0${name}\0${String(payload.target)}` : `${kind}\0${name}`
}

function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => !deepEqual(before[k], after[k]))
}

export function planLibraryImport(
  existing: readonly LibraryItem[], doc: LibraryFileDoc, targetLibraryId: string | null,
): LibraryImportPlan {
  const warnings: string[] = []
  const files: { ref: string; kind: ResourceKind; entry: LibraryFileEntry }[] = []
  for (const kind of RESOURCE_KINDS) {
    (doc.kinds[kind] ?? []).forEach((entry, i) => files.push({ ref: `${kind}:${i}`, kind, entry }))
  }

  const claimed = new Set<string>()
  const matchOf = new Map<string, LibraryItem>()
  const matchedById = new Set<string>()

  // ① 같은 라이브러리에서 내보낸 파일이면 항목 id 로 — 이름이 바뀐 항목도 따라간다.
  if (doc.library.id !== undefined && doc.library.id === targetLibraryId) {
    const byId = new Map(existing.map((e) => [e.id, e]))
    for (const f of files) {
      const hit = f.entry.id === undefined ? undefined : byId.get(f.entry.id)
      if (hit === undefined || hit.kind !== f.kind || claimed.has(hit.id)) continue
      claimed.add(hit.id); matchOf.set(f.ref, hit); matchedById.add(f.ref)
    }
  }
  // ② 나머지는 (종류, 표시 이름[, target]) — 후보는 existing 순서(= loadLibraryItems 의 createdAt, id).
  const byName = new Map<string, LibraryItem[]>()
  for (const e of existing) {
    const key = matchKey(e.kind, e.payload)
    const list = byName.get(key)
    if (list === undefined) byName.set(key, [e]); else list.push(e)
  }
  for (const f of files) {
    if (matchOf.has(f.ref)) continue
    const candidates = (byName.get(matchKey(f.kind, f.entry.fields)) ?? []).filter((e) => !claimed.has(e.id))
    if (candidates.length === 0) continue
    if (candidates.length > 1) {
      warnings.push(`${RESOURCE_KIND_LABEL[f.kind]} 「${resourceDisplayName(f.kind, f.entry.fields).trim()}」: 라이브러리에 같은 이름이 ${candidates.length}개 있어 먼저 만든 항목과 맞춥니다`)
    }
    const hit = candidates[0]!
    claimed.add(hit.id); matchOf.set(f.ref, hit)
  }

  // 도메인 참조 해석표 — 파일 도메인 id·이름 → 대상 id(또는 새 항목 자리표시).
  const domainByFileId = new Map<string, string>()
  const domainByFileName = new Map<string, string>()
  for (const f of files) {
    if (f.kind !== 'domain') continue
    const target = matchOf.get(f.ref)?.id ?? newRef(f.ref)
    if (f.entry.id !== undefined) domainByFileId.set(f.entry.id, target)
    domainByFileName.set(resourceDisplayName('domain', f.entry.fields).trim(), target)
  }
  const domainByExistingName = new Map<string, string>()
  for (const e of existing) {
    if (e.kind !== 'domain') continue
    const name = resourceDisplayName('domain', e.payload).trim()
    if (!domainByExistingName.has(name)) domainByExistingName.set(name, e.id)
  }
  const resolveFields = (f: { kind: ResourceKind; entry: LibraryFileEntry }): Record<string, unknown> => {
    const fields = { ...f.entry.fields }
    if (f.kind !== 'term') return fields
    if (typeof fields.domainId === 'string') fields.domainId = domainByFileId.get(fields.domainId) ?? null
    if (f.entry.domainName !== undefined) {
      const wanted = f.entry.domainName.trim()
      const hit = wanted === '' ? null : domainByFileName.get(wanted) ?? domainByExistingName.get(wanted) ?? null
      if (wanted !== '' && hit === null) {
        warnings.push(`용어 「${resourceDisplayName('term', fields).trim()}」: 도메인 「${wanted}」을(를) 찾지 못해 비웁니다`)
      }
      fields.domainId = hit
    }
    return fields
  }

  const entries: LibraryImportEntry[] = []
  for (const f of files) {
    const fields = resolveFields(f)
    const hit = matchOf.get(f.ref)
    const fileVersion = f.entry.version ?? null
    if (hit === undefined) {
      const payload = merge(f.kind, DEFAULTS[f.kind], fields)
      entries.push({
        status: 'add', kind: f.kind, name: resourceDisplayName(f.kind, payload), targetId: null, fileRef: f.ref,
        currentVersion: null, fileVersion, currentPayload: null, payload, changedFields: [], referencedBy: 0,
      })
      continue
    }
    const payload = merge(f.kind, hit.payload, fields)
    const changedFields = changedKeys(hit.payload, payload)
    const status: LibraryImportStatus = changedFields.length === 0 ? 'unchanged'
      : matchedById.has(f.ref) && fileVersion !== null && fileVersion < hit.version ? 'stale' : 'update'
    entries.push({
      status, kind: f.kind, name: resourceDisplayName(f.kind, payload), targetId: hit.id, fileRef: f.ref,
      currentVersion: hit.version, fileVersion, currentPayload: hit.payload, payload, changedFields, referencedBy: 0,
    })
  }

  const present = new Set(RESOURCE_KINDS.filter((k) => doc.kinds[k] !== undefined))
  for (const e of existing) {
    if (claimed.has(e.id) || !present.has(e.kind)) continue
    entries.push({
      status: 'remove', kind: e.kind, name: resourceDisplayName(e.kind, e.payload), targetId: e.id, fileRef: null,
      currentVersion: e.version, fileVersion: null, currentPayload: e.payload, payload: e.payload,
      changedFields: [], referencedBy: 0,
    })
  }

  // 남는 용어가 가리키는 도메인은 지우지 않는다 — 지우면 참조가 끊긴 용어가 라이브러리에 남는다.
  // 남는 용어 = 파일의 용어(stale 은 적용 여부가 플래그에 달려 있어 전후 값 모두) + 파일이 말하지 않은 기존 용어.
  const refs = new Map<string, number>()
  const count = (id: unknown) => { if (typeof id === 'string') refs.set(id, (refs.get(id) ?? 0) + 1) }
  for (const e of entries) {
    if (e.kind !== 'term' || e.status === 'remove') continue
    count(e.payload.domainId)
    if (e.status === 'stale') count(e.currentPayload?.domainId)
  }
  if (!present.has('term')) for (const e of existing) if (e.kind === 'term') count(e.payload.domainId)
  for (const e of entries) {
    if (e.status !== 'remove' || e.kind !== 'domain') continue
    e.referencedBy = refs.get(e.targetId!) ?? 0
    if (e.referencedBy > 0) {
      warnings.push(`도메인 「${e.name}」: 파일에 없지만 남는 용어 ${e.referencedBy}건이 가리키고 있어 삭제 대상에서 뺍니다`)
    }
  }
  return { entries, warnings }
}

export function materializeLibraryImport(
  plan: LibraryImportPlan, opts: { prune: boolean; includeStale: boolean }, newId: () => string,
): LibraryImportWrites {
  const idOf = new Map<string, string>()
  for (const e of plan.entries) if (e.status === 'add') idOf.set(newRef(e.fileRef!), newId())
  const resolve = (payload: Record<string, unknown>): Record<string, unknown> =>
    typeof payload.domainId === 'string' && payload.domainId.startsWith(NEW_REF)
      ? { ...payload, domainId: idOf.get(payload.domainId)! }
      : { ...payload }
  const writes: LibraryImportWrites = { inserts: [], updates: [], removes: [] }
  for (const e of plan.entries) {
    if (e.status === 'add') writes.inserts.push({ id: idOf.get(newRef(e.fileRef!))!, kind: e.kind, payload: resolve(e.payload) })
    else if (e.status === 'update' || (e.status === 'stale' && opts.includeStale)) {
      writes.updates.push({ id: e.targetId!, kind: e.kind, payload: resolve(e.payload), version: e.currentVersion! + 1 })
    } else if (e.status === 'remove' && opts.prune && e.referencedBy === 0) writes.removes.push(e.targetId!)
  }
  return writes
}

export type LibraryImportSummary = {
  counts: Record<LibraryImportStatus, number> & { removeBlocked: number }
  warnings: string[]
  entries: {
    status: Exclude<LibraryImportStatus, 'unchanged'>
    kind: ResourceKind
    name: string
    currentVersion: number | null
    fileVersion: number | null
    referencedBy: number
    changes: { field: string; from: unknown; to: unknown }[]
  }[]
}

/** 화면·CLI 표시용 요약. 용어의 domainId 는 사람이 읽을 수 있게 도메인 이름으로 바꾼다. */
export function summarizeLibraryImport(plan: LibraryImportPlan, existing: readonly LibraryItem[]): LibraryImportSummary {
  const domainName = new Map<string, string>()
  for (const e of existing) if (e.kind === 'domain') domainName.set(e.id, resourceDisplayName('domain', e.payload))
  for (const e of plan.entries) if (e.status === 'add' && e.kind === 'domain') domainName.set(newRef(e.fileRef!), e.name)
  const show = (field: string, value: unknown): unknown =>
    field === 'domainId' && typeof value === 'string' ? domainName.get(value) ?? value : value

  const counts = { add: 0, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0 }
  const entries: LibraryImportSummary['entries'] = []
  for (const e of plan.entries) {
    counts[e.status] += 1
    if (e.status === 'remove' && e.referencedBy > 0) counts.removeBlocked += 1
    if (e.status === 'unchanged') continue
    entries.push({
      status: e.status, kind: e.kind, name: e.name, currentVersion: e.currentVersion,
      fileVersion: e.fileVersion, referencedBy: e.referencedBy,
      changes: e.changedFields.map((field) => ({
        field, from: show(field, e.currentPayload?.[field] ?? null), to: show(field, e.payload[field] ?? null),
      })),
    })
  }
  return { counts, warnings: plan.warnings, entries }
}
```

`index.ts` 에 더한다:

```ts
export { planLibraryImport, materializeLibraryImport, summarizeLibraryImport } from './library-import.js'
export type {
  LibraryImportStatus, LibraryImportEntry, LibraryImportPlan, LibraryImportWrites, LibraryImportSummary,
} from './library-import.js'
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/library-import.test.ts src/library-file.test.ts`
Expected: PASS

- [ ] **Step 5: 타입 검사** — `pnpm --filter @erdd/core exec tsc --noEmit; echo "exit=$?"` → `exit=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/library-import.ts packages/core/src/library-import.test.ts packages/core/src/index.ts && git commit -m "feat(core): 라이브러리 파일 갱신 병합 계획 — 매칭·부분 필드 병합·stale·참조 보존 삭제

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — (a) ② 이름 매칭의 `.filter((e) => !claimed.has(e.id))` 를 지우면 「id 매칭이 먼저 자리를 차지하고…」가, (b) `status` 판정에서 `matchedById.has(f.ref) &&` 를 지우면 「이름 매칭은 파일 version 이 낮아도 stale 이 아니다」가, (c) `referencedBy` 가드를 지우면 「남는 용어가 가리키는 도메인은…」이 실패하는지 각각 본다.

---

### Task 3: core Excel 경로 — 워크북 읽기 이전과 원천 문서 변환

**Files:**
- Create: `packages/core/src/excel-workbook.ts`, `packages/core/src/excel-workbook.test.ts`
- Create: `packages/core/src/library-excel.ts`, `packages/core/src/library-excel.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/src/editor/excel-file.ts` (`rowValues`·`cellText`·`readDictSheets` 본문을 core 로 옮긴다)

**Interfaces:**
- Consumes: `planDictImport`, `RawSheet`, `DictImportIssue`, `DICT_SHEET_KEYS`, `EXCEL_SHEET_NAME`, `createEmptyModel`, `LibraryFileDoc` (Task 1), `planLibraryImport` (Task 2, 테스트에서만)
- Produces:
  ```ts
  export type WorkbookLike = { getWorksheet(name: string): WorksheetLike | undefined }
  export type WorksheetLike = { rowCount: number; getRow(n: number): { values: unknown; getCell(col: number): { value: unknown } } }
  export function dictSheetsFromWorkbook(wb: WorkbookLike): RawSheet[]   // 사전 시트가 하나도 없으면 Error
  export function libraryDocFromDictSheets(sheets: RawSheet[], opts: { name: string; targetDomainNames: readonly string[] }):
    { ok: true; doc: LibraryFileDoc; warnings: DictImportIssue[] } | { ok: false; issues: DictImportIssue[] }
  export function dictIssueText(issue: DictImportIssue): string   // 「용어사전 3행 — …」
  ```

**규칙:**
- 시트가 있으면 그 종류를 말한 것이고(키 있음), 없으면 말하지 않은 것이다. Excel 에는 커스텀 항목 시트가 없으므로 `customField` 키는 언제나 없다.
- 없는 컬럼은 말하지 않은 것 — `planDictImport` 의 `patch`(있던 컬럼만)를 그대로 `fields` 로 쓴다.
- 용어의 「기본 도메인」: 같은 파일 도메인이면 그 파일 id(`domain:<행>`)로, 아니면 `domainName` 으로 남겨 가져오기 계획이 대상 라이브러리에서 찾게 한다. 경고 판정에는 `targetDomainNames` 를 쓴다(파일에도 대상에도 없을 때만 경고).
- **오류 행이 하나라도 있으면 `ok: false`** — 가져오기는 전부 아니면 전무다(프로젝트 Excel 가져오기처럼 오류 행을 건너뛰고 진행하지 않는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `packages/core/src/excel-workbook.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { dictSheetsFromWorkbook, type WorkbookLike } from './excel-workbook.js'

function workbook(sheets: Record<string, unknown[][]>): WorkbookLike {
  return {
    getWorksheet: (name) => {
      const rows = sheets[name]
      if (rows === undefined) return undefined
      return {
        rowCount: rows.length,
        getRow: (n) => ({
          values: [null, ...(rows[n - 1] ?? [])],
          getCell: (col) => ({ value: rows[n - 1]?.[col - 1] ?? null }),
        }),
      }
    },
  }
}

describe('dictSheetsFromWorkbook', () => {
  it('사전 시트를 문자열 격자로 읽고 빈 행을 건너뛴다', () => {
    const sheets = dictSheetsFromWorkbook(workbook({
      단어사전: [['논리명', '약어'], ['고객', 'CUST'], [null, ''], [{ richText: [{ text: '주' }, { text: '문' }] }, { result: 'ORD' }]],
    }))
    expect(sheets).toEqual([{ key: 'words', headers: ['논리명', '약어'], rows: [['고객', 'CUST'], ['주문', 'ORD']] }])
  })

  it('사전 시트가 하나도 없으면 던진다', () => {
    expect(() => dictSheetsFromWorkbook(workbook({ 다른시트: [['a']] }))).toThrow(/단어사전/)
  })
})
```

`packages/core/src/library-excel.test.ts`

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/core exec vitest run src/excel-workbook.test.ts src/library-excel.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

`packages/core/src/excel-workbook.ts` — `apps/web/src/editor/excel-file.ts` 의 `rowValues`·`cellText`·`readDictSheets` 본문을 **그대로** 옮긴다(동작을 바꾸지 않는다). exceljs 에 의존하지 않도록 구조 타입을 받는다.

```ts
import { DICT_SHEET_KEYS, type RawSheet } from './excel-import.js'
import { EXCEL_SHEET_NAME } from './excel-sheets.js'

/** exceljs Workbook 의 쓰는 부분만. core 가 exceljs 에 의존하지 않도록 구조 타입으로 받는다. */
export type WorksheetLike = {
  rowCount: number
  getRow(n: number): { values: unknown; getCell(col: number): { value: unknown } }
}
export type WorkbookLike = { getWorksheet(name: string): WorksheetLike | undefined }

/** exceljs Row.values는 1-based 희소 배열(0번은 null)이다. 키 매핑 형태면 빈 배열로 본다. */
function rowValues(row: { values: unknown }): unknown[] {
  return Array.isArray(row.values) ? (row.values as unknown[]) : []
}

/** 셀 값을 문자열로 정규화한다. 파서가 trim을 하므로 여기서는 하지 않는다. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { richText?: { text?: string }[]; result?: unknown; text?: string }
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text ?? '').join('')
    if ('result' in o) return cellText(o.result)
    if (typeof o.text === 'string') return o.text
  }
  return String(v)
}

/**
 * 워크북에서 사전 3시트(단어사전·용어사전·도메인정의서)를 문자열 격자로 읽는다. 웹(브라우저)과
 * CLI(노드)가 각자 exceljs 로 연 워크북을 넘긴다 — 셀 해석이 두 곳에서 갈라지지 않게 여기 하나다.
 * 그 이름의 시트가 하나도 없으면 던진다 — 잘못된 파일을 조용히 0건으로 처리하지 않기 위해서다.
 */
export function dictSheetsFromWorkbook(wb: WorkbookLike): RawSheet[] {
  const out: RawSheet[] = []
  for (const key of DICT_SHEET_KEYS) {
    const ws = wb.getWorksheet(EXCEL_SHEET_NAME[key])
    if (!ws) continue
    const headerValues = rowValues(ws.getRow(1))
    const headers: string[] = []
    for (let c = 1; c < headerValues.length; c++) headers.push(cellText(headerValues[c]))
    while (headers.length > 0 && headers.at(-1) === '') headers.pop()
    if (headers.length === 0) continue
    const rows: string[][] = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const values = headers.map((_, i) => cellText(row.getCell(i + 1).value))
      if (values.every((v) => v.trim() === '')) continue
      rows.push(values)
    }
    out.push({ key, headers, rows })
  }
  if (out.length === 0) throw new Error('단어사전·용어사전·도메인정의서 시트를 찾을 수 없습니다')
  return out
}
```

`apps/web/src/editor/excel-file.ts` — `rowValues`·`cellText` 를 지우고(파일 안 다른 사용처가 있으면 남긴다 — `grep -n "cellText\|rowValues" apps/web/src/editor/excel-file.ts` 로 확인) `readDictSheets` 를 이렇게 바꾼다:

```ts
export async function readDictSheets(file: Blob): Promise<RawSheet[]> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  return dictSheetsFromWorkbook(wb)
}
```
(import 에 `dictSheetsFromWorkbook` 을 더하고 쓰지 않게 된 `DICT_SHEET_KEYS`·`EXCEL_SHEET_NAME` import 를 정리한다.)

`packages/core/src/library-excel.ts`

```ts
import { EXCEL_SHEET_NAME } from './excel-sheets.js'
import { planDictImport, type DictImportIssue, type RawSheet } from './excel-import.js'
import type { LibraryFileDoc, LibraryFileEntry } from './library-file.js'
import { createEmptyModel } from './model.js'

/**
 * 기존 Excel 사전 양식을 라이브러리 원천 파일 문서로 바꾼다. 서버가 받는 입력은 언제나 라이브러리 파일
 * 하나라서, Excel 은 클라(웹·CLI)가 이것으로 바꿔 직렬화해 보낸다.
 *
 * 헤더 해석·행 검증은 `planDictImport` 를 재사용한다. 그 `patch` 는 시트에 **있던 컬럼만** 담으므로
 * 그대로 원천 파일의 「적힌 키」가 된다 — 없는 컬럼은 말하지 않은 것이고 가져오기가 기존 값을 두지만,
 * draft 를 쓰면 영문명 컬럼이 없는 파일이 기존 영문명을 전부 지운다.
 */
export function libraryDocFromDictSheets(
  sheets: RawSheet[], opts: { name: string; targetDomainNames: readonly string[] },
): { ok: true; doc: LibraryFileDoc; warnings: DictImportIssue[] } | { ok: false; issues: DictImportIssue[] } {
  // 대상 라이브러리의 도메인 이름을 모델에 얹어, 「기본 도메인을 찾을 수 없다」 경고가 파일에도 대상에도
  // 없을 때만 나게 한다(해석 자체는 가져오기 계획이 이름으로 다시 한다).
  const model = createEmptyModel()
  opts.targetDomainNames.forEach((name, i) => {
    const id = `target:${i}`
    model.domains[id] = {
      id, name, category: null, logicalType: '',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
  })
  const plan = planDictImport(sheets, model)
  const errors = plan.issues.filter((i) => i.level === 'error')
  if (errors.length > 0) return { ok: false, issues: errors }

  const present = new Set(sheets.map((s) => s.key))
  const kinds: LibraryFileDoc['kinds'] = {}
  const domainIdByName = new Map<string, string>()
  if (present.has('domains')) {
    kinds.domain = []
    for (const e of plan.entries) {
      if (e.kind !== 'domain') continue
      const id = `domain:${e.row}`
      domainIdByName.set(e.draft.name.trim(), id)
      kinds.domain.push({ id, fields: { ...e.patch } })
    }
  }
  if (present.has('words')) {
    kinds.word = plan.entries.flatMap((e) => (e.kind === 'word' ? [{ fields: { ...e.patch } }] : []))
  }
  if (present.has('terms')) {
    kinds.term = plan.entries.flatMap((e): LibraryFileEntry[] => {
      if (e.kind !== 'term') return []
      const { domainName, ...rest } = e.patch
      if (domainName === undefined) return [{ fields: rest }]
      const fileId = domainIdByName.get(domainName.trim())
      return [fileId !== undefined ? { fields: { ...rest, domainId: fileId } } : { domainName, fields: rest }]
    })
  }
  return {
    ok: true,
    doc: { library: { name: opts.name, description: '' }, kinds },
    warnings: plan.issues.filter((i) => i.level === 'warning'),
  }
}

/** 화면·CLI 공용 문구 — `row` 는 1-based 데이터 행이라 Excel 행 번호는 +1 이다. */
export function dictIssueText(issue: DictImportIssue): string {
  const where = issue.row === null ? EXCEL_SHEET_NAME[issue.sheet] : `${EXCEL_SHEET_NAME[issue.sheet]} ${issue.row + 1}행`
  return `${where} — ${issue.message}`
}
```

> ⚠️ `domainName: ''`(기본 도메인 칸이 비어 있음)는 `domainName` 으로 남아 가져오기가 `null` 로 푼다 — 「이 용어는 도메인이 없다」는 의사표시다. 컬럼 자체가 없으면 `domainName` 이 `patch` 에 없어 말하지 않은 것이 된다.

`index.ts` 에 더한다:

```ts
export { dictSheetsFromWorkbook } from './excel-workbook.js'
export type { WorkbookLike, WorksheetLike } from './excel-workbook.js'
export { libraryDocFromDictSheets, dictIssueText } from './library-excel.js'
```

- [ ] **Step 4: 통과를 확인한다** — core 새 테스트 + **웹의 기존 Excel 테스트**(이전이 동작을 바꾸지 않았다는 증거)

Run: `pnpm --filter @erdd/core exec vitest run src/excel-workbook.test.ts src/library-excel.test.ts && pnpm --filter @erdd/web exec vitest run src/editor/excel-file.test.ts src/editor/dict-import-edits.test.ts`
Expected: PASS

- [ ] **Step 5: 타입 검사** — `pnpm -s -r typecheck; echo "exit=$?"` → `exit=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/core/src/excel-workbook.ts packages/core/src/excel-workbook.test.ts packages/core/src/library-excel.ts packages/core/src/library-excel.test.ts packages/core/src/index.ts apps/web/src/editor/excel-file.ts && git commit -m "feat(core): Excel 사전 → 라이브러리 원천 파일, 워크북 셀 해석을 core 로 옮긴다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — `libraryDocFromDictSheets` 의 `fields: { ...e.patch }` 를 `e.draft` 로 바꾸면 「없는 컬럼의 기존 값은 건드리지 않는다」가, 용어의 `domainName` 갈래를 `domainId: null` 로 바꾸면 「도메인 시트 없이 용어만 올려도…」가 실패하는지 본다.

---

### Task 4: 서버 — 목록의 `canWrite`, 내보내기, 토큰 개방

**Files:**
- Modify: `apps/server/src/routers/resource.ts`
- Modify: `apps/server/src/routers/resource.test.ts`, `apps/server/src/routers/token-api.test.ts`

**Interfaces:**
- Consumes: `exportLibraryFile` (Task 1), `loadLibraryItems` (`services/promote.ts`), `requireLibraryRead`, `getOrgMember` (`services/perm.ts`)
- Produces:
  - `resource.library.list` — `apiProcedure`, 행마다 `canWrite: boolean`
  - `resource.library.export({ libraryId })` — `apiProcedure` query → `{ libraryId: string; name: string; text: string; danglingDomainRefs: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `resource.test.ts` 의 `describe('resource')` 안에 더한다

```ts
  it('library.list 는 행마다 쓰기 가능 여부를 싣는다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'user@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    const adminToken = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const userToken = await loginAs(app, 'user@t.dev', 'pw-123456')
    await post(app, 'resource.library.create', adminToken, { scope: 'global', name: '표준' })
    expect((await get(app, 'resource.library.list', adminToken, { scope: 'global' })).json().result.data[0].canWrite).toBe(true)
    expect((await get(app, 'resource.library.list', userToken, { scope: 'global' })).json().result.data[0].canWrite).toBe(false)
  })

  it('library.export 는 읽기 권한이면 배포 파일을 내고, 끊긴 도메인 참조를 null 로 쓴다', async () => {
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'user@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    const adminToken = await loginAs(app, 'admin@t.dev', 'pw-123456')
    const userToken = await loginAs(app, 'user@t.dev', 'pw-123456')
    const libraryId = (await post(app, 'resource.library.create', adminToken, { scope: 'global', name: '표준' })).json().result.data.id
    const domainId = (await post(app, 'resource.items.create', adminToken, { libraryId, kind: 'domain', payload: {
      name: '금액', category: null, logicalType: 'DECIMAL', dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null,
    } })).json().result.data.id
    await post(app, 'resource.items.create', adminToken, { libraryId, kind: 'term', payload: {
      logicalName: '금액합계', physicalName: 'AMT_SUM', domainId, description: null,
    } })
    await post(app, 'resource.items.remove', adminToken, { itemId: domainId })

    const res = await get(app, 'resource.library.export', userToken, { libraryId })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data
    expect(data).toMatchObject({ libraryId, name: '표준', danglingDomainRefs: 1 })
    const parsed = parseLibraryFile(data.text, 'distribution')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
    expect(parsed.doc.library.id).toBe(libraryId)
    expect(parsed.doc.kinds.term![0]!.fields.domainId).toBeNull()
  })
```
(파일 머리 import 에 `import { parseLibraryFile } from '@erdd/core'` 를 더한다.)

`token-api.test.ts` 의 `TOKEN_PATHS` 에 이 태스크가 여는 둘을 더한다(`resource.library.import` 는 Task 5 가 더한다 — 여기서 더하면 이 태스크의 커밋에서 토큰 표면 테스트가 깨진다):

```ts
  'resource.library.listForProject', 'resource.items.list', 'resource.promote',
  'resource.library.list', 'resource.library.export',
```
그리고 같은 파일에 토큰으로 내보내기가 되는지 더한다:

```ts
  it('토큰으로 라이브러리 목록·내보내기를 부른다', async () => {
    const list = await tGet('resource.library.list', { scope: 'org', orgId })
    expect(list.statusCode).toBe(200)
    expect(list.json().result.data[0]).toMatchObject({ id: libraryId, canWrite: true })
    const exported = await tGet('resource.library.export', { libraryId })
    expect(exported.statusCode).toBe(200)
    expect(exported.json().result.data.text).toContain('format: erdd-library')
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/<test DB>' pnpm --filter @erdd/server exec vitest run src/routers/resource.test.ts src/routers/token-api.test.ts`
Expected: FAIL — `canWrite` undefined, `resource.library.export` 404, 토큰 표면 불일치. **건너뛰기(skipped)가 아니라 실패여야 한다** — skip 이면 `DATABASE_URL` 이 안 먹은 것이다.

- [ ] **Step 3: 구현한다** — `apps/server/src/routers/resource.ts`

`library.list` 를 바꾼다:

```ts
    // CLI(erdd library)가 토큰으로 부른다 — guides/cli.md 「액세스 토큰 인증」.
    list: apiProcedure
      .input(z.object({ scope: z.enum(['global', 'org']), orgId: z.string().uuid().optional() }))
      .query(async ({ ctx, input }) => {
        if (input.scope === 'org' && !input.orgId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
        }
        await requireScopeRead(ctx.db, input.scope, input.orgId ?? null, ctx.user)
        const where = input.scope === 'global'
          ? eq(resourceLibraries.scope, 'global')
          : and(eq(resourceLibraries.scope, 'org'), eq(resourceLibraries.orgId, input.orgId!))
        // 클라가 역할 조합식을 재현하지 않도록 쓰기 가능 여부를 서버가 판정해 싣는다(listForProject 와 같다).
        const me = input.scope === 'org' ? await getOrgMember(ctx.db, input.orgId!, ctx.user.id) : undefined
        const canWrite = input.scope === 'global'
          ? ctx.user.role === 'admin'
          : me?.role === 'owner' || me?.role === 'admin'
        return (await listWithCounts(ctx.db, where)).map((row) => ({ ...row, canWrite }))
      }),
```
(`import { getOrgMember, requireProjectAccess } from '../services/perm.js'`)

`library` 라우터 안(`remove` 뒤)에 더한다:

```ts
    // 배포 파일로 내보낸다 — 읽을 수 있으면 누구나(배포 목적). CLI(erdd library export)가 토큰으로 부른다.
    export: apiProcedure
      .input(z.object({ libraryId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const library = await requireLibraryRead(ctx.db, input.libraryId, ctx.user)
        const items = await loadLibraryItems(ctx.db, input.libraryId)
        return { libraryId: library.id, name: library.name, ...exportLibraryFile(library, items) }
      }),
```
(`import { exportLibraryFile, … } from '@erdd/core'`)

- [ ] **Step 4: 통과를 확인한다** — Step 2 명령 → PASS. 웹 스위트도 돈다(`library.list` 출력이 늘었다): `pnpm --filter @erdd/web exec vitest run src/components/resource-library-manager.test.tsx` → PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/server/src/routers/resource.ts apps/server/src/routers/resource.test.ts apps/server/src/routers/token-api.test.ts && git commit -m "feat(server): 라이브러리 내보내기, 목록에 쓰기 가능 여부, 둘을 토큰에 연다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 6: 구분력 실증(커밋 뒤)** — `library.list` 를 `authedProcedure` 로 되돌리면 토큰 표면 테스트가, `canWrite` 의 조직 갈래를 `false` 로 고정하면 「토큰으로 라이브러리 목록·내보내기를 부른다」가 실패하는지 본다.

---

### Task 5: 서버 — 가져오기

**Files:**
- Create: `apps/server/src/services/library-import.ts`
- Create: `apps/server/src/testing/locks.ts`
- Create: `apps/server/src/routers/library-import.test.ts`
- Modify: `apps/server/src/routers/resource.ts`, `apps/server/src/routers/promotion.test.ts`(헬퍼 import 로 교체), `apps/server/src/routers/token-api.test.ts`

**Interfaces:**
- Consumes: `parseLibraryFile`, `formatLibraryFileIssues`, `planLibraryImport`, `materializeLibraryImport`, `summarizeLibraryImport`, `LibraryImportSummary`, `RESOURCE_PAYLOAD_SCHEMAS` (core), `loadLibraryItems`, `requireScopeWrite`, `requireLibraryWrite`, `parsePayload`
- Produces:
  ```ts
  // services/library-import.ts
  export function libraryStateHash(items: readonly { id: string; version: number }[]): string   // sha256 hex
  export type LibraryImportInput = {
    target: { libraryId: string } | { create: { scope: 'global' | 'org'; orgId?: string; name: string; description: string } }
    text: string; prune: boolean; includeStale: boolean; dryRun: boolean; expectedStateHash?: string
  }
  export type LibraryImportResponse = { libraryId: string | null; applied: boolean; stateHash: string; summary: LibraryImportSummary }
  export async function runLibraryImport(db: Db, actor: { id: string; role: 'admin' | 'user' }, input: LibraryImportInput): Promise<LibraryImportResponse>
  // testing/locks.ts
  export async function waitForLockWaiter(client: pg.PoolClient): Promise<void>
  ```
  - 프로시저 `resource.library.import` — `apiProcedure` mutation, 입력 = `LibraryImportInput`, 출력 = `LibraryImportResponse`

**규칙:** spec 2절 「적용·원자성·경합」. `create` 는 라이브러리 생성 + 가져오기가 한 트랜잭션. 기존 라이브러리는 라이브러리 행 `FOR UPDATE` → `loadLibraryItems` → 해시 대조 → 계획 → 쓰기. `dryRun` 은 트랜잭션·락 없이 계산만.

- [ ] **Step 1: 락 대기 헬퍼를 옮긴다** — `promotion.test.ts` 의 `waitForLockWaiter` 함수(주석 포함)를 `apps/server/src/testing/locks.ts` 로 옮기고 export 한다(`import type pg from 'pg'`). `promotion.test.ts` 는 `import { waitForLockWaiter } from '../testing/locks.js'` 로 바꾼다. `promotion.test.ts` 를 돌려 그대로 통과하는지 본다.

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `apps/server/src/routers/library-import.test.ts`

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { uuidv7 } from 'uuidv7'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp, loginAs } from '../testing/helpers.js'
import { waitForLockWaiter } from '../testing/locks.js'
import { createAccount } from '../services/accounts.js'

const url = process.env.DATABASE_URL
const HEAD = 'format: erdd-library\nformatVersion: 1\nlibrary: { name: 파일 }\n'
const wordsFile = (...rows: string[]) => `${HEAD}words:\n${rows.map((r) => `  - ${r}`).join('\n')}\n`

describe.skipIf(!url)('resource.library.import', () => {
  let app: FastifyInstance
  let admin: string
  let user: string
  const post = (session: string, input: unknown) => app.inject({
    method: 'POST', url: '/trpc/resource.library.import', cookies: { erdd_session: session },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify(input),
  })
  const items = (libraryId: string) =>
    app.db!.select().from(resourceItems).where(eq(resourceItems.libraryId, libraryId))
  const createGlobal = async (name = '표준') => (await app.inject({
    method: 'POST', url: '/trpc/resource.library.create', cookies: { erdd_session: admin },
    headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ scope: 'global', name }),
  })).json().result.data.id as string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    await createAccount(app.db!, { email: 'admin@t.dev', name: 'A', password: 'pw-123456', role: 'admin' })
    await createAccount(app.db!, { email: 'user@t.dev', name: 'U', password: 'pw-123456', role: 'user' })
    admin = await loginAs(app, 'admin@t.dev', 'pw-123456')
    user = await loginAs(app, 'user@t.dev', 'pw-123456')
  })

  it('create 로 전역 라이브러리를 만들며 가져온다 — 관리자만', async () => {
    const input = { target: { create: { scope: 'global', name: '행안부' } }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') }
    expect((await post(user, input)).statusCode).toBe(403)
    const res = await post(admin, input)
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data
    expect(data).toMatchObject({ applied: true, summary: { counts: { add: 1 } } })
    expect(await items(data.libraryId)).toEqual([expect.objectContaining({ kind: 'word', version: 1 })])
  })

  it('다른 조직 orgId 로는 만들 수 없다', async () => {
    const orgId = uuidv7()
    const res = await post(user, { target: { create: { scope: 'org', orgId, name: 'x' } }, text: wordsFile('{ logicalName: 고객 }') })
    expect(res.statusCode).toBe(403)
  })

  it('dryRun 은 쓰지 않고 계획과 해시를 돌려준다', async () => {
    const libraryId = await createGlobal()
    const res = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객 }'), dryRun: true })
    expect(res.json().result.data).toMatchObject({ applied: false, summary: { counts: { add: 1 } }, stateHash: expect.any(String) })
    expect(await items(libraryId)).toEqual([])
  })

  it('갱신은 버전을 올리고, 같은 내용 재가져오기는 버전·updatedAt 을 건드리지 않는다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') })
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CSTMR }') })
    expect((await items(libraryId))[0]).toMatchObject({ version: 2 })
    const before = (await app.db!.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId)))[0]!.updatedAt
    const again = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CSTMR }') })
    expect(again.json().result.data.summary.counts).toMatchObject({ unchanged: 1, update: 0 })
    expect((await items(libraryId))[0]).toMatchObject({ version: 2 })
    const after = (await app.db!.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId)))[0]!.updatedAt
    expect(after.getTime()).toBe(before.getTime())
  })

  it('내보낸 파일을 그대로 다시 가져오면 바뀌는 것이 없다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }', '{ logicalName: 주문, abbreviation: ORD }') })
    const exported = (await app.inject({
      method: 'GET', url: `/trpc/resource.library.export?input=${encodeURIComponent(JSON.stringify({ libraryId }))}`,
      cookies: { erdd_session: admin },
    })).json().result.data.text
    const res = await post(admin, { target: { libraryId }, text: exported, prune: true })
    expect(res.json().result.data.summary.counts).toMatchObject({ unchanged: 2, add: 0, update: 0, remove: 0 })
  })

  it('미리보기 해시가 달라지면 409 로 거절하고 아무것도 쓰지 않는다', async () => {
    const libraryId = await createGlobal()
    const preview = (await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객 }'), dryRun: true })).json().result.data
    await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 주문 }') })   // 그 사이 남이 바꿈
    const res = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객 }'), expectedStateHash: preview.stateHash })
    expect(res.statusCode).toBe(409)
    expect((await items(libraryId)).map((i) => (i.payload as { logicalName: string }).logicalName)).toEqual(['주문'])
  })

  it('파일 오류는 400 이고 위치를 담는다', async () => {
    const libraryId = await createGlobal()
    const res = await post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbrevation: X }') })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain('words[0] (고객)')
  })

  /**
   * 🔥 가져오기는 전부 아니면 전무다. 실패 주입은 실제 DB 트리거로 한다 — 두 번째 항목 INSERT 에서
   * 예외를 던지면, 생성한 라이브러리와 첫 항목이 함께 롤백돼야 한다.
   */
  it('중간에 실패하면 라이브러리 생성까지 함께 롤백된다', async () => {
    const client = await app.pgPool!.connect()
    try {
      await client.query(`CREATE OR REPLACE FUNCTION erdd_test_fail() RETURNS trigger AS $$
        BEGIN IF NEW.payload->>'logicalName' = '__fail__' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
      await client.query('CREATE TRIGGER erdd_test_fail BEFORE INSERT ON resource_items FOR EACH ROW EXECUTE FUNCTION erdd_test_fail()')
      const res = await post(admin, {
        target: { create: { scope: 'global', name: '롤백' } },
        text: wordsFile('{ logicalName: 고객 }', '{ logicalName: __fail__ }'),
      })
      expect(res.statusCode).toBe(500)
      expect(await app.db!.select().from(resourceLibraries).where(eq(resourceLibraries.name, '롤백'))).toEqual([])
      expect(await app.db!.select().from(resourceItems)).toEqual([])
    } finally {
      await client.query('DROP TRIGGER IF EXISTS erdd_test_fail ON resource_items')
      await client.query('DROP FUNCTION IF EXISTS erdd_test_fail()')
      client.release()
    }
  })

  /**
   * 🔥 동시 가져오기가 동명 항목을 두 개 만들지 않는다 — 계획이 **라이브러리 행 락 안에서** 세워져야 한다.
   * 밖에서 라이브러리 행을 잠가 가져오기를 붙들어 두고(실제 대기를 pg_locks 로 확인), 그 사이 같은
   * 이름의 항목을 넣고 풀어 준다. 락 전에 항목을 읽는 구현이면 「추가」로 계산해 둘이 된다.
   */
  it('동시 가져오기가 동명 중복을 만들지 않는다', async () => {
    const libraryId = await createGlobal()
    const client = await app.pgPool!.connect()
    let res: Awaited<ReturnType<typeof post>>
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM resource_libraries WHERE id = $1 FOR UPDATE', [libraryId])
      const pending = post(admin, { target: { libraryId }, text: wordsFile('{ logicalName: 고객, abbreviation: CUST }') })
      await waitForLockWaiter(client)
      await client.query(
        `INSERT INTO resource_items (id, library_id, kind, payload, version) VALUES ($1, $2, 'word', $3::jsonb, 1)`,
        [uuidv7(), libraryId, JSON.stringify({ logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null })],
      )
      await client.query('COMMIT')
      res = await pending
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data.summary.counts).toMatchObject({ unchanged: 1, add: 0 })
    expect(await items(libraryId)).toHaveLength(1)
  })

  it('prune 은 파일에 없는 항목을 지우되, 남는 용어가 가리키는 도메인은 남긴다', async () => {
    const libraryId = await createGlobal()
    await post(admin, { target: { libraryId }, text: `${HEAD}domains:\n  - { id: d, name: 금액, logicalType: DECIMAL }\n  - { name: 수량, logicalType: INT }\nterms:\n  - { logicalName: 합계, physicalName: SUM, domainId: d }\nwords:\n  - { logicalName: 고객 }\n` })
    const res = await post(admin, { target: { libraryId }, text: `${HEAD}domains: []\nwords: []\n`, prune: true })
    expect(res.json().result.data.summary.counts).toMatchObject({ remove: 3, removeBlocked: 1 })
    const left = (await items(libraryId)).map((i) => `${i.kind}:${String((i.payload as { name?: string; logicalName?: string }).name ?? (i.payload as { logicalName?: string }).logicalName)}`).sort()
    expect(left).toEqual(['domain:금액', 'term:합계'])
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/<test DB>' pnpm --filter @erdd/server exec vitest run src/routers/library-import.test.ts`
Expected: FAIL — `resource.library.import` 404. (skip 이면 `DATABASE_URL` 을 확인한다.)

- [ ] **Step 4: 구현한다** — `apps/server/src/services/library-import.ts`

```ts
import { createHash } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import {
  formatLibraryFileIssues, materializeLibraryImport, parseLibraryFile, planLibraryImport, summarizeLibraryImport,
  type LibraryImportSummary, type LibraryImportWrites,
} from '@erdd/core'
import type { Db } from '../db/client.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { loadLibraryItems } from './promote.js'
import { parsePayload, requireLibraryWrite, requireScopeWrite } from './resource-library.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Actor = { id: string; role: 'admin' | 'user' }

export type LibraryImportInput = {
  target: { libraryId: string } | { create: { scope: 'global' | 'org'; orgId?: string; name: string; description: string } }
  text: string
  prune: boolean
  includeStale: boolean
  dryRun: boolean
  expectedStateHash?: string
}
export type LibraryImportResponse = {
  libraryId: string | null
  applied: boolean
  stateHash: string
  summary: LibraryImportSummary
}

/** 한 번에 넣는 행 수 — 행당 파라미터 5개라 Postgres 한도(65535)보다 넉넉히 작게. */
const CHUNK = 1000

/**
 * 미리보기 → 적용 사이에 라이브러리가 바뀌었는지 판정하는 값. (id, version) 전체를 id 오름차순으로
 * 이어 해시한다 — 항목이 5만 건이어도 클라가 들고 다니는 것은 64자다.
 */
export function libraryStateHash(items: readonly { id: string; version: number }[]): string {
  const hash = createHash('sha256')
  for (const it of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) hash.update(`${it.id}:${it.version}\n`)
  return hash.digest('hex')
}

/**
 * 파일 → 라이브러리 갱신 병합(guides/shared-resources.md 「파일 내보내기·가져오기」).
 * 파일은 텍스트로 받아 여기서 파싱한다 — 클라가 파싱한 구조를 믿지 않는다.
 * 한 번의 가져오기는 한 트랜잭션이고 전부 아니면 전무다.
 */
export async function runLibraryImport(db: Db, actor: Actor, input: LibraryImportInput): Promise<LibraryImportResponse> {
  const parsed = parseLibraryFile(input.text, 'source')
  if (!parsed.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: [`라이브러리 파일 오류 ${parsed.issues.length}건`, ...formatLibraryFileIssues(parsed.issues)].join('\n'),
    })
  }
  const doc = parsed.doc
  const opts = { prune: input.prune, includeStale: input.includeStale }

  if ('create' in input.target) {
    const create = input.target.create
    if (create.scope === 'org' && !create.orgId) throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
    await requireScopeWrite(db, create.scope, create.orgId ?? null, actor)
    const plan = planLibraryImport([], doc, null)
    const response = { stateHash: libraryStateHash([]), summary: summarizeLibraryImport(plan, []) }
    if (input.dryRun) return { libraryId: null, applied: false, ...response }
    const libraryId = uuidv7()
    await db.transaction(async (tx) => {
      await tx.insert(resourceLibraries).values({
        id: libraryId, scope: create.scope, orgId: create.scope === 'org' ? create.orgId! : null,
        name: create.name, description: create.description,
      })
      await writeImport(tx, libraryId, materializeLibraryImport(plan, opts, uuidv7))
    })
    return { libraryId, applied: true, ...response }
  }

  const libraryId = input.target.libraryId
  await requireLibraryWrite(db, libraryId, actor)
  if (input.dryRun) {
    const items = await loadLibraryItems(db, libraryId)
    const plan = planLibraryImport(items, doc, libraryId)
    return { libraryId, applied: false, stateHash: libraryStateHash(items), summary: summarizeLibraryImport(plan, items) }
  }
  return db.transaction(async (tx) => {
    // 라이브러리 행을 먼저 잠그고 그 뒤에 항목을 읽는다 — 가져오기끼리의 동시 삽입(동명 중복)이 여기서
    // 직렬화된다. 항목을 락 전에 읽으면 계획이 낡은 목록으로 「추가」를 세운다.
    const locked = await tx.select({ id: resourceLibraries.id }).from(resourceLibraries)
      .where(eq(resourceLibraries.id, libraryId)).for('update')
    if (locked.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: '라이브러리를 찾을 수 없습니다' })
    const items = await loadLibraryItems(tx, libraryId)
    const stateHash = libraryStateHash(items)
    if (input.expectedStateHash !== undefined && input.expectedStateHash !== stateHash) {
      throw new TRPCError({ code: 'CONFLICT', message: '미리보기 이후 라이브러리가 바뀌었습니다 — 다시 미리보기 하세요' })
    }
    const plan = planLibraryImport(items, doc, libraryId)
    await writeImport(tx, libraryId, materializeLibraryImport(plan, opts, uuidv7))
    return { libraryId, applied: true, stateHash, summary: summarizeLibraryImport(plan, items) }
  })
}

async function writeImport(tx: Tx, libraryId: string, writes: LibraryImportWrites): Promise<void> {
  if (writes.inserts.length + writes.updates.length + writes.removes.length === 0) return
  const now = new Date()
  // 쓰기 직전에 종류별 스키마로 한 번 더 검증한다 — 병합 결과가 완전값인지(원천 파일의 부분 필드 + 기본값).
  for (let i = 0; i < writes.inserts.length; i += CHUNK) {
    await tx.insert(resourceItems).values(writes.inserts.slice(i, i + CHUNK).map((row) => ({
      id: row.id, libraryId, kind: row.kind, payload: parsePayload(row.kind, row.payload), version: 1,
    })))
  }
  for (const u of writes.updates) {
    await tx.update(resourceItems).set({ payload: parsePayload(u.kind, u.payload), version: u.version, updatedAt: now })
      .where(eq(resourceItems.id, u.id))
  }
  for (let i = 0; i < writes.removes.length; i += CHUNK) {
    await tx.delete(resourceItems).where(inArray(resourceItems.id, writes.removes.slice(i, i + CHUNK)))
  }
  await tx.update(resourceLibraries).set({ updatedAt: now }).where(eq(resourceLibraries.id, libraryId))
}
```

> `loadLibraryItems` 의 첫 인자 타입(`Db | MutationTx`)이 여기 `Tx` 를 받지 않으면 그 함수의 인자 타입을 `Db | Tx` 로 넓힌다(동작 변화 없음). 넓힌 사실을 보고한다.

`apps/server/src/routers/resource.ts` — `library` 라우터에 더한다:

```ts
    // CLI(erdd library import)가 토큰으로 부른다 — guides/cli.md 「액세스 토큰 인증」.
    import: apiProcedure
      .input(z.object({
        target: z.union([
          z.object({ libraryId: z.string().uuid() }),
          z.object({ create: z.object({
            scope: z.enum(['global', 'org']), orgId: z.string().uuid().optional(),
            name: z.string().min(1).max(100), description: z.string().max(500).default(''),
          }) }),
        ]),
        text: z.string().max(16 * 1024 * 1024),
        prune: z.boolean().default(false),
        includeStale: z.boolean().default(false),
        dryRun: z.boolean().default(false),
        expectedStateHash: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => runLibraryImport(ctx.db, ctx.user, input)),
```
`token-api.test.ts` 의 `TOKEN_PATHS` 에 `'resource.library.import'` 를 더한다.

- [ ] **Step 5: 통과를 확인한다**

Run: `DATABASE_URL='postgres://postgres:erdd@localhost:5432/<test DB>' pnpm --filter @erdd/server exec vitest run src/routers/library-import.test.ts src/routers/token-api.test.ts src/routers/promotion.test.ts src/routers/resource.test.ts`
Expected: PASS (skip 0)

- [ ] **Step 6: 타입 검사** — `pnpm -s -r typecheck; echo "exit=$?"` → `exit=0`

- [ ] **Step 7: 커밋**

```bash
git add apps/server/src/services/library-import.ts apps/server/src/testing/locks.ts apps/server/src/routers/library-import.test.ts apps/server/src/routers/resource.ts apps/server/src/routers/promotion.test.ts apps/server/src/routers/token-api.test.ts && git commit -m "feat(server): 라이브러리 파일 가져오기 — 행 락 안 재계산, 해시 대조, 전부 아니면 전무

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```
(`loadLibraryItems` 타입을 넓혔다면 `apps/server/src/services/promote.ts` 도 경로에 더한다.)

- [ ] **Step 8: 구분력 실증(커밋 뒤)** — (a) `loadLibraryItems(tx, …)` 를 락 **위로** 옮기면 「동시 가져오기가 동명 중복을 만들지 않는다」가 실패하는지, (b) `create` 의 `db.transaction` 을 풀어 라이브러리 insert 를 트랜잭션 밖으로 빼면 「중간에 실패하면 라이브러리 생성까지 함께 롤백된다」가 실패하는지, (c) 해시 대조를 지우면 409 테스트가 실패하는지 본다.

---

### Task 6: CLI `erdd library list|export|import`

**Files:**
- Create: `packages/cli/src/xlsx.ts`
- Create: `packages/cli/src/commands/library.ts`, `packages/cli/src/commands/library.test.ts`
- Modify: `packages/cli/src/main.ts`, `packages/cli/package.json`

**Interfaces:**
- Consumes: `createClient`, `ApiClient` (`client.ts`), `readConfig`, `resolveToken` (`config.ts`), `guardFeature`, `resolveLibrary`, `LibraryRow` (`dict-shared.ts`), core `parseLibraryFile`·`formatLibraryFileIssues`·`libraryDocFromDictSheets`·`dictIssueText`·`stringifyLibraryFile`·`dictSheetsFromWorkbook`·`LibraryImportSummary`·`RESOURCE_KIND_LABEL`
- Produces:
  ```ts
  export type LibraryCtx = CommandCtx & { server?: string }
  export function libraryList(ctx: LibraryCtx): Promise<number>
  export function libraryExport(ctx: LibraryCtx & { ref: string | undefined; out?: string }): Promise<number>
  export type LibraryImportCtx = LibraryCtx & {
    file: string | undefined; library?: string; create?: string; scope?: 'global' | 'org'; org?: string
    prune: boolean; includeStale: boolean; dryRun: boolean
  }
  export function libraryImport(ctx: LibraryImportCtx): Promise<number>
  // xlsx.ts
  export async function readDictSheetsFile(path: string): Promise<RawSheet[]>
  ```

- [ ] **Step 1: `exceljs` 를 CLI 에 더한다** — 웹과 같은 버전 범위

```bash
pnpm --filter @erdd/cli add exceljs@^4.4.0
```

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `packages/cli/src/commands/library.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../client.js'
import { libraryExport, libraryImport, libraryList, type LibraryImportCtx } from './library.js'

let dir: string
let out: string[]
let err: string[]
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-library-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
})
afterEach(() => vi.restoreAllMocks())

const GLOBAL = { id: 'g1', scope: 'global', orgId: null, name: '표준', description: '', itemCount: 2, canWrite: true }
const ORG = { id: 'o-lib', scope: 'org', orgId: 'o1', name: '팀표준', description: '', itemCount: 0, canWrite: false }
const SUMMARY = (counts: Partial<Record<string, number>>, entries: unknown[] = []) => ({
  counts: { add: 0, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0, ...counts }, warnings: [], entries,
})

function stub(opts: { imports?: unknown[]; onImport?: (input: Record<string, unknown>) => unknown } = {}) {
  const calls: { path: string; input: Record<string, unknown> }[] = []
  const client: ApiClient = {
    query: (async (path: string, input: Record<string, unknown>) => {
      calls.push({ path, input })
      if (path === 'resource.library.list') return input.scope === 'global' ? [GLOBAL] : [ORG]
      if (path === 'org.list') return [{ id: 'o1', name: '팀' }]
      if (path === 'resource.library.export') return { libraryId: 'g1', name: '표준', text: 'format: erdd-library\n', danglingDomainRefs: 1 }
      if (path === 'resource.items.list') return []
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async (path: string, input: Record<string, unknown>) => {
      calls.push({ path, input })
      if (path === 'resource.library.import') return opts.onImport?.(input)
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['mutate'],
  }
  return { client, calls }
}
const base = { cwd: '', json: false, yes: false, strict: false }

describe('erdd library', () => {
  it('list — 전역과 내 조직의 라이브러리를 쓰기 가능 여부와 함께 보인다', async () => {
    const { client } = stub()
    expect(await libraryList({ ...base, cwd: dir, client })).toBe(0)
    expect(out.join('')).toContain('표준 — 전역 · 항목 2 · 쓰기 가능 · g1')
    expect(out.join('')).toContain('팀표준 — 조직 팀 · 항목 0 · o-lib')
  })

  it('export -o — 파일로 쓰고 끊긴 도메인 참조를 알린다', async () => {
    const { client } = stub()
    const path = join(dir, 'std.erdd-lib.yaml')
    expect(await libraryExport({ ...base, cwd: dir, client, ref: '표준', out: path })).toBe(0)
    expect(await readFile(path, 'utf8')).toBe('format: erdd-library\n')
    expect(err.join('')).toContain('삭제된 도메인을 가리키던 용어 1건')
  })

  it('import — 미리보기 후 확인을 받고, 미리보기의 해시를 실어 적용한다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords:\n  - { logicalName: 고객 }\n')
    const { client, calls } = stub({ onImport: (input) => ({
      libraryId: 'g1', applied: !input.dryRun, stateHash: 'h1', summary: SUMMARY({ add: 1 }),
    }) })
    const ctx: LibraryImportCtx = {
      ...base, cwd: dir, client, file: path, library: '표준', prune: false, includeStale: false, dryRun: false,
      confirm: async () => true,
    }
    expect(await libraryImport(ctx)).toBe(0)
    const imports = calls.filter((c) => c.path === 'resource.library.import').map((c) => c.input)
    expect(imports).toEqual([
      expect.objectContaining({ target: { libraryId: 'g1' }, dryRun: true }),
      expect.objectContaining({ target: { libraryId: 'g1' }, dryRun: false, expectedStateHash: 'h1' }),
    ])
    expect(out.join('')).toContain('추가 1')
  })

  it('import --yes — 미리보기 없이 해시 없이 한 번에 적용한다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords: []\n')
    const { client, calls } = stub({ onImport: () => ({ libraryId: 'g1', applied: true, stateHash: 'h', summary: SUMMARY({}) }) })
    await libraryImport({ ...base, yes: true, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: false })
    const imports = calls.filter((c) => c.path === 'resource.library.import').map((c) => c.input)
    expect(imports).toHaveLength(1)
    expect(imports[0]).not.toHaveProperty('expectedStateHash')
  })

  it('import — 파일 오류는 서버를 부르기 전에 위치와 함께 멈춘다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords:\n  - { logicalName: 고객, x: 1 }\n')
    const { client, calls } = stub()
    expect(await libraryImport({ ...base, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: false })).toBe(1)
    expect(err.join('')).toContain('words[0] (고객)')
    expect(calls.filter((c) => c.path === 'resource.library.import')).toEqual([])
  })

  it('import — --library 와 --create 는 정확히 하나, --create 에는 --scope 가 필요하다', async () => {
    const { client } = stub()
    const common = { ...base, cwd: dir, client, file: 'x.yaml', prune: false, includeStale: false, dryRun: false }
    expect(await libraryImport(common)).toBe(2)
    expect(await libraryImport({ ...common, library: 'a', create: 'b', scope: 'global' })).toBe(2)
    expect(await libraryImport({ ...common, create: 'b' })).toBe(2)
    expect(await libraryImport({ ...common, create: 'b', scope: 'org' })).toBe(2)   // --org 없음
  })

  it('import --dry-run — 미리보기만 하고 적용하지 않는다', async () => {
    const path = join(dir, 'a.erdd-lib.yaml')
    await writeFile(path, 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords: []\n')
    const { client, calls } = stub({ onImport: () => ({ libraryId: 'g1', applied: false, stateHash: 'h', summary: SUMMARY({ remove: 2 }) }) })
    expect(await libraryImport({ ...base, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: true })).toBe(0)
    expect(calls.filter((c) => c.path === 'resource.library.import')).toHaveLength(1)
    expect(out.join('')).toContain('--prune 이 없어 파일에 없는 2건은 남김')
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/commands/library.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현한다**

`packages/cli/src/xlsx.ts`

```ts
import { dictSheetsFromWorkbook, type RawSheet } from '@erdd/core'
import { CliError } from './output.js'

/** 노드에서 .xlsx 를 연다. 셀 해석은 웹과 같은 core `dictSheetsFromWorkbook` 이다. */
export async function readDictSheetsFile(path: string): Promise<RawSheet[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(path)
  } catch (err) {
    throw new CliError('VALIDATION', `Excel 파일을 읽지 못했습니다: ${path} — ${(err as Error).message}`)
  }
  try {
    return dictSheetsFromWorkbook(wb)
  } catch (err) {
    throw new CliError('VALIDATION', `${path}: ${(err as Error).message}`)
  }
}
```

`packages/cli/src/commands/library.ts`

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import {
  RESOURCE_KIND_LABEL, dictIssueText, formatLibraryFileIssues, libraryDocFromDictSheets, parseLibraryFile,
  resourceDisplayName, stringifyLibraryFile, type LibraryImportSummary,
} from '@erdd/core'
import { createClient, type ApiClient } from '../client.js'
import { readConfig, resolveToken } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { readDictSheetsFile } from '../xlsx.js'
import { run, type CommandCtx } from './context.js'
import { guardFeature, resolveLibrary, type LibraryRow } from './dict-shared.js'

export type LibraryCtx = CommandCtx & { server?: string }
type ListedLibrary = LibraryRow & { orgName: string | null }

/**
 * 라이브러리 관리 명령은 프로젝트 없이 돈다 — 관리자가 CI·빈 디렉터리에서 부른다. 서버 주소는
 * --server, 없으면 erdd.config.yaml 의 serverUrl. 토큰은 다른 명령과 같은 resolveToken 순서다.
 */
async function libraryClient(ctx: LibraryCtx): Promise<ApiClient> {
  if (ctx.client !== undefined) return ctx.client
  let serverUrl = ctx.server
  if (serverUrl === undefined) {
    try {
      serverUrl = (await readConfig(ctx.cwd)).serverUrl ?? undefined
    } catch (err) {
      if (!(err instanceof CliError && err.code === 'NO_CONFIG')) throw err
    }
  }
  if (serverUrl === undefined) {
    throw new CliError('USAGE', '서버 주소가 필요합니다 — --server <url> 을 주거나 서버에 연결된 프로젝트에서 실행하세요')
  }
  return createClient(serverUrl, await resolveToken(ctx.cwd))
}

async function listAll(client: ApiClient): Promise<ListedLibrary[]> {
  const globals = await guardFeature(() => client.query<LibraryRow[]>('resource.library.list', { scope: 'global' }))
  const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
  const rows: ListedLibrary[] = globals.map((r) => ({ ...r, orgName: null }))
  for (const org of orgs) {
    const libs = await guardFeature(() => client.query<LibraryRow[]>('resource.library.list', { scope: 'org', orgId: org.id }))
    rows.push(...libs.map((r) => ({ ...r, orgName: org.name })))
  }
  return rows
}

export function libraryList(ctx: LibraryCtx): Promise<number> {
  return run(ctx, async () => {
    const rows = await listAll(await libraryClient(ctx))
    const human = rows.length === 0 ? '볼 수 있는 라이브러리가 없습니다' : rows.map((r) =>
      `  ${r.name} — ${r.scope === 'global' ? '전역' : `조직 ${r.orgName}`} · 항목 ${r.itemCount}${r.canWrite ? ' · 쓰기 가능' : ''} · ${r.id}`,
    ).join('\n')
    emit(ctx.json, human, rows)
    return 0
  })
}

export function libraryExport(ctx: LibraryCtx & { ref: string | undefined; out?: string }): Promise<number> {
  return run(ctx, async () => {
    if (ctx.ref === undefined) throw new CliError('USAGE', '사용법: erdd library export <이름|id> [-o 파일]')
    const client = await libraryClient(ctx)
    const lib = resolveLibrary(await listAll(client), ctx.ref)
    const res = await guardFeature(() => client.query<{ libraryId: string; name: string; text: string; danglingDomainRefs: number }>(
      'resource.library.export', { libraryId: lib.id }))
    if (res.danglingDomainRefs > 0) note(`삭제된 도메인을 가리키던 용어 ${res.danglingDomainRefs}건은 도메인 없이 내보냈습니다`)
    if (ctx.out !== undefined) {
      await writeFile(resolve(ctx.cwd, ctx.out), res.text, 'utf8')
      emit(ctx.json, `내보냈습니다 — ${ctx.out}`, { libraryId: res.libraryId, file: ctx.out, danglingDomainRefs: res.danglingDomainRefs })
    } else if (ctx.json) {
      emit(true, '', res)
    } else {
      process.stdout.write(res.text)
    }
    return 0
  })
}

export type LibraryImportCtx = LibraryCtx & {
  file: string | undefined
  library?: string
  create?: string
  scope?: 'global' | 'org'
  org?: string
  prune: boolean
  includeStale: boolean
  dryRun: boolean
}
type ImportResponse = { libraryId: string | null; applied: boolean; stateHash: string; summary: LibraryImportSummary }

const num = (n: number): string => n.toLocaleString('en-US')

function render(title: string, s: LibraryImportSummary, opts: { prune: boolean; includeStale: boolean }): string {
  const c = s.counts
  const removable = c.remove - c.removeBlocked
  const deleted = opts.prune ? removable : 0
  const lines = [title]
  let summary = `  추가 ${num(c.add)} · 갱신 ${num(c.update + (opts.includeStale ? c.stale : 0))} · 그대로 ${num(c.unchanged)} · 삭제 ${num(deleted)}`
  if (!opts.prune && removable > 0) summary += ` (--prune 이 없어 파일에 없는 ${num(removable)}건은 남김)`
  lines.push(summary)
  const stale = s.entries.filter((e) => e.status === 'stale')
  if (stale.length > 0) {
    lines.push(`  오래된 파일 ${stale.length} — ${opts.includeStale ? '덮어씀' : '건너뜀 (--include-stale 로 덮어쓰기)'}:`)
    for (const e of stale) lines.push(`    ${RESOURCE_KIND_LABEL[e.kind]} ${e.name}  (서버 v${e.currentVersion}, 파일 v${e.fileVersion})`)
  }
  for (const w of s.warnings) lines.push(`  경고: ${w}`)
  return lines.join('\n')
}

async function readSourceText(ctx: LibraryImportCtx, client: ApiClient, libraryId: string | null): Promise<string> {
  const path = resolve(ctx.cwd, ctx.file!)
  if (extname(path).toLowerCase() === '.xlsx') {
    const sheets = await readDictSheetsFile(path)
    // 대상 라이브러리의 도메인 이름 — 용어의 「기본 도메인」이 파일에도 대상에도 없을 때만 경고하기 위해서다.
    const existing = libraryId === null ? [] : await client.query<{ kind: string; payload: Record<string, unknown> }[]>(
      'resource.items.list', { libraryId })
    const targetDomainNames = existing.filter((i) => i.kind === 'domain').map((i) => resourceDisplayName('domain', i.payload))
    const r = libraryDocFromDictSheets(sheets, { name: basename(path, extname(path)), targetDomainNames })
    if (!r.ok) {
      throw new CliError('VALIDATION', [`Excel 오류 ${r.issues.length}건 — 아무것도 반영하지 않았습니다`,
        ...r.issues.slice(0, 20).map((i) => `  ${dictIssueText(i)}`)].join('\n'))
    }
    for (const w of r.warnings) note(`경고: ${dictIssueText(w)}`)
    return stringifyLibraryFile(r.doc)
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new CliError('VALIDATION', `파일을 읽지 못했습니다: ${ctx.file} — ${(err as Error).message}`)
  }
  const parsed = parseLibraryFile(text, 'source')
  if (!parsed.ok) {
    throw new CliError('VALIDATION', [`라이브러리 파일 오류 ${parsed.issues.length}건 — 아무것도 반영하지 않았습니다`,
      ...formatLibraryFileIssues(parsed.issues).map((l) => `  ${l}`)].join('\n'))
  }
  return text
}

export function libraryImport(ctx: LibraryImportCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.file === undefined) throw new CliError('USAGE', '사용법: erdd library import <파일> (--library <이름|id> | --create <이름> --scope <global|org>)')
    if ((ctx.library === undefined) === (ctx.create === undefined)) {
      throw new CliError('USAGE', '--library 와 --create 중 정확히 하나를 주세요')
    }
    if (ctx.create !== undefined && ctx.scope === undefined) throw new CliError('USAGE', '--create 에는 --scope <global|org> 가 필요합니다')
    if (ctx.create !== undefined && ctx.scope === 'org' && ctx.org === undefined) throw new CliError('USAGE', '--scope org 에는 --org <이름|id> 가 필요합니다')

    const client = await libraryClient(ctx)
    let target: Record<string, unknown>
    let title: string
    let libraryId: string | null = null
    if (ctx.library !== undefined) {
      const lib = resolveLibrary(await listAll(client), ctx.library)
      if (!lib.canWrite) throw new CliError('FORBIDDEN', `${lib.name} 에 쓸 권한이 없습니다`)
      libraryId = lib.id
      target = { libraryId: lib.id }
      title = `${lib.name} (${lib.scope === 'global' ? '전역' : '조직'})`
    } else {
      let orgId: string | undefined
      if (ctx.scope === 'org') {
        const orgs = await client.query<{ id: string; name: string }[]>('org.list', {})
        const hit = orgs.find((o) => o.id === ctx.org) ?? orgs.filter((o) => o.name === ctx.org)
        if (Array.isArray(hit)) {
          if (hit.length !== 1) throw new CliError(hit.length === 0 ? 'NOT_FOUND' : 'USAGE', `조직 ${ctx.org}을(를) ${hit.length === 0 ? '찾지 못했습니다' : '하나로 고를 수 없습니다 — id 로 지정하세요'}`)
          orgId = hit[0]!.id
        } else orgId = hit.id
      }
      target = { create: { scope: ctx.scope, ...(orgId !== undefined ? { orgId } : {}), name: ctx.create, description: '' } }
      title = `${ctx.create} (${ctx.scope === 'global' ? '전역' : '조직'}, 새로 만듦)`
    }

    const text = await readSourceText(ctx, client, libraryId)
    const opts = { prune: ctx.prune, includeStale: ctx.includeStale }
    const call = (extra: Record<string, unknown>) => guardFeature(() => client.mutate<ImportResponse>(
      'resource.library.import', { target, text, ...opts, ...extra }))

    if (ctx.yes && !ctx.dryRun) {
      const res = await applyOrExplain(() => call({ dryRun: false }))
      emit(ctx.json, render(title, res.summary, opts), res)
      return 0
    }
    const preview = await call({ dryRun: true })
    if (ctx.dryRun) {
      emit(ctx.json, `${render(title, preview.summary, opts)}\n미리보기입니다 — 반영하지 않았습니다`, preview)
      return 0
    }
    note(render(title, preview.summary, opts))
    const ok = ctx.confirm !== undefined && await ctx.confirm('가져올까요?')
    if (!ok) throw new CliError('CANCELLED', '취소했습니다 — 아무것도 반영하지 않았습니다')
    const res = await applyOrExplain(() => call({ dryRun: false, expectedStateHash: preview.stateHash }))
    emit(ctx.json, `${render(title, res.summary, opts)}\n반영했습니다`, res)
    return 0
  })
}

/** 적용 실패는 전부 아니면 전무라서 「아무것도 반영하지 않았습니다」를 명시한다. */
async function applyOrExplain<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (err instanceof CliError) throw new CliError(err.code, `${err.message} — 아무것도 반영하지 않았습니다`, { ...err.details })
    throw err
  }
}
```

`packages/cli/src/main.ts`:
- import 에 `import { libraryExport, libraryImport, libraryList } from './commands/library.js'`
- `USAGE` 의 명령 목록에 `  library <list|export|import>  공용 라이브러리를 파일로 내보내고 가져온다(관리자)` 를, 옵션에 다음을 더하고 `--server` 설명을 `init·library 전용` 으로, `-o` 를 `export·library export 전용` 으로 바꾼다:
  ```
  --create <이름>        library import 전용 — 새 라이브러리를 만들며 가져온다(init --create 와 다르다)
  --scope <global|org>  library import --create 전용
  --prune               library import 전용 — 파일에 없는 항목을 지운다(적힌 종류만)
  --include-stale       library import 전용 — 서버가 더 새로운 항목도 파일 값으로 덮는다
  --file <경로>          dict pull 전용 — 서버에서 내보낸 라이브러리 파일에서 받는다(서버 연결 불필요)
  ```
  (`--library`·`--org`·`--dry-run` 설명에 `library import` 를 더한다.) ⚠️ `init` 의 `--create` 는 값 없는 플래그다 — `library` 분기 안에서만 `flagValue(argv, 'create')` 로 읽는다.
- `switch` 에 더한다:

```ts
    case 'library': {
      const sub = argv[1]?.startsWith('-') === true ? undefined : argv[1]
      if (argv.includes('--server') && flagValue(argv, 'server') === undefined) return usageError(json, '--server 값이 빠졌습니다')
      const server = flagValue(argv, 'server')
      if (sub === 'list') return libraryList({ ...ctx, server })
      // 위치 인자는 하위 명령 바로 뒤다. 거기 플래그가 오면 빠진 것이다.
      const positional = argv[2] !== undefined && !argv[2].startsWith('-') ? argv[2] : undefined
      if (sub === 'export') {
        let out: string | undefined
        if (argv.includes('-o')) {
          out = shortFlagValue(argv, 'o')
          if (out === undefined) return usageError(json, '-o 값이 올바르지 않습니다: (값 없음)')
        }
        return libraryExport({ ...ctx, server, ref: positional, out })
      }
      if (sub === 'import') {
        const scope = enumFlag<'global' | 'org'>(argv, 'scope', ['global', 'org'] as const)
        if (!scope.ok) return usageError(json, scope.message)
        for (const name of ['library', 'create', 'org']) {
          if (argv.includes(`--${name}`) && flagValue(argv, name) === undefined) return usageError(json, `--${name} 값이 빠졌습니다`)
        }
        return libraryImport({
          ...ctx, server, file: positional, library: flagValue(argv, 'library'), create: flagValue(argv, 'create'),
          scope: scope.value, org: flagValue(argv, 'org'), prune: argv.includes('--prune'),
          includeStale: argv.includes('--include-stale'), dryRun: argv.includes('--dry-run'),
        })
      }
      return usageError(json, `알 수 없는 library 하위 명령: ${sub ?? '(없음)'} — list | export | import`)
    }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/commands/library.test.ts src/main.test.ts`
Expected: PASS

- [ ] **Step 6: Excel 끝단 한 건을 테스트에 더한다** — `library.test.ts` 에:

```ts
  it('import .xlsx — Excel 을 원천 파일로 바꿔 보낸다(커스텀 항목 키 없음)', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('단어사전')
    ws.addRow(['논리명', '약어']); ws.addRow(['고객', 'CUST'])
    const path = join(dir, '표준.xlsx')
    await wb.xlsx.writeFile(path)
    const { client, calls } = stub({ onImport: () => ({ libraryId: 'g1', applied: true, stateHash: 'h', summary: SUMMARY({ add: 1 }) }) })
    await libraryImport({ ...base, yes: true, cwd: dir, client, file: path, library: 'g1', prune: false, includeStale: false, dryRun: false })
    const sent = calls.find((c) => c.path === 'resource.library.import')!.input.text as string
    expect(sent).toContain('logicalName: 고객')
    expect(sent).not.toContain('customFields')
  })
```
Run 다시 → PASS

- [ ] **Step 7: 타입 검사** — `pnpm -s -r typecheck; echo "exit=$?"` → `exit=0`

- [ ] **Step 8: 커밋**

```bash
git add packages/cli/src/xlsx.ts packages/cli/src/commands/library.ts packages/cli/src/commands/library.test.ts packages/cli/src/main.ts packages/cli/package.json pnpm-lock.yaml && git commit -m "feat(cli): erdd library list·export·import — 프로젝트 없이, Excel 입력 포함

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 9: 구분력 실증(커밋 뒤)** — 확인 후 적용 호출에서 `expectedStateHash: preview.stateHash` 를 빼면 「미리보기 후 확인을 받고…」가 실패하는지 본다.

---

### Task 7: CLI 파일 구독 — `dict pull --file`, `dict list`, `dict push`

**Files:**
- Create: `packages/cli/src/commands/dict-file.ts`, `packages/cli/src/commands/dict-file.test.ts`
- Modify: `packages/cli/src/config.ts`, `packages/cli/src/config.test.ts`
- Modify: `packages/cli/src/commands/dict-pull.ts`, `dict-pull.test.ts`, `dict-list.ts`, `dict-push.ts`, `dict-push.test.ts`, `packages/cli/src/main.ts`

**Interfaces:**
- Consumes: `parseLibraryFile`, `formatLibraryFileIssues`, `libraryItemsOf`, `LibraryFileDoc`, `TREE_ROOT` (core), 기존 `planResync`·`decide`·`report`·`applyResyncPlan` 흐름
- Produces:
  ```ts
  // config.ts
  export type DictionaryRef = { id: string; name: string; file?: string }
  // dict-file.ts
  export function subscriptionPath(cwd: string, raw: string): string   // 프로젝트 루트 기준 POSIX 상대 경로
  export async function readDistributionFile(cwd: string, path: string): Promise<LibraryFileDoc>
  // dict-pull.ts
  export type DictPullCtx = CommandCtx & { library?: string; file?: string; adopt: boolean; conflicts?: 'theirs' | 'ours'; dryRun: boolean }
  // LibraryReport 에 file: string | null, missingReason: 'not-found' | 'not-connected' | null 추가
  ```

**규칙(spec 3.2 + 보정):**
- `--file` 은 서버 연결을 요구하지 않는다. `--file` 과 `--library` 는 함께 못 쓴다(`2`).
- `--file` 은 파일의 `library.id` 로 구독 줄을 **upsert** 한다 — 같은 id 의 서버 구독 줄이 있으면 그 줄에 `file` 을 붙인다(명시적 전환).
- 인자 없는 pull: `file` 이 있는 줄은 파일에서, 없는 줄은 서버에서. 로컬 전용이면 서버 줄은 「서버에 연결되지 않아 건너뜀」(멈추지 않는다). **구독 id ≠ 파일 id 면 VALIDATION(`1`)** — 다른 라이브러리 파일로 갈아 끼웠다.
- 구독의 표시 이름은 서버 목록/파일의 `library.name` 을 따르되 **`file` 을 보존한다.**
- `dict push --library X` 에서 X 가 파일 구독이면 USAGE(`2`) 「파일에서 받은 사전은 올릴 수 없습니다 — 서버에 연결된 뒤 구독의 file 을 지우세요」. (`dict push` 는 `--library` 필수라 「인자 없는 push 는 파일 구독을 건너뛴다」는 해당 없음 — spec 의 그 문장은 계획에서 뺀다.)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`config.test.ts` 에:

```ts
  it('dictionaries[].file 을 읽고 다시 쓸 때 보존한다', async () => {
    await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], dictionaries: [{ id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' }, { id: 'L2', name: '팀' }] })
    const config = await readConfig(dir)
    expect(config.dictionaries).toEqual([{ id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' }, { id: 'L2', name: '팀' }])
    await writeConfig(dir, config)
    expect((await readConfig(dir)).dictionaries[0]).toHaveProperty('file', 'vendor/std.erdd-lib.yaml')
  })

  it('dictionaries[].file 이 문자열이 아니면 거절한다', async () => {
    await writeFile(join(dir, 'erdd.config.yaml'), stringifyYaml({ ...TEST_CONFIG, dictionaries: [{ id: 'L1', name: 'x', file: 3 }] }))
    await expect(readConfig(dir)).rejects.toThrow(/dictionaries/)
  })
```
(`config.test.ts` 의 기존 import·`dir` 준비 방식을 따른다 — 없으면 `mkdtemp` 로 만든다.)

`dict-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDistributionFile, subscriptionPath } from './dict-file.js'

describe('subscriptionPath', () => {
  const cwd = '/work/proj'
  it('프로젝트 루트 기준 POSIX 상대 경로로 정규화한다', () => {
    expect(subscriptionPath(cwd, './vendor/../vendor/std.erdd-lib.yaml')).toBe('vendor/std.erdd-lib.yaml')
    expect(subscriptionPath(cwd, '/work/proj/lib/a.yaml')).toBe('lib/a.yaml')
  })
  it('erdd/ 안과 루트 밖을 거부한다', () => {
    expect(() => subscriptionPath(cwd, 'erdd/std.erdd-lib.yaml')).toThrow(/erdd\//)
    expect(() => subscriptionPath(cwd, '../other/std.erdd-lib.yaml')).toThrow(/프로젝트 안/)
    expect(() => subscriptionPath(cwd, '/tmp/std.erdd-lib.yaml')).toThrow(/프로젝트 안/)
  })
  it('..로 시작하는 이름의 디렉터리는 루트 밖이 아니다', () => {
    expect(subscriptionPath(cwd, '..vendor/a.yaml')).toBe('..vendor/a.yaml')
  })
})

describe('readDistributionFile', () => {
  it('배포 파일이 아니면 서버에서 내보낸 파일만 받는다고 멈춘다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-dict-file-'))
    await mkdir(join(dir, 'vendor'))
    await writeFile(join(dir, 'vendor/a.yaml'), 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords: []\n')
    await expect(readDistributionFile(dir, 'vendor/a.yaml')).rejects.toThrow(/서버에서 내보낸 파일만/)
  })
  it('없는 파일은 경로를 담아 멈춘다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-dict-file-'))
    await expect(readDistributionFile(dir, 'vendor/none.yaml')).rejects.toThrow(/vendor\/none.yaml/)
  })
})
```

`dict-pull.test.ts` 에 `describe('dict pull --file', …)` 를 더한다. 픽스처는 core `exportLibraryFile` 로 만든다:

```ts
import { exportLibraryFile } from '@erdd/core'

const LOCAL_CONFIG = { ...TEST_CONFIG, serverUrl: null, projectId: null }
const writeLib = async (items: LibraryItem[], id = 'L1', name = '표준') => {
  await mkdir(join(dir, 'vendor'), { recursive: true })
  await writeFile(join(dir, 'vendor/std.erdd-lib.yaml'), exportLibraryFile({ id, name, description: '' }, items).text)
}
const noServer: ApiClient = {
  query: (async (path: string) => { throw new Error(`서버를 부르면 안 된다: ${path}`) }) as ApiClient['query'],
  mutate: (async (path: string) => { throw new Error(`서버를 부르면 안 된다: ${path}`) }) as ApiClient['mutate'],
}

describe('dict pull --file', () => {
  beforeEach(async () => {
    await writeConfig(dir, { ...LOCAL_CONFIG, dialects: [...LOCAL_CONFIG.dialects], dictionaries: [] })
    await seed(createEmptyModel())
  })

  it('로컬 전용 프로젝트에서 배포 파일을 받아 출처를 남기고 구독에 file 을 적는다', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    expect(await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))).toBe(0)
    expect(await origins()).toEqual([expect.objectContaining({ library: 'L1', item: 'S1', version: 1 })])
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' }])
  })

  it('개정 파일을 다시 받으면 3-way 재동기화한다(자동 갱신)', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))
    await writeLib([word('S1', 2, 'CSTMR')])
    await dictPull(ctx(noServer))
    expect(JSON.parse(out.at(-1)!).libraries[0]).toMatchObject({ autoUpdated: 1, file: 'vendor/std.erdd-lib.yaml' })
    const words = ((await readTree(dir))['erdd/words.yaml'] as { words: { abbreviation: string }[] }).words
    expect(words.map((w) => w.abbreviation)).toEqual(['CSTMR'])
  })

  it('구독 id 와 파일의 library.id 가 다르면 멈춘다', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))
    await writeLib([word('S9', 1, 'X')], 'OTHER')
    expect(await dictPull(ctx(noServer))).toBe(1)
    expect(out.join('')).toContain('다른 라이브러리')
  })

  it('로컬 전용이면 서버 구독 줄은 건너뛰고 파일 줄은 받는다', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    await writeConfig(dir, { ...LOCAL_CONFIG, dialects: [...LOCAL_CONFIG.dialects], dictionaries: [
      { id: 'SRV', name: '서버표준' }, { id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' },
    ] })
    expect(await dictPull(ctx(noServer))).toBe(0)
    const reports = JSON.parse(out.at(-1)!).libraries
    expect(reports[0]).toMatchObject({ id: 'SRV', missing: true, missingReason: 'not-connected' })
    expect(reports[1]).toMatchObject({ id: 'L1', added: 1 })
  })

  it('--file 과 --library 는 함께 못 쓴다', async () => {
    expect(await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml', library: 'L1' }))).toBe(2)
  })

  it('파일 구독에서 서버 구독으로 이어가면 추가 0 · 유지 N 이다', async () => {
    const items = [word('S1', 1, 'CUST')]
    await writeLib(items)
    await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))
    // 서버에 붙은 뒤 구독 줄의 file 을 지웠다
    await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], dictionaries: [{ id: 'L1', name: '표준' }] })
    await dictPull(ctx(client([{ ...LIB, id: 'L1' }], { L1: items })))
    expect(JSON.parse(out.at(-1)!).libraries[0]).toMatchObject({ added: 0, autoUpdated: 0, kept: 1 })
  })
})
```

`dict-push.test.ts` 의 `describe('dict push')` 안에(파일의 `seed`·`client`·`ctx`·`serverModel` 픽스처를 그대로 쓴다):

```ts
  it('파일 구독 라이브러리는 올릴 수 없다 — 서버에 쓰기 전에 멈춘다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects],
      dictionaries: [{ id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' }],
    })
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(2)
    expect(JSON.parse(out.join('')).error.message).toContain('파일에서 받은 사전은 올릴 수 없습니다')
    expect(calls).toEqual([])
  })

  it('승격 뒤 syncDown 이 config 를 다시 써도 파일 구독의 file 이 남는다', async () => {
    await writeConfig(dir, {
      ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects],
      dictionaries: [{ id: 'L1', name: '표준' }, { id: 'L9', name: '파일표준', file: 'vendor/std.erdd-lib.yaml' }],
    })
    await seed(serverModel())
    const { client: c } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(0)
    expect((await readConfig(dir)).dictionaries[1]).toEqual({ id: 'L9', name: '파일표준', file: 'vendor/std.erdd-lib.yaml' })
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run src/config.test.ts src/commands/dict-file.test.ts src/commands/dict-pull.test.ts src/commands/dict-push.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다**

`config.ts`:
```ts
/** `file` 이 있으면 그 배포 파일에서 받는다(프로젝트 루트 기준 POSIX 상대 경로 — `erdd dict pull --file`). */
export type DictionaryRef = { id: string; name: string; file?: string }
```
`readConfig` 의 검증·매핑을 바꾼다(`file` 을 떨어뜨리면 다음 pull 이 조용히 서버로 간다):
```ts
  if (rawDicts != null && (!Array.isArray(rawDicts) || !rawDicts.every(
    (d) => isRec(d) && typeof d['id'] === 'string' && typeof d['name'] === 'string'
      && (d['file'] === undefined || typeof d['file'] === 'string')))) {
    throw new CliError('VALIDATION', `${CONFIG_FILE}의 dictionaries는 {id, name, file?} 목록이어야 합니다`)
  }
  const dictionaries = ((rawDicts ?? []) as DictionaryRef[]).map((d) =>
    (d.file === undefined ? { id: d.id, name: d.name } : { id: d.id, name: d.name, file: d.file }))
```
(오류 문구가 바뀌므로 `config.test.ts` 의 기존 단언이 `{id, name}` 을 기대하면 함께 고친다.)

`dict-file.ts`:
```ts
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TREE_ROOT, formatLibraryFileIssues, parseLibraryFile, type LibraryFileDoc } from '@erdd/core'
import { CliError } from '../output.js'

/**
 * 구독에 적을 사전 파일 경로. 커밋되는 config 가 가리키므로 프로젝트 안이어야 하고(다른 체크아웃에서도
 * 같은 파일), `erdd/` 는 모델 파일 트리라 둘 수 없다.
 */
export function subscriptionPath(cwd: string, raw: string): string {
  const rel = relative(cwd, resolve(cwd, raw))
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CliError('USAGE', `사전 파일은 프로젝트 안에 두세요: ${raw} — erdd.config.yaml 이 다른 체크아웃에서도 같은 파일을 가리켜야 합니다`)
  }
  const posix = rel.split(sep).join('/')
  if (posix === TREE_ROOT || posix.startsWith(`${TREE_ROOT}/`)) {
    throw new CliError('USAGE', `사전 파일을 ${TREE_ROOT}/ 안에 둘 수 없습니다: ${posix} — 그 디렉터리는 모델 파일 트리입니다`)
  }
  return posix
}

export async function readDistributionFile(cwd: string, path: string): Promise<LibraryFileDoc> {
  let text: string
  try {
    text = await readFile(join(cwd, path), 'utf8')
  } catch (err) {
    throw new CliError('VALIDATION', `사전 파일을 읽지 못했습니다: ${path} — ${(err as Error).message}`)
  }
  const parsed = parseLibraryFile(text, 'distribution')
  if (!parsed.ok) {
    throw new CliError('VALIDATION', [
      `${path}: 서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) — 오류 ${parsed.issues.length}건`,
      ...formatLibraryFileIssues(parsed.issues).map((l) => `  ${l}`),
    ].join('\n'))
  }
  return parsed.doc
}
```

`dict-pull.ts` — `DictPullCtx` 에 `file?: string` 를 더하고, `LibraryReport` 에 `file: string | null` 과 `missingReason: 'not-found' | 'not-connected' | null` 을 더한다(`report()` 는 `file`·`missingReason: null` 을 채우도록 인자를 받는다 — `report(lib: { id: string; name: string; scope: LibraryRow['scope'] | null }, …, file: string | null)`). `render()` 는:
```ts
    if (r.missing) {
      lines.push(r.missingReason === 'not-connected'
        ? `${r.name} — 서버에 연결되지 않아 건너뛰었습니다`
        : `${r.name} — 찾을 수 없어 건너뛰었습니다`)
      continue
    }
    lines.push(`${r.name} (${r.file !== null ? `파일 ${r.file}` : r.scope === 'global' ? '전역' : '조직'})`)
```
`dictPull` 본문을 이렇게 바꾼다:
```ts
export function dictPull(ctx: DictPullCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.file !== undefined && ctx.library !== undefined) {
      throw new CliError('USAGE', '--file 과 --library 는 함께 쓸 수 없습니다')
    }
    const config = await readConfig(ctx.cwd)
    // --library 는 서버에서 고르는 것이라 연결이 필요하다. --file 과 인자 없는 pull 은 줄마다 판단한다.
    if (ctx.library !== undefined) requireDictConnection(config)
    const connected = config.serverUrl !== null && config.projectId !== null
    if (await hasDraft(ctx.cwd)) note(UNSAVED_NOTICE)
    const { tree, model: initial } = await readLocalModel(ctx.cwd)

    let subscriptions: DictionaryRef[] = config.dictionaries
    const docs = new Map<string, LibraryFileDoc>()   // 구독 id → 읽은 배포 파일
    let targets: DictionaryRef[]
    if (ctx.file !== undefined) {
      const path = subscriptionPath(ctx.cwd, ctx.file)
      const doc = await readDistributionFile(ctx.cwd, path)
      const ref: DictionaryRef = { id: doc.library.id!, name: doc.library.name, file: path }
      docs.set(ref.id, doc)
      // 같은 라이브러리의 구독 줄이 있으면 그 줄을 파일 구독으로 바꾼다(명시적 전환) — 같은 id 두 줄은 config 가 거절한다.
      subscriptions = subscriptions.some((s) => s.id === ref.id)
        ? subscriptions.map((s) => (s.id === ref.id ? ref : s))
        : [...subscriptions, ref]
      targets = [ref]
    } else if (ctx.library !== undefined) {
      targets = []   // 아래에서 서버 목록으로 채운다
    } else {
      if (subscriptions.length === 0) {
        throw new CliError('USAGE', '구독한 라이브러리가 없습니다 — --library <이름|id> 또는 --file <경로> 로 지정하세요 (목록: erdd dict list)')
      }
      targets = subscriptions
    }

    const needsServer = ctx.library !== undefined || targets.some((t) => t.file === undefined)
    const client = needsServer && connected ? await clientFor(ctx) : null
    const libraries = client !== null ? await listLibraries(client, config.projectId!) : []
    if (ctx.library !== undefined) {
      const lib = resolveLibrary(libraries, ctx.library)
      if (!subscriptions.some((s) => s.id === lib.id)) subscriptions = [...subscriptions, { id: lib.id, name: lib.name }]
      targets = [{ id: lib.id, name: lib.name }]
    }

    let model = initial
    const reports: LibraryReport[] = []
    for (const target of targets) {
      if (target.file !== undefined) {
        const doc = docs.get(target.id) ?? await readDistributionFile(ctx.cwd, target.file)
        if (doc.library.id !== target.id) {
          throw new CliError('VALIDATION',
            `구독 ${target.name}(${target.id}) 의 파일 ${target.file} 은 다른 라이브러리(${doc.library.id})입니다 — 다른 라이브러리로 바꾸려면 구독 줄을 지우고 --file 로 다시 받으세요`)
        }
        docs.set(target.id, doc)
        const plan = planResync(model, target.id, libraryItemsOf(doc))
        const { decisions, linkable, differs } = decide(model, plan, ctx)
        reports.push(report({ id: target.id, name: doc.library.name, scope: null }, plan, decisions, linkable, differs, target.file))
        model = applyResyncPlan(model, plan, decisions, uuidv7)
        continue
      }
      const lib = client === null ? undefined : libraries.find((l) => l.id === target.id)
      if (lib === undefined) {
        const reason = client === null ? 'not-connected' : 'not-found'
        if (reason === 'not-found') note(`경고: 라이브러리 ${target.name}(${target.id})을(를) 찾을 수 없어 건너뜁니다 — 삭제됐거나 권한이 없습니다`)
        reports.push({
          id: target.id, name: target.name, scope: null, file: null, missing: true, missingReason: reason,
          added: 0, autoUpdated: 0, adopted: 0, nameClashSkipped: [], adoptDiffers: [], unlinkable: [], conflicts: [], kept: 0, detached: 0,
        })
        continue
      }
      const plan = planResync(model, lib.id, await fetchItems(client!, lib.id))
      const { decisions, linkable, differs } = decide(model, plan, ctx)
      reports.push(report(lib, plan, decisions, linkable, differs, null))
      model = applyResyncPlan(model, plan, decisions, uuidv7)
    }

    // 표시 이름은 원본(서버 목록·파일)을 따른다. file 은 보존한다 — 떨어뜨리면 다음 pull 이 서버로 간다.
    subscriptions = subscriptions.map((s) => {
      const name = s.file !== undefined ? docs.get(s.id)?.library.name : libraries.find((l) => l.id === s.id)?.name
      return name === undefined ? s : { ...s, name }
    })

    let files = { written: [] as string[], deleted: [] as string[] }
    if (!ctx.dryRun) {
      files = await writeDictionaryFiles(ctx.cwd, tree, modelToFiles(model).tree)
      if (JSON.stringify(subscriptions) !== JSON.stringify(config.dictionaries)) {
        await writeConfig(ctx.cwd, { ...config, dictionaries: subscriptions })
      }
    }
    emit(ctx.json, render(reports, files, ctx.dryRun), { libraries: reports, ...files, dryRun: ctx.dryRun })
    return 0
  })
}
```
(import 에 `libraryItemsOf`, `type LibraryFileDoc` 와 `readDistributionFile`, `subscriptionPath` 를 더한다.)

`dict-list.ts` — 로컬 전용이면 파일 구독만, 연결됐으면 서버 목록 뒤에 파일 구독을 덧붙인다:
```ts
export function dictList(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const connected = config.serverUrl !== null && config.projectId !== null
    const fileSubs = config.dictionaries.filter((d) => d.file !== undefined)
    if (!connected && fileSubs.length === 0) requireDictConnection(config)   // 기존 문구로 멈춘다
    const rows = connected ? await listLibraries(await clientFor(ctx), config.projectId!) : []
    const subscribed = new Set(config.dictionaries.filter((d) => d.file === undefined).map((d) => d.id))
    const lines = rows.map((r) => [
      subscribed.has(r.id) ? '*' : ' ', r.name,
      `— ${r.scope === 'global' ? '전역' : '조직'} · 항목 ${r.itemCount}${r.canWrite ? ' · 쓰기 가능' : ''} · ${r.id}`,
    ].join(' '))
    const fileRows = []
    for (const d of fileSubs) {
      try {
        const doc = await readDistributionFile(ctx.cwd, d.file!)
        const count = libraryItemsOf(doc).length
        lines.push(`* ${doc.library.name} — 파일 · 항목 ${count} · 읽기 전용 · ${d.file}`)
        fileRows.push({ id: d.id, name: doc.library.name, source: 'file', file: d.file, itemCount: count, subscribed: true, error: null })
      } catch (err) {
        lines.push(`* ${d.name} — 파일 · 읽지 못함(${(err as Error).message.split('\n')[0]}) · ${d.file}`)
        fileRows.push({ id: d.id, name: d.name, source: 'file', file: d.file, itemCount: null, subscribed: true, error: (err as Error).message })
      }
    }
    const human = lines.length === 0 ? '이 프로젝트에서 보이는 라이브러리가 없습니다' : lines.join('\n')
    emit(ctx.json, human, [
      ...rows.map((r) => ({ ...r, source: 'server', subscribed: subscribed.has(r.id) })), ...fileRows,
    ])
    return 0
  })
}
```

`dict-push.ts` — 라이브러리를 고른 직후(`const lib = resolveLibrary(…)` 다음 줄):
```ts
    if (config.dictionaries.some((d) => d.id === lib.id && d.file !== undefined)) {
      throw new CliError('USAGE', '파일에서 받은 사전은 올릴 수 없습니다 — 서버에 연결된 뒤 구독의 file 을 지우세요')
    }
```
(`config` 가 그 자리에서 보이지 않으면 `readConfig` 결과를 쓰는 변수명을 따른다.)

`main.ts` 의 `dict pull` 배차에 `--file` 을 더한다:
```ts
        if (argv.includes('--file') && flagValue(argv, 'file') === undefined) {
          return usageError(json, '--file 값이 올바르지 않습니다: (값 없음)')
        }
        return dictPull({
          ...ctx, library: flagValue(argv, 'library'), file: flagValue(argv, 'file'), adopt: argv.includes('--adopt'),
          conflicts: conflicts.value, dryRun: argv.includes('--dry-run'),
        })
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/cli exec vitest run`
Expected: PASS (기존 dict 테스트 포함 전부 — `render` 문구·JSON 에 필드가 늘어 기존 단언이 깨지면 **기존 동작이 바뀐 것인지** 보고 판단을 받는다)

- [ ] **Step 5: 타입 검사** — `pnpm -s -r typecheck; echo "exit=$?"` → `exit=0`

- [ ] **Step 6: 커밋**

```bash
git add packages/cli/src/config.ts packages/cli/src/config.test.ts packages/cli/src/commands/dict-file.ts packages/cli/src/commands/dict-file.test.ts packages/cli/src/commands/dict-pull.ts packages/cli/src/commands/dict-pull.test.ts packages/cli/src/commands/dict-list.ts packages/cli/src/commands/dict-push.ts packages/cli/src/commands/dict-push.test.ts packages/cli/src/main.ts && git commit -m "feat(cli): dict pull --file — 서버 없는 프로젝트가 배포 파일로 공용 사전을 받는다

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — (a) `readConfig` 매핑을 옛 `({ id: d.id, name: d.name })` 로 되돌리면 `file` 보존 테스트가, (b) 구독 이름 갱신의 `{ ...s, name }` 을 `{ id: s.id, name }` 으로 바꾸면 「개정 파일을 다시 받으면…」(두 번째 pull 이 서버로 감)이, (c) id 불일치 가드를 지우면 해당 테스트가 실패하는지 본다.

---

### Task 8: 웹 — 내보내기·가져오기·파일에서 만들기

**Files:**
- Create: `apps/web/src/components/library-import-dialog.tsx`, `apps/web/src/components/library-import-dialog.test.tsx`
- Modify: `apps/web/src/components/resource-library-manager.tsx`, `resource-library-manager.test.tsx`

**Interfaces:**
- Consumes: tRPC `resource.library.export`(query)·`resource.library.import`(mutation)·`resource.items.list`; core `parseLibraryFile`·`formatLibraryFileIssues`·`libraryDocFromDictSheets`·`dictIssueText`·`stringifyLibraryFile`·`LIBRARY_FILE_EXTENSION`·`RESOURCE_KIND_LABEL`·`resourceDisplayName`·`LibraryImportSummary`; 웹 `readDictSheets`
- Produces:
  ```ts
  export type LibraryImportTarget =
    | { kind: 'existing'; libraryId: string; name: string }
    | { kind: 'create'; scope: 'global' | 'org'; orgId?: string }
  export function LibraryImportDialog(props: { target: LibraryImportTarget; onClose: () => void; onDone: () => void }): JSX.Element
  ```

**화면 문구(spec 4절 그대로):** 제목 「라이브러리 가져오기 — 〈이름〉」 / 「파일에서 만들기」, 「파일 선택」, 구역 「추가」·「갱신」·「그대로」·「오래된 파일」·「파일에 없음」, 체크박스 「파일에 없는 항목 N건 삭제」(켜면 「이미 가져간 프로젝트의 사본은 그대로 남습니다」)·「오래된 파일 항목 N건 덮어쓰기」(켜면 「서버의 더 새 값을 파일의 옛 값으로 되돌립니다」), 버튼 「가져오기 실행」, 0건 「파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다」, 409 「미리보기 이후 라이브러리가 바뀌었습니다」 + 「다시 미리보기」, 성공 토스트 「추가 N · 갱신 N · 삭제 N」, 내보내기 토스트 「삭제된 도메인을 가리키던 용어 N건은 도메인 없이 내보냈습니다」.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `library-import-dialog.test.tsx`

```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { LibraryImportDialog } from './library-import-dialog.js'

const FILE = 'format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\nwords:\n  - { logicalName: 고객, abbreviation: CSTMR }\n'
const summary = (counts: Record<string, number>, entries: unknown[] = []) => ({
  counts: { add: 0, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0, ...counts }, warnings: [], entries,
})

function renderDialog(handlers: Parameters<typeof mockTrpcFetch>[0], onDone = vi.fn()) {
  mockTrpcFetch({ 'resource.items.list': () => ({ data: [] }), ...handlers })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <LibraryImportDialog target={{ kind: 'existing', libraryId: 'l1', name: '표준' }} onClose={() => {}} onDone={onDone} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return onDone
}
const pick = async (text = FILE, name = 'std.erdd-lib.yaml') =>
  userEvent.upload(screen.getByLabelText('파일 선택'), new File([text], name))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('LibraryImportDialog', () => {
  it('형식 오류는 서버를 부르지 않고 위치와 함께 보인다', async () => {
    const importFn = vi.fn()
    renderDialog({ 'resource.library.import': importFn })
    await pick(FILE.replace('abbreviation', 'abbrevation'))
    expect(await screen.findByText(/words\[0\] \(고객\)/)).toBeDefined()
    expect(importFn).not.toHaveBeenCalled()
  })

  it('두 체크박스는 기본 해제이고, 미리보기 해시를 실어 적용한다', async () => {
    const calls: Record<string, unknown>[] = []
    const onDone = renderDialog({ 'resource.library.import': (input) => {
      calls.push(input as Record<string, unknown>)
      return { data: { libraryId: 'l1', applied: !(input as { dryRun: boolean }).dryRun, stateHash: 'h1', summary: summary(
        { update: 1, remove: 2, stale: 1 },
        [{ status: 'update', kind: 'word', name: '고객', currentVersion: 1, fileVersion: null, referencedBy: 0, changes: [{ field: 'abbreviation', from: 'CUST', to: 'CSTMR' }] }],
      ) } }
    } })
    await pick()
    const prune = await screen.findByRole('checkbox', { name: /파일에 없는 항목 2건 삭제/ })
    const stale = screen.getByRole('checkbox', { name: /오래된 파일 항목 1건 덮어쓰기/ })
    expect((prune as HTMLInputElement).checked).toBe(false)
    expect((stale as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/CUST → CSTMR/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: '가져오기 실행' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(calls.at(-1)).toMatchObject({ dryRun: false, prune: false, includeStale: false, expectedStateHash: 'h1' })
  })

  it('바뀔 것이 0건이면 실행 버튼이 잠기고 안내가 보인다', async () => {
    renderDialog({ 'resource.library.import': () => ({ data: { libraryId: 'l1', applied: false, stateHash: 'h', summary: summary({ unchanged: 3 }) } }) })
    await pick()
    expect(await screen.findByText('파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다')).toBeDefined()
    expect((screen.getByRole('button', { name: '가져오기 실행' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('409 면 다시 미리보기를 권한다', async () => {
    let n = 0
    renderDialog({ 'resource.library.import': () => (++n === 1
      ? { data: { libraryId: 'l1', applied: false, stateHash: 'h', summary: summary({ add: 1 }) } }
      : { error: { code: -32009, message: '미리보기 이후 라이브러리가 바뀌었습니다 — 다시 미리보기 하세요' } }) })
    await pick()
    await userEvent.click(await screen.findByRole('button', { name: '가져오기 실행' }))
    expect(await screen.findByRole('button', { name: '다시 미리보기' })).toBeDefined()
  })
})
```

`resource-library-manager.test.tsx` 에:

```tsx
  it('쓰기 권한이 없어도 내보내기 버튼이 보이고, 가져오기·파일에서 만들기는 관리자에게만 보인다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) }, { canManage: false })
    expect(await screen.findByRole('button', { name: '표준 사전(예시) 내보내기' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '표준 사전(예시) 가져오기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /파일에서 만들기/ })).toBeNull()
  })
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/library-import-dialog.test.tsx src/components/resource-library-manager.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현한다** — `apps/web/src/components/library-import-dialog.tsx`

```tsx
import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  RESOURCE_KIND_LABEL, dictIssueText, formatLibraryFileIssues, libraryDocFromDictSheets, parseLibraryFile,
  resourceDisplayName, stringifyLibraryFile, type LibraryImportSummary,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { readDictSheets } from '@/editor/excel-file'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type LibraryImportTarget =
  | { kind: 'existing'; libraryId: string; name: string }
  | { kind: 'create'; scope: 'global' | 'org'; orgId?: string }

type Preview = { stateHash: string; summary: LibraryImportSummary }
const SHOWN = 50
const text = (v: unknown): string => (v === null || v === undefined ? '(없음)' : typeof v === 'string' ? v : JSON.stringify(v))

/**
 * 라이브러리 파일·Excel 가져오기. 파싱은 브라우저에서 먼저 해 형식 오류를 서버에 가기 전에 보이고,
 * 계획은 서버의 dryRun 이 계산한다(guides/shared-resources.md 「파일 내보내기·가져오기」).
 * 체크박스는 적용 요청에만 실린다 — dryRun 은 두 플래그와 무관하게 전체 분류를 돌려준다.
 */
export function LibraryImportDialog({ target, onClose, onDone }: {
  target: LibraryImportTarget; onClose: () => void; onDone: () => void
}) {
  const trpc = useTRPC()
  const existingItems = useQuery({
    ...trpc.resource.items.list.queryOptions({ libraryId: target.kind === 'existing' ? target.libraryId : '' }),
    enabled: target.kind === 'existing',
  })
  const importLibrary = useMutation(trpc.resource.library.import.mutationOptions())
  const [fileText, setFileText] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [conflict, setConflict] = useState(false)
  const [prune, setPrune] = useState(false)
  const [includeStale, setIncludeStale] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const targetInput = (): Parameters<typeof importLibrary.mutateAsync>[0]['target'] =>
    target.kind === 'existing'
      ? { libraryId: target.libraryId }
      : { create: { scope: target.scope, ...(target.orgId ? { orgId: target.orgId } : {}), name: name.trim() || '가져온 라이브러리', description } }

  const runPreview = async (t: string) => {
    setConflict(false)
    try {
      const res = await importLibrary.mutateAsync({ target: targetInput(), text: t, dryRun: true })
      setPreview({ stateHash: res.stateHash, summary: res.summary })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '미리보기를 만들지 못했습니다')
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setPreview(null); setIssues([]); setFileText(null)
    try {
      let t: string
      if (file.name.toLowerCase().endsWith('.xlsx')) {
        const domainNames = (existingItems.data ?? []).filter((i) => i.kind === 'domain')
          .map((i) => resourceDisplayName('domain', i.payload as Record<string, unknown>))
        const r = libraryDocFromDictSheets(await readDictSheets(file), { name: file.name.replace(/\.xlsx$/i, ''), targetDomainNames: domainNames })
        if (!r.ok) { setIssues(r.issues.slice(0, 20).map(dictIssueText)); return }
        t = stringifyLibraryFile(r.doc)
      } else {
        t = await file.text()
        const parsed = parseLibraryFile(t, 'source')
        if (!parsed.ok) { setIssues(formatLibraryFileIssues(parsed.issues)); return }
        if (target.kind === 'create') { setName(parsed.doc.library.name); setDescription(parsed.doc.library.description) }
      }
      setFileText(t)
      await runPreview(t)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '파일을 읽지 못했습니다')
    }
  }

  const s = preview?.summary
  const removable = s ? s.counts.remove - s.counts.removeBlocked : 0
  const changes = s ? s.counts.add + s.counts.update + (includeStale ? s.counts.stale : 0) + (prune ? removable : 0) : 0

  const onApply = async () => {
    if (fileText === null || preview === null || busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const res = await importLibrary.mutateAsync({
        target: targetInput(), text: fileText, prune, includeStale, dryRun: false, expectedStateHash: preview.stateHash,
      })
      const c = res.summary.counts
      toast.success(`추가 ${c.add} · 갱신 ${c.update + (includeStale ? c.stale : 0)} · 삭제 ${prune ? c.remove - c.removeBlocked : 0}`)
      onDone()
    } catch (err) {
      const code = (err as { data?: { code?: string } }).data?.code
      if (code === 'CONFLICT') setConflict(true)
      else toast.error(err instanceof Error ? err.message : '가져오지 못했습니다')
    } finally {
      busyRef.current = false; setBusy(false)
    }
  }

  const section = (title: string, status: LibraryImportSummary['entries'][number]['status']) => {
    const rows = (s?.entries ?? []).filter((e) => e.status === status)
    if (rows.length === 0) return null
    return (
      <div className="grid gap-1">
        <p className="text-sm font-medium">{title} {rows.length}건</p>
        <ul className="grid gap-0.5 text-xs">
          {rows.slice(0, SHOWN).map((e, i) => (
            <li key={`${e.kind}:${e.name}:${i}`}>
              {RESOURCE_KIND_LABEL[e.kind]} {e.name}
              {e.status === 'stale' && ` (서버 v${e.currentVersion}, 파일 v${e.fileVersion})`}
              {e.status === 'remove' && e.referencedBy > 0 && ` — 용어 ${e.referencedBy}건이 가리켜 지우지 않음`}
              {e.changes.map((c) => <span key={c.field} className="ml-2 text-muted-foreground">{c.field}: {text(c.from)} → {text(c.to)}</span>)}
            </li>
          ))}
          {rows.length > SHOWN && <li className="text-muted-foreground">외 {rows.length - SHOWN}건</li>}
        </ul>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target.kind === 'existing' ? `라이브러리 가져오기 — ${target.name}` : '파일에서 만들기'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto">
          {target.kind === 'create' && (
            <div className="grid gap-2">
              <Label htmlFor="lib-import-name">이름</Label>
              <Input id="lib-import-name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
              <Label htmlFor="lib-import-desc">설명 (선택)</Label>
              <Input id="lib-import-desc" value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor="lib-import-file" className="text-sm font-medium">파일 선택</label>
            <input id="lib-import-file" type="file" accept=".yaml,.yml,.xlsx" disabled={busy}
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm disabled:opacity-50"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f) }} />
          </div>
          {issues.length > 0 && (
            <ul role="alert" className="grid gap-0.5 text-xs text-destructive">
              {issues.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {s && (
            <>
              {s.warnings.map((w) => <p key={w} className="text-xs text-amber-600">{w}</p>)}
              {section('추가', 'add')}
              {section('갱신', 'update')}
              <p className="text-sm">그대로 {s.counts.unchanged}건</p>
              {section('오래된 파일', 'stale')}
              {section('파일에 없음', 'remove')}
              {removable > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={prune} disabled={busy} onChange={(e) => setPrune(e.target.checked)} />
                  <span>파일에 없는 항목 {removable}건 삭제
                    {prune && <span className="block text-xs text-muted-foreground">이미 가져간 프로젝트의 사본은 그대로 남습니다</span>}</span>
                </label>
              )}
              {s.counts.stale > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={includeStale} disabled={busy} onChange={(e) => setIncludeStale(e.target.checked)} />
                  <span>오래된 파일 항목 {s.counts.stale}건 덮어쓰기
                    {includeStale && <span className="block text-xs text-muted-foreground">서버의 더 새 값을 파일의 옛 값으로 되돌립니다</span>}</span>
                </label>
              )}
              {changes === 0 && <p className="text-sm text-muted-foreground">파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다</p>}
            </>
          )}
          {conflict && (
            <div role="alert" className="flex items-center justify-between gap-2 text-sm text-destructive">
              미리보기 이후 라이브러리가 바뀌었습니다
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (fileText !== null) void runPreview(fileText) }}>다시 미리보기</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" disabled={busy || preview === null || changes === 0 || conflict} onClick={() => void onApply()}>
            가져오기 실행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

> 409 판정은 `TRPCClientError` 의 `data.code` 다 — 다른 화면이 쓰는 판정 방식(`grep -rn "data?.code" apps/web/src`)과 같게 맞춘다. 409 뒤에는 실행 버튼이 잠기고 「다시 미리보기」만 남는다.

`resource-library-manager.tsx`:
- import 에 `Download, Upload, FileUp` 아이콘, `useState` 이미 있음, `LIBRARY_FILE_EXTENSION`, `LibraryImportDialog`·`LibraryImportTarget` 을 더한다.
- 상태 `const [importTarget, setImportTarget] = useState<LibraryImportTarget | null>(null)`.
- 내보내기 핸들러:
```tsx
  /** 배포 파일을 내려받는다 — 읽을 수 있으면 누구나(배포 목적). */
  const onExport = async (lib: { id: string; name: string }) => {
    try {
      const res = await queryClient.fetchQuery(trpc.resource.library.export.queryOptions({ libraryId: lib.id }))
      const url = URL.createObjectURL(new Blob([res.text], { type: 'application/yaml' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${lib.name.replace(/[\\/:*?"<>|]/g, '_')}${LIBRARY_FILE_EXTENSION}`
      a.click()
      URL.revokeObjectURL(url)
      if (res.danglingDomainRefs > 0) toast.info(`삭제된 도메인을 가리키던 용어 ${res.danglingDomainRefs}건은 도메인 없이 내보냈습니다`)
    } catch (err) { onError(err as { message: string }) }
  }
```
- 머리 버튼 영역: `canManage` 일 때 「라이브러리 만들기」 옆에
```tsx
          <Button size="sm" variant="outline" onClick={() => setImportTarget(scope === 'global' ? { kind: 'create', scope } : { kind: 'create', scope, orgId: orgId! })}>
            <FileUp /> 파일에서 만들기
          </Button>
```
- 라이브러리 행 버튼(삭제 버튼 앞): 내보내기는 **항상**, 가져오기는 `canManage` 일 때
```tsx
              <Button size="icon" variant="ghost" className="size-7" aria-label={`${lib.name} 내보내기`} onClick={() => void onExport(lib)}>
                <Download className="size-4" />
              </Button>
              {canManage && (
                <Button size="icon" variant="ghost" className="size-7" aria-label={`${lib.name} 가져오기`}
                  onClick={() => setImportTarget({ kind: 'existing', libraryId: lib.id, name: lib.name })}>
                  <Upload className="size-4" />
                </Button>
              )}
```
- 컴포넌트 끝(다른 Dialog 뒤)에
```tsx
      {importTarget && (
        <LibraryImportDialog target={importTarget} onClose={() => setImportTarget(null)}
          onDone={() => { setImportTarget(null); void invalidateLibraries(); void invalidateItems() }} />
      )}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm --filter @erdd/web exec vitest run src/components/library-import-dialog.test.tsx src/components/resource-library-manager.test.tsx`
Expected: PASS. jsdom 의 `File.text()` 가 없으면 다이얼로그에서 `await new Response(file).text()` 로 바꾸지 말고 **보고한다**(런타임 브라우저에는 있다 — 테스트 환경 문제인지 먼저 확인).

- [ ] **Step 5: 타입 검사** — `pnpm -s -r typecheck; echo "exit=$?"` → `exit=0`

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/components/library-import-dialog.tsx apps/web/src/components/library-import-dialog.test.tsx apps/web/src/components/resource-library-manager.tsx apps/web/src/components/resource-library-manager.test.tsx && git commit -m "feat(web): 라이브러리 관리 화면에 내보내기·가져오기·파일에서 만들기

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

- [ ] **Step 7: 구분력 실증(커밋 뒤)** — `onApply` 에서 `expectedStateHash` 를 빼면 「미리보기 해시를 실어 적용한다」가, `changes === 0` 잠금을 빼면 0건 테스트가 실패하는지 본다.

---

### Task 9: 문서

**Files:**
- Modify: `docs/guides/shared-resources.md`, `docs/guides/cli.md`
- Modify: `docs/manual/user-guide.md`, `docs/manual/cli-guide.md`, `docs/manual/local-guide.md`

**규칙:** `docs/guides/doc-conventions.md` — 연대기 금지, `파일:줄번호` 금지, 같은 규칙을 두 곳에 쓰지 않는다(사본은 정본을 가리키는 한 줄). **CLI 매뉴얼의 출력은 실물을 그대로 인용한다** — 워크트리의 격리 DB 로 서버를 띄우고 실제로 명령을 돌려 출력을 복사한다(`docs/guides/setup.md` 「서버·웹 띄우기」).

- [ ] **Step 1: `docs/guides/shared-resources.md`** — 「승격 — 가져오기의 반대 방향」 앞에 새 절 `## 파일 내보내기·가져오기` 를 더한다. 담을 규칙(각 항목에 「어기면 무엇이 조용히 깨지는가」를 붙인다):
  - 판정은 core `planLibraryImport` 한 곳 — 서버 적용·웹 미리보기·CLI 가 모두 부른다.
  - 매칭 순서(같은 라이브러리 id → 항목 id, 그다음 종류·표시 이름·커스텀 항목 target), 한 기존 항목은 한 파일 항목에만.
  - 원천 파일의 빠진 키는 「말하지 않음」 — 파서가 zod 출력을 쓰면 `.partial()` 안의 기본값이 말하지 않은 키를 만들어 Excel 가져오기가 기존 영문명을 지운다.
  - 재매핑 뒤 비교, 같으면 버전을 올리지 않는다(전 프로젝트에 가짜 자동 갱신).
  - `stale` 은 id 매칭 + 파일 버전 < 서버 버전일 때만, 기본 제외(`sourceBehind` 와 같은 부류).
  - 종류 키 부재와 `[]` 의 차이, 남는 용어가 가리키는 도메인은 지우지 않는다.
  - 라이브러리 행 락 → 항목 읽기 순서(뒤집으면 동명 중복), 전부 아니면 전무, `expectedStateHash`.
  - 「알려진 한계」 절에 `### 파일 내보내기·가져오기` 를 더한다: 잠금 순서가 승격과 반대라 이론상 데드락(40P01, 안전 실패), 동명 판정은 trim 완전일치(유니코드 정규화 없음), 서버 없이 Excel 에서 배포 파일을 만드는 경로 없음, 로컬 웹 화면의 가져오기 UI 없음, 갱신이 항목당 UPDATE 한 번이라 대량 갱신이 느리다.
- [ ] **Step 2: `docs/guides/cli.md`** — 「액세스 토큰 인증」 표에 행을 더한다: `resource.library.list`·`resource.library.export`·`resource.library.import` → `library list`·`library export`·`library import`. 서비스 관리자 토큰은 **라이브러리를 만들고 전역에 쓴다**는 폭발 반경 문장을 보탠다. `dict pull --file` 은 서버를 부르지 않는다는 한 줄을 「공용 사전」 절에.
- [ ] **Step 3: `docs/manual/user-guide.md`** — 19절 「라이브러리 관리」에 내보내기·가져오기·파일에서 만들기 조작(Task 8 의 화면 문구 그대로), 13절 머리에 「파일로 주고받기 → 19절」 한 줄.
- [ ] **Step 4: `docs/manual/cli-guide.md`** — 새 절 `erdd library`(list·export·import, 옵션, 종료 코드, 실물 출력), 6.11 에 `dict pull --file`·파일 구독, 5.2 `dictionaries[].file`, 문제 해결 표에 새 오류 문구(「서버에서 내보낸 파일만 받을 수 있습니다」, 「다른 라이브러리」, 「파일에서 받은 사전은 올릴 수 없습니다」, 「서버 주소가 필요합니다」).
- [ ] **Step 5: `docs/manual/local-guide.md`** — 7.3 에 「로컬 전용 프로젝트도 서버가 내보낸 배포 파일로 받는다」 소절, 대조표의 공용 리소스 두 줄을 「화면은 없다 — `erdd dict pull --file` 로 받는다(서버 연결 없이)」로, 문제 해결 표의 `서버에 연결되지 않은 프로젝트입니다` 행에 `--file` 안내.
- [ ] **Step 6: 커밋**

```bash
git add docs/guides/shared-resources.md docs/guides/cli.md docs/manual/user-guide.md docs/manual/cli-guide.md docs/manual/local-guide.md && git commit -m "docs: 공용 라이브러리 파일 내보내기·가져오기 — 정본 규칙과 매뉴얼 네 편

Co-Authored-By: Claude <노출용 이름> <noreply@anthropic.com>
Claude-Session: <세션 URL>"
```

---

### Task 10: 전체 검증과 스모크

- [ ] **Step 1: 전체 스위트** — 격리 test DB 로:

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/<test DB>' pnpm verify
```
Expected: 통과. 서버 스위트 skip 이 0 인지 출력에서 확인한다.

- [ ] **Step 2: 최종 whole-branch 리뷰** — 리뷰어 프롬프트에 다음을 넣는다: 「이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라.」 대상 후보: `loadLibraryItems`(가져오기가 락 뒤에 부른다), `resolveLibrary`(`erdd library` 가 조직 라이브러리 목록으로 부른다), `planResync`(파일 항목), `dictSheetsFromWorkbook`(웹·CLI), `writeConfig`(`file` 보존), `report`/`render`(파일 보고).

- [ ] **Step 3: 스모크(실 앱 + 격리 DB)** — 브라우저·CLI 로:
  1. `/admin` 「파일에서 만들기」로 1만 건대 Excel(단어·용어·도메인 3시트)을 가져온다 → 미리보기 건수 → 실행 → 항목 수 확인.
  2. 같은 파일을 「가져오기」로 다시 → 「파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다」.
  3. 영문명 컬럼을 지운 Excel 로 가져오기 → 기존 영문명이 남는지 항목 편집 화면에서 확인.
  4. 「내보내기」 → 받은 파일을 로컬 전용 프로젝트(`erdd init --local`)의 `vendor/` 에 두고 `erdd dict pull --file vendor/<파일>` → `erdd serve` 화면 사전에 보이는지.
  5. 서버에서 단어 하나를 고치고 다시 내보내 파일을 갈아 끼운 뒤 `erdd dict pull` → 「자동 갱신 1」.
  6. 관리자 토큰으로 `erdd library import 표준.xlsx --create "스모크" --scope global --server <url>` → `erdd library list` 에 보이는지.
- [ ] **Step 4: 병합 후** — 이 계획서를 지운다(`docs/guides/worktree-workflow.md` 「sub-project 하나를 도는 흐름」).
