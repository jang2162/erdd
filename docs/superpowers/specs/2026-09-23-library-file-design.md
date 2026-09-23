# 공용 라이브러리 파일 내보내기·가져오기

## 배경과 목표

**지금 막히는 곳**

- 서버 없는 **로컬 전용 프로젝트**(`erdd init --local`)는 공용 라이브러리를 받을 길이 없다. 웹 「공용 리소스」는
  로컬 모드에 없고, `erdd dict` 는 서버 연결을 요구한다. Excel 사전을 내보내 로컬에 넣으면 `origin` 이 없는
  단순 복사라 재동기화가 이어지지 않는다.
- **외부 표준(행안부 공통표준 등)을 라이브러리에 대량 등록할 수 없다.** 관리 화면은 항목을 한 건씩 넣는다.
  우회로는 프로젝트에 Excel 사전을 넣고 승격하는 것뿐이다.
- **라이브러리 생성·항목 쓰기가 토큰 API 에 없다.** `resource.library.create`·`resource.items.*` 쓰기가 전부
  `authedProcedure`(세션 전용)다. 토큰으로는 프로젝트를 거친 승격(`resource.promote`)만 된다.

**사용자 결정**

| 질문 | 결정 |
|---|---|
| 용도 | **서버 없는 로컬 프로젝트에 배포**(개정 파일로 3-way 재동기화까지), **외부 표준을 라이브러리로 대량 등록** |
| 등록 원천 | **둘 다** — 라이브러리 파일(내보낸 파일 왕복)과 기존 Excel 사전 양식 |
| 기존 라이브러리에 다시 가져오기 | **갱신 병합** — 매칭되면 갱신·버전 증가, 없으면 추가, 파일에 없는 항목은 기본 유지(옵션으로 삭제) |
| 조작 위치 | **웹 + CLI(토큰)** — 라이브러리 생성도 가져오기로 된다 |
| 로컬 전용 프로젝트의 수신 | **CLI `erdd dict pull --file`** — 로컬 웹 화면에는 붙이지 않는다 |
| 항목 정체성 | **A안: 서버 id 보존형** — 파일이 서버의 라이브러리 id·항목 id·버전을 그대로 싣는다 |
| CLI 의 Excel 입력 | **CLI 에 `exceljs` 를 더한다** |

**A안을 고른 이유.** 재동기화 계산 `planResync(model, libraryId, items)` 는 `{id, kind, payload, version}` 배열만
받는 core 순수 함수다. 파일이 서버 값을 그대로 실으면 로컬 재동기화 코드를 고치지 않고 쓰며, 로컬 사본의
`origin` 이 서버에서 받은 것과 같아져 **나중에 서버에 붙어도 같은 라이브러리를 그대로 이어 받는다.**
이름 파생 id(B안)는 이름을 바꾸면 링크가 끊기고 버전을 사람이 관리해야 한다. id 없는 이름 매칭(C안)은
`origin.sourceId` 모델과 맞지 않아 재동기화를 따로 만들어야 한다.

**수용한 비용.** 배포 파일의 원천은 서버뿐이다 — 서버 없이 Excel 에서 배포 파일을 만드는 경로는 없다.

## 범위

**포함**

1. 라이브러리 파일 포맷(`.erdd-lib.yaml`)과 core 직렬화·파싱·검증.
2. core `planLibraryImport` — 갱신 병합 계획(순수 함수).
3. 서버 `resource.library.export` · `resource.library.import`, `resource.library.list` 의 토큰 개방.
4. CLI `erdd library list|export|import`(Excel 입력 포함).
5. CLI `erdd dict pull --file` 과 파일 구독(`dictionaries[].file`).
6. 웹 라이브러리 관리 화면의 「내보내기」·「가져오기」·「파일에서 만들기」.

**범위 밖**

- 서버 간 이관·백업(포맷은 같으니 나중에 얹을 수 있다).
- 서버 없이 Excel 에서 배포 파일 만들기.
- 로컬 웹 화면(`erdd serve`)의 가져오기 UI.
- 라이브러리 이름·설명 수정 UI(기존 한계).

---

## 1. 파일 포맷

YAML 파일 하나, 확장자 `.erdd-lib.yaml`. `erdd/` 사전 파일과 같은 이유로 YAML 이다 — 사람이 읽고 git diff 가
읽히며, 사람·스크립트가 직접 만들 수 있다.

```yaml
format: erdd-library
formatVersion: 1
library:
  id: 01a0cc5e-…            # 서버 라이브러리 id
  name: 공공데이터 표준 사전
  description: 행안부 2026 개정판
domains:
  - id: 01a0cc5f-…
    version: 3
    name: 금액
    category: 숫자
    logicalType: decimal
    dialectTypes: { postgresql: numeric(18,2), mysql: null, oracle: null, mssql: null }
    defaultValue: null
    allowedValues: []
    description: null
words:
  - { id: 01a0cc60-…, version: 1, logicalName: 고객, abbreviation: CUST, englishName: CUSTOMER, description: null }
terms:
  - { id: …, version: 2, logicalName: 고객번호, physicalName: CUST_NO, domainId: 01a0cc5f-…, description: null }
customFields: []
```

**규칙**

- **항목 = `id`·`version` + payload 필드를 평평하게 펼친 것.** payload 는 `RESOURCE_PAYLOAD_SCHEMAS[kind]`(strict)
  로 검증한다 — 오타 키는 오류다. 종류 키는 `domains`·`words`·`terms`·`customFields`(`RESOURCE_COLLECTION_BY_KIND`).
- **용어의 `domainId` 는 같은 파일 안 도메인의 `id` 이거나 `null` 이다.** 파일 밖을 가리키면 파일 오류다.
- **한 파일 안에서 같은 종류·같은 표시 이름(trim)이 둘이면 파일 오류다.** 커스텀 항목은 `(이름, target)` 이 키다.
  어느 쪽을 적용할지 정할 수 없다.
- **엄격도가 둘이다 — 포맷은 하나다.**
  - **배포 파일**: `library.id` 와 모든 항목의 `id`·`version` 이 있다. 서버 `export` 는 언제나 배포 파일을 낸다.
    **`dict pull --file` 은 배포 파일만 받는다.**
  - **원천 파일**: `library.id`·`version` 을 생략할 수 있고, `id` 는 용어가 도메인을 가리킬 때만 필요하다(파일
    안에서만 뜻이 있는 임의 문자열 — `d-money` 등). **서버 가져오기만** 원천 파일을 받는다.
  - **원천 파일의 빠진 payload 키는 「말하지 않음」이다(부분 필드).** 가져오기가 그 키의 기존 값을 건드리지 않는다.
    필수 키는 도메인 `name`·`logicalType`, 단어 `logicalName`, 용어 `logicalName`·`physicalName`, 커스텀 항목
    `name`·`target`·`type` 이다. 도메인 `dialectTypes` 도 일부 방언만 적을 수 있다. 파서는 원천 파일의 필드를
    **입력 그대로** 싣는다 — zod 출력을 쓰면 `.partial()` 안의 `.default()` 가 말하지 않은 키(`englishName: null`)를
    만들어 낸다. 배포 파일은 완전값(스키마 출력)이다.
  - **원천 파일의 용어는 `domainName` 으로 도메인을 이름으로 가리킬 수 있다**(`domainId` 와 함께는 안 된다). 해석은
    가져오기가 한다 — 같은 파일의 도메인 이름 → 대상 라이브러리의 도메인 이름 순, 없으면 `null` + 경고. 배포 파일에는
    쓸 수 없다.
- **종류 키의 부재와 빈 목록은 다른 뜻이다.** 키가 없으면 「이 파일은 그 종류를 말하지 않는다」, `[]` 이면 「그 종류는
  비어 있다」. 가져오기의 삭제(prune) 판정이 이 차이를 쓴다(2절). 직렬화는 네 키를 언제나 모두 쓴다.
- **직렬화는 결정적이다.** 종류는 `RESOURCE_KINDS` 순, 종류 안은 `id` 코드 단위 오름차순(`localeCompare` 금지).
  타임스탬프를 싣지 않는다 — 같은 라이브러리 상태면 바이트가 같아, 배포 파일을 git 에 두면 diff 가 곧 개정
  내역이다.
- **모르는 `format`/`formatVersion` 은 오류다.** DDL 머릿말(깨지면 조용히 `null`)과 반대다 — 사용자가 명시적으로
  고른 가져오기를 조용히 삼키면 안 된다.
- **오류는 모아서 낸다.** 첫 오류에서 멈추지 않고 위치(`domains[3] (금액): dialectTypes.postgresql — …`)와 함께
  목록으로 돌려준다. 표시는 최대 20건 + 「외 N건」.
- **상한 50,000 항목.** 파싱 전에 항목 수를 세어 넘으면 거절한다. 행안부 공통표준(용어 1만 건대)이 여유 있게
  들어가고, 서버 본문 상한 16MB 안이다.
- **core `library-file.ts` 하나가 직렬화·파싱·검증을 갖는다.** 서버·CLI·웹이 모두 이것을 부른다.

### Excel 에서 원천 파일로

Excel 은 배포 포맷이 아니라 **서버 가져오기의 또 다른 입력**이다. 기존 사전 양식(단어사전·용어사전·
도메인정의서 3시트)을 core 변환 함수 `libraryFileFromDictSheets(sheets: RawSheet[])` 가 원천 파일 구조로 바꾼다.

- 헤더 해석·행 검증은 기존 `planDictImport` 를 재사용한다. 그 `patch`(시트에 **있던 컬럼만** 담는다)를 그대로
  원천 파일 항목의 필드로 쓴다 — **없는 컬럼은 말하지 않은 것**이 되어 가져오기가 기존 값을 둔다. draft 를 쓰면
  영문명 컬럼이 없는 파일이 기존 영문명을 전부 지운다.
- **시트가 있으면 그 종류를 말한 것이고(종류 키 있음), 없으면 말하지 않은 것이다.** Excel 에는 커스텀 항목 시트가
  없으므로 `customFields` 키는 언제나 없다.
- 용어의 「기본 도메인」은 같은 파일의 도메인이면 그 파일 안 id 로, 아니면 `domainName` 으로 남긴다 — 도메인 시트
  없이 용어만 다시 올려도 대상 라이브러리의 도메인에 그대로 연결된다(파일 안 id 로만 풀면 기존 용어의 도메인 연결이
  전부 지워진다). 「찾을 수 없다」 경고는 파일에도 대상 라이브러리에도 없을 때만 낸다(클라가 대상 도메인 이름을 넘긴다).
- **오류 행이 하나라도 있으면 변환 전체가 실패한다** — 가져오기는 전부 아니면 전무다.
- 셀 해석(워크북 → `RawSheet[]`)은 core `dictSheetsFromWorkbook` 하나다. 웹과 CLI 는 각자 exceljs 로 파일을 열어
  워크북만 넘긴다 — 셀 해석(리치 텍스트·수식 결과·날짜)이 두 곳에서 갈라지지 않게 한다.

---

## 2. 서버 가져오기 — 갱신 병합

**계산은 core `planLibraryImport(existing: LibraryItemRow[], file, { targetLibraryId })` 한 곳이다.** 서버 적용·웹
미리보기·CLI `--dry-run` 이 모두 이것을 부른다. `existing` 은 `loadLibraryItems` 결과(`(createdAt, id)` 오름차순).

### 매칭

파일 항목마다 대상 라이브러리의 기존 항목을 찾는다.

1. **`file.library.id === targetLibraryId` 이면 항목 `id` 로 먼저 매칭한다.** 같은 서버에서 내보내 고쳐 다시 올리는
   경우다. 종류가 다르면 매칭이 아니다.
2. 1에서 못 찾았거나 id 가 다르면(다른 라이브러리·원천 파일·Excel) **`(종류, 표시 이름 trim 완전일치)`** 로
   매칭한다. 커스텀 항목은 `target` 도 같아야 한다. 기존에 동명이 여럿이면 `existing` 순서의 첫 항목이고, 계획에
   경고로 싣는다.
3. **한 기존 항목은 한 파일 항목에만 매칭된다.** id 매칭이 먼저 자리를 차지하고, 이름 매칭은 남은 기존 항목만
   본다.

### 분류

| 상태 | 뜻 | 적용 |
|---|---|---|
| `add` | 매칭 없음 | 새 uuidv7, `version 1` |
| `update` | 재매핑 뒤 payload 가 다름 | `version + 1` |
| `unchanged` | 같음 | 쓰지 않는다 — 버전을 올리지 않는다 |
| `stale` | id 로 매칭됐고 **파일 `version` < 서버 `version`** 이고 payload 가 다름 | **기본 제외.** `includeStale` 이면 `update` 로 적용 |
| `remove` | 어느 파일 항목에도 매칭되지 않은 기존 항목, **그 종류 키가 파일에 있을 때만** | `prune` 이면 삭제, 아니면 유지 |

- **`unchanged` 에서 버전을 올리지 않는 이유** — 버전이 오르면 그 라이브러리를 가져다 쓴 모든 프로젝트의
  재동기화에 가짜 「자동 갱신」이 뜬다. `items.update` 의 「실제 변경일 때만 올린다」와 같은 규칙이다.
- **`stale` 을 기본 제외하는 이유** — 옛 export 파일을 다시 올리면 그 사이 남이 고친 원본이 옛 값으로 조용히
  되돌아간다. 승격의 `sourceBehind`(shared-resources 「승격」)와 같은 결함 부류라 같은 처방(기본 제외 + 알림)을
  쓴다. 파일 `version` 이 없는 원천 파일은 `stale` 판정을 하지 않는다.
- **파일의 `version` 은 판정에만 쓰고 저장하지 않는다.** 버전을 매기는 권한은 서버에만 있다.
- **용어 `domainId` 재매핑** — 파일 도메인 id → (매칭된 기존 항목 id | 이번에 새로 만들 id). **재매핑한 뒤의 값으로**
  `update`/`unchanged` 를 판정한다. 재매핑 전 값으로 비교하면 다른 라이브러리에서 온 파일이 전부 `update` 가 된다.
  새로 만들 id 는 계획 단계에서 자리표시로 두고 적용 시 발급한다(재동기화의 「새 id 자리표시」와 같은 방식).
- **부분 필드** — 원천 파일 항목은 적힌 키만 기존 payload 에 덮는다(도메인 `dialectTypes` 는 한 단계 병합).
  `add` 는 빠진 키를 기본값으로 채운다(기존 Excel 가져오기의 `draft = 기본값 + patch`).
- **`prune` 의 종류 한정** — 파일에 종류 키가 없으면 그 종류의 기존 항목은 `remove` 후보가 아니다. Excel 로
  prune 해도 커스텀 항목이 지워지지 않는 이유다.
- **남는 용어가 가리키는 도메인은 지우지 않는다.** `remove` 후보 도메인을 남는 용어(파일의 용어 + 파일이 용어를
  말하지 않았으면 기존 용어 전부)가 가리키면 삭제에서 빼고 경고한다. 지우면 참조가 끊긴 용어가 라이브러리에 남는다.
- 계획은 상태별 목록과 건수, 그리고 `expectedStateHash`(아래)를 담는다. **`dryRun` 은 `prune`·`includeStale` 과
  무관하게 전체 분류를 돌려준다** — 두 플래그는 적용에만 쓴다.

### 적용·원자성·경합

- **가져오기 한 번 = 한 트랜잭션, 전부 아니면 전무.** 승격처럼 어긋난 항목만 건너뛰지 않는다 — 사전은 참조로
  엮여 있어서 부분 반영이면 용어가 엉뚱한 도메인을 가리킬 수 있다.
- **라이브러리 행을 `FOR UPDATE` 로 먼저 잠그고**, 그 안에서 `loadLibraryItems` 로 읽어 계획을 **다시 계산**한 뒤
  쓴다. 가져오기끼리의 동시 삽입(동명 중복)이 여기서 직렬화된다.
- **`expectedStateHash`** — 기존 항목 `(id, version)` 전체를 `id` 오름차순으로 이은 값의 SHA-256. 미리보기 때 받은
  값을 적용 요청에 실으면, 락 안에서 다시 계산한 값과 다를 때 409 「미리보기 이후 라이브러리가 바뀌었습니다 —
  다시 미리보기 하세요」로 거절한다. 없으면(CLI `--yes`) 락 안의 계획을 그대로 적용한다.
- **잠금 순서는 라이브러리 → 항목이다.** 승격(`runPromoteInTx`: 항목 → 라이브러리 `updatedAt`)과 반대라 데드락
  경로가 이론상 있다 — 기존 `library.remove` 와 같은 한계이고 40P01 로 안전하게 실패한다. 「알려진 한계」에 적는다.
- 적용 후 라이브러리 `updatedAt` 을 갱신한다(0건이면 갱신하지 않는다).

### 프로시저

둘 다 `apiProcedure` 로 연다(guides/cli.md 「액세스 토큰 인증」 — CLI 가 실제로 쓰므로).

- **`resource.library.export({ libraryId })`** → `{ text, danglingDomainRefs }`
  - `requireLibraryRead` 면 된다 — 배포 목적이라 읽을 수 있는 사람이면 내보낸다.
  - `items.remove` 는 용어의 도메인 참조를 정리하지 않는다. 그래서 **삭제된 도메인을 가리키는 용어는
    `domainId: null` 로 쓰고 그 수를 `danglingDomainRefs` 로 돌려준다.** 파일이 1절의 「파일 안만 가리킨다」를
    어기지 않게 하기 위해서다.
- **`resource.library.import({ target, text, prune, includeStale, dryRun, expectedStateHash? })`**
  - `target` 은 `{ libraryId }` 또는 `{ create: { scope, orgId?, name, description } }`. 생성이면 `requireScopeWrite`,
    기존이면 `requireLibraryWrite`. 생성 + 가져오기가 한 트랜잭션이다(가져오기가 실패하면 라이브러리도 없다).
    `create` 에서는 `dryRun` 이 모든 항목을 `add` 로 낸다.
  - **파일은 텍스트로 받아 서버가 core 파서로 파싱한다.** 클라가 파싱한 구조를 믿지 않는다. 파싱 오류는
    `BAD_REQUEST` 이고 오류 목록을 함께 싣는다.
  - 결과: `{ libraryId, plan 요약(상태별 건수·표시용 목록), expectedStateHash, applied: boolean }`.
- **`resource.library.list`** 를 `apiProcedure` 로 열고 행마다 `canWrite` 를 싣는다 — `erdd library list` 가 프로젝트
  없이 부르고, 쓰기 가능 여부를 클라가 역할 조합식으로 재현하지 않게 한다(`listForProject` 와 같은 원칙).
- `expectedStateHash` 는 서버가 계산한다(`node:crypto` SHA-256). 클라는 받은 값을 되돌려 보낼 뿐이다.

---

## 3. CLI

### 3.1 `erdd library` — 서버 라이브러리 관리 (새 명령 무리)

```bash
erdd library list
erdd library export "공공데이터 표준 사전" -o std.erdd-lib.yaml
erdd library import std.erdd-lib.yaml --library "공공데이터 표준 사전" [--prune] [--include-stale] [--dry-run]
erdd library import 행안부_표준.xlsx --create "공공데이터 표준 사전" --scope global
erdd library import 표준.xlsx --create "플랫폼팀 표준" --scope org --org "플랫폼팀"
```

- **프로젝트 없이 돈다.** 서버 주소는 `--server <url>`, 없으면 `erdd.config.yaml` 의 `serverUrl`. 둘 다 없으면 사용법
  오류(`2`). 토큰은 기존 `resolveToken`(`ERDD_TOKEN` → `.erdd/credentials.json`).
- 라이브러리 지정은 이름 또는 id. 이름이 여럿에 맞으면 후보를 보이고 멈춘다(`2`) — `dict` 의 `resolveLibrary` 와
  같은 규칙이다.
- `export` 는 `-o` 가 없으면 표준 출력으로 쓴다. `danglingDomainRefs > 0` 이면 표준 오류로 알린다.
- **`import` 는 미리보기를 먼저 보이고 확인을 받는다.** `--yes` 면 건너뛰고, `--dry-run` 이면 쓰지 않는다.
  ```
  공공데이터 표준 사전 (전역)
    추가 312 · 갱신 41 · 그대로 12,480 · 삭제 0 (--prune 이 없어 파일에 없는 38건은 남김)
    오래된 파일 3 — 건너뜀 (--include-stale 로 덮어쓰기):
      용어 고객번호  (서버 v4, 파일 v2)
  ```
  확인 후 적용은 미리보기의 `expectedStateHash` 를 싣는다. 실패하면 「아무것도 반영하지 않았습니다」를 명시한다.
- `--library` 와 `--create` 는 정확히 하나. `--create` 에는 `--scope` 가 필수이고 `org` 면 `--org` 가 필수다(`2`).
- **입력이 `.xlsx` 면** 노드용 리더(`exceljs`)로 `RawSheet[]` 를 만들고 core `libraryFileFromDictSheets` →
  직렬화한 텍스트를 보낸다. 서버가 받는 입력은 언제나 라이브러리 파일 텍스트 하나다.
- 새 서버 호출은 `guardFeature` 로 감싼다 — 옛 서버의 401/404 를 「서버를 업그레이드하세요」로 번역한다.
- `@erdd/cli` 의존성에 `exceljs` 가 더해진다(순수 JS). release.md 의 가드와 무관하나 게시 크기가 는다.

### 3.2 `erdd dict pull --file` — 파일에서 받기

```bash
erdd dict pull --file vendor/std.erdd-lib.yaml    # 처음 — 구독에 더한다
erdd dict pull                                    # 이후 — 파일을 갈아 끼우고 다시 받으면 3-way 재동기화
```

- **배포 파일만 받는다.** 아니면 「서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요)」(`1`).
- **계산은 서버판과 같다.** `planResync(model, file.library.id, items)` → 기존 `decide`/`planAdoption`/
  `applyResyncPlan` → `writeDictionaryFiles`. `--adopt`·`--conflicts theirs|ours`·`--dry-run` 과 `erdd/origins.yaml`
  이 그대로다. 미저장 드래프트 검사(`hasDraft`)도 그대로다.
- **`--file` 경로는 서버 연결을 요구하지 않는다**(`requireDictConnection` 을 거치지 않는다). 로컬 전용·서버 연결
  프로젝트 모두에서 된다. `--file` 과 `--library` 는 함께 쓸 수 없다(`2`).
- **구독** — `erdd.config.yaml` 의 `dictionaries` 항목에 선택 필드 `file` 을 더한다.
  ```yaml
  dictionaries:
    - { id: 01a0cc5e-…, name: 공공데이터 표준 사전, file: vendor/std.erdd-lib.yaml }
  ```
  - `file` 이 있으면 파일에서, 없으면 서버에서 받는다. 인자 없는 `dict pull` 이 적힌 순서대로 처리한다.
    로컬 전용 프로젝트에 서버 구독이 있으면 그 줄은 「서버에 연결되지 않아 건너뜀」으로 보고한다.
  - 경로는 프로젝트 루트 기준 상대 경로(POSIX 구분자)로 적는다. **`erdd/` 안은 거부한다** — 모델 파일 트리다.
    루트 밖(`..`)도 거부한다 — 커밋되는 config 가 저장소 밖 파일에 기대면 다른 체크아웃에서 깨진다.
  - **구독 id ≠ 파일 `library.id` 면 멈춘다**(`1`). 다른 라이브러리 파일로 갈아 끼우면 기존 연결이 전부
    「원본에서 사라짐」으로 보인다.
  - 기존 규칙(같은 id 두 번 금지)이 그대로 적용된다 — 같은 라이브러리를 파일과 서버로 동시에 구독할 수 없다.
  - `readConfig` 는 `file` 이 문자열이 아니면 거절하고, `writeConfig` 는 `file` 을 보존한다(구독을 다시 쓰는 경로가
    `file` 을 떨어뜨리면 다음 pull 이 서버로 간다).
- **서버로 이어가기** — 파일의 id 가 서버 id 그대로라서, `erdd init --server … --create` 로 붙인 뒤 구독 줄에서
  `file` 만 지우고 `erdd dict pull` 하면 같은 라이브러리를 서버에서 이어 받는다(추가 0 · 유지 N).
- **파일 구독은 `dict push` 대상이 아니다.** 지정하면 「파일에서 받은 사전은 올릴 수 없습니다 — 서버에 연결된 뒤
  구독의 file 을 지우세요」(`2`). (`dict push` 는 `--library` 가 필수라 인자 없는 형태가 없다.)
- **`--file` 은 파일의 `library.id` 로 구독 줄을 upsert 한다** — 같은 id 의 서버 구독 줄이 있으면 그 줄을 파일 구독으로
  바꾼다(명시적 전환).
- **`erdd dict list`** — 로컬 전용이면 파일 구독만 보인다(`* 〈이름〉 — 파일 · 항목 N · 읽기 전용 · 〈경로〉`).
  서버에 연결됐으면 서버 목록 뒤에 파일 구독을 덧붙인다. 파일이 없거나 깨졌으면 그 줄에 사유를 적고 목록은
  계속한다.

---

## 4. 웹

위치는 기존 `ResourceLibraryManager` 하나다 — `/admin` 「전역 공용 리소스」와 조직 상세 「조직 공용 리소스」에
함께 생긴다.

- **라이브러리 행**
  - 「내보내기」 — 읽기 권한이면 보인다. `〈이름〉.erdd-lib.yaml` 을 내려받는다(파일 이름에 못 쓰는 문자는 `_`).
    `danglingDomainRefs > 0` 이면 「삭제된 도메인을 가리키던 용어 N건은 도메인 없이 내보냈습니다」 토스트.
  - 「가져오기」 — 쓰기 권한이면 보인다. 이 라이브러리로 갱신 병합한다.
- **머리의 「라이브러리 만들기」 옆 「파일에서 만들기」** — 이름·설명(파일의 `library.name`·`description` 으로 미리
  채움)과 파일을 받아 새 라이브러리로 가져온다.

**가져오기 다이얼로그** — 「라이브러리 가져오기 — 〈이름〉」

1. 「파일 선택」에서 `.erdd-lib.yaml`·`.yaml`·`.xlsx` 를 고른다. **파싱은 브라우저에서 먼저 한다** — 형식 오류는
   서버에 가기 전에 위치와 함께 보인다(최대 20건 + 「외 N건」). Excel 은 `readDictSheets` → core 변환.
2. `dryRun` 결과를 구역별로 보인다 — 「추가」·「갱신」·「그대로」(건수만)·「오래된 파일」·「파일에 없음」. 구역마다
   처음 50건 + 「외 N건」. 「갱신」은 바뀌는 필드를 「현재 〈값〉 → 파일 〈값〉」으로 보인다.
3. 체크박스 둘, **기본 해제** — 「파일에 없는 항목 N건 삭제」(켜면 「이미 가져간 프로젝트의 사본은 그대로
   남습니다」), 「오래된 파일 항목 N건 덮어쓰기」(켜면 「서버의 더 새 값을 파일의 옛 값으로 되돌립니다」).
   체크는 서버를 다시 부르지 않는다.
4. 「가져오기 실행」 — 파일 원문·플래그·`expectedStateHash` 를 보낸다. 409 면 「미리보기 이후 라이브러리가
   바뀌었습니다」와 「다시 미리보기」. 성공하면 토스트 「추가 N · 갱신 N · 삭제 N」, 목록 refetch.
   **바뀔 것이 0건이면 실행 버튼을 잠그고 「파일 내용이 라이브러리와 같아 바뀐 항목이 없습니다」를 보인다.**
   처리 중에는 파일 선택·체크박스·버튼을 함께 잠근다.

로컬 모드 웹 화면에는 붙이지 않는다.

---

## 5. 오류 처리

- 파일 오류: 서버 `BAD_REQUEST`(오류 목록 동봉), CLI `VALIDATION`(`1`), 웹은 다이얼로그 안 목록.
- CLI 사용법 오류는 `2`(인자 조합, 서버 주소 없음, 이름 모호).
- 적용은 전부 아니면 전무 — 실패하면 라이브러리는 그대로이고, CLI 는 「아무것도 반영하지 않았습니다」를 적는다.
- 권한 거절은 기존 `requireScopeWrite`/`requireLibraryWrite`/`requireLibraryRead` 의 문구 그대로다. 토큰 경로라고
  판정을 따로 두지 않는다.

---

## 6. 테스트

- **core `library-file.test.ts`** — 직렬화 → 파싱 왕복 항등, **입력 순서를 섞어도 바이트가 같다**, 모르는
  `formatVersion`·파일 밖 `domainId`·같은 종류 동명 둘·strict payload 의 모르는 키가 각각 오류, 배포 엄격도에서
  `version` 누락 오류, 종류 키 부재와 `[]` 가 구별되어 읽힌다, 오류가 여러 개면 모두 모인다.
- **core `library-import.test.ts`** — 같은 라이브러리 id 면 id 매칭·다르면 이름 매칭, id 매칭이 자리를 먼저 차지한다,
  **재매핑 뒤 같으면 `unchanged`**(다른 라이브러리에서 온 파일이 전부 `update` 가 되지 않는다), `stale` 은 파일
  version 이 낮고 내용이 다를 때만, **종류 키 부재면 prune 후보가 아니고 `[]` 면 후보다**, 커스텀 항목은 `target`
  까지 같아야 매칭, 기존 동명 다수는 `(createdAt, id)` 첫 항목 + 경고, 부분 필드(Excel) 항목은 없는 필드를
  건드리지 않는다, 남는 용어가 가리키는 도메인은 prune 이어도 지우지 않는다.
- **core Excel 변환** — `libraryFileFromDictSheets` 결과를 가져오기에 넣은 계획이, 같은 내용의 라이브러리 파일을
  넣은 계획과 같다(`customFields` 는 말하지 않음).
- **서버** — 권한(전역은 서비스 관리자만, 조직은 Owner/Admin, **다른 조직 `orgId` 로 `create` 거절**, 토큰 경로 동일
  판정, export 는 읽기 권한), `expectedStateHash` 불일치 409, 실패 주입 시 항목·라이브러리 모두 불변(생성 +
  가져오기 포함), **동시 가져오기 둘이 동명 중복을 만들지 않는다** — `Promise.all` 이 아니라 라이브러리 행을 밖에서
  잠그고 `waitForLockWaiter` 로 실제 대기를 관측하는 형태(shared-resources 「경합 테스트는 경합이 일어났다는 것
  자체를 관측해야 한다」), `unchanged` 만인 가져오기가 `updatedAt`·버전을 건드리지 않는다, export 의 끊긴 도메인
  참조가 `null` + 건수.
- **CLI** — 끝단: `library export` → `dict pull --file` → 서버에서 항목 수정 → 다시 export → `dict pull` 이
  자동 갱신·충돌을 낸다. 로컬 전용에서 동작, `erdd/` 안·루트 밖 경로 거부, 구독 id ≠ 파일 id 거부, 배포 엄격도
  미달 거부, **파일 구독 → `file` 제거 후 서버 `dict pull` 이 추가 0 · 유지 N**, 파일 구독 `dict push` 거절,
  `writeConfig` 가 `file` 을 보존, `.xlsx` 입력이 라이브러리 파일 입력과 같은 계획, `--library`/`--create` 인자 조합.
- **웹** — 두 체크박스 기본 해제, 0건이면 실행 잠금 + 문구, 409 → 「다시 미리보기」, 형식 오류가 서버 호출 없이
  보인다.
- **스모크** — 실서버에서 1만 건대 Excel 을 「파일에서 만들기」로 가져오고, 내보낸 파일을 로컬 전용 프로젝트가
  `dict pull --file` 로 받아 `erdd serve` 화면에 사전이 보이는 것까지.

---

## 7. 문서 영향

- `docs/guides/shared-resources.md` — 새 절 「파일 내보내기·가져오기」: 판정은 `planLibraryImport` 한 곳, 매칭 순서,
  재매핑 뒤 비교, `stale`, 종류 키 부재와 prune, 전부 아니면 전무, 락 순서와 데드락 한계.
- `docs/guides/cli.md` — 토큰 프로시저 표에 `resource.library.list`·`export`·`import` 와 `erdd library` 행.
- `docs/manual/user-guide.md` — 19절 「라이브러리 관리」에 내보내기·가져오기·파일에서 만들기, 13절에서 가리키는 한 줄.
- `docs/manual/cli-guide.md` — 새 절 `erdd library`, 6.11 `dict pull --file`·파일 구독, 5.2 `dictionaries[].file`,
  문제 해결 표. **출력은 구현 후 실물을 그대로 인용한다.**
- `docs/manual/local-guide.md` — 7.3 을 「로컬 전용도 배포 파일로 받는다」로, 대조표 두 줄(공용 리소스), 문제 해결 표
  (`서버에 연결되지 않은 프로젝트입니다` 행에 `--file` 안내).
