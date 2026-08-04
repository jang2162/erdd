# CLI 트랙 B 설계 — push · 3-way 병합 · diff · 에이전트 스킬

**작성일:** 2026-08-04 / **선행:** [트랙 A 설계](2026-08-03-cli-pull-design.md) / **기획:** [16-cli.md](../../16-cli.md)

## 1. 목적과 범위

트랙 A가 서버 → 파일(읽기)을 완성했다. 트랙 B는 반대 방향을 연다.

| 명령 | 동작 |
|---|---|
| `push` | 로컬 파일의 변경을 3-way 병합해 서버에 반영 |
| `diff` | push가 무엇을 할지 미리 보여준다(올릴 변경 · 내려올 변경 · 충돌) |
| `skill install` | 에이전트 스킬 문서를 프로젝트에 설치 |

범위 밖: `revision.list`(실사용처가 없어 제외 — 16-cli.md에서 지운다), npm 배포 파이프라인, 충돌의 대화형 해소(pull 후 사용자가 파일에서 정리한다).

## 2. 확정된 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 병합 위치 | **CLI가 계산**, 서버는 `expectedSeq`로 검증 | 병합이 core 순수 함수가 되어 `diff`가 서버 왕복 1회로 같은 결과를 보여준다. 페이로드가 `Op[]`라 `parseOps`·`MAX_OPS_PER_MUTATION` 가드를 그대로 쓴다 |
| 경합 차단 | 새 프로시저 `model.push`의 **필수** `expectedSeq`, 락 안에서 검증 | `model.mutate`를 세션 전용으로 유지한다. optional이면 CLI가 빼먹어도 통과한다 |
| 충돌 단위 | **필드 단위** | agent가 YAML 한 줄씩 고치는 패턴에 맞다. `resource-sync.ts`의 `changedFields`와 같은 방식 |
| 삭제 | **한다 + 확인 프롬프트**(`--yes`로 생략) | 파일이 진실이라는 계약을 지키되 사고를 막는다 |
| push 성공 후 | **암묵적 pull** | 신규 id가 파일에 채워지고, 자동 병합으로 들어온 서버 변경도 파일에 반영되어 다음 `status`가 깨끗해진다 |
| 충돌 출력 | **블록형**(파일별 그룹 + 기준/로컬/서버 줄바꿈) | 값이 길어도 잘리지 않고 어느 파일을 열지 바로 보인다 |
| `diff` 의미 | **항상 3-way 계획 미리보기** | push와 같은 엔진을 써서 본 것과 실제가 갈라질 수 없다. `--base` 플래그 불필요 |
| 스킬 설치 | `.claude/skills/erdd/SKILL.md` | 이 프로젝트가 실제로 쓰는 형식이라 바로 검증된다 |
| 신규 테이블 좌표 | 기존 bbox 아래 **격자 배치** | 겹치지 않고 순수 함수라 테스트가 쉽다 |

## 3. 파일 가시 범위 — 이 설계의 중심

파일에는 `notes`·배치 좌표·`origin`이 없다(트랙 A의 의도적 결정). `filesToModel`이 만든 모델을
그대로 `diffModels`에 넣으면 **메모 전멸 · 좌표 초기화 · fork 출처 소실**이다. 우연이 아니라
구조로 막는다.

### 3.1 `FILE_FIELDS` — 모델 필드 → YAML 키

`packages/core/src/file-merge.ts`에 표 하나를 둔다. 값은 사용자가 파일에서 보는 키 이름이다.

```ts
export type MergeKind = Exclude<EntityKind, 'note'>

export const FILE_FIELDS: Record<MergeKind, Record<string, string>> = {
  table:       { physicalName:'name', logicalName:'logicalName', comment:'comment',
                 groupId:'group', custom:'custom' },
  column:      { tableId:'(소속 테이블)', physicalName:'name', logicalName:'logicalName',
                 type:'type', domainId:'domain', isPk:'pk', autoIncrement:'autoIncrement',
                 nullable:'nullable', defaultValue:'default', comment:'comment',
                 custom:'custom', order:'(순서)' },
  index:       { tableId:'(소속 테이블)', name:'name', columns:'columns', unique:'unique' },
  relationship:{ parentTableId:'to', childTableId:'(소속 테이블)', columnMappings:'columns',
                 cardinality:'cardinality', identifying:'identifying', name:'name' },
  tableGroup:  { name:'name', color:'color', comment:'comment' },
  domain:      { name:'name', category:'category', logicalType:'logicalType',
                 dialectTypes:'dialectTypes', defaultValue:'defaultValue',
                 allowedValues:'allowedValues', description:'description' },
  word:        { logicalName:'logicalName', abbreviation:'abbreviation',
                 englishName:'englishName', description:'description' },
  term:        { logicalName:'logicalName', physicalName:'physicalName',
                 domainId:'domain', description:'description' },
  customField: { name:'name', target:'target', type:'type', options:'options',
                 required:'required', defaultValue:'defaultValue', order:'order' },
}

export const FILE_INVISIBLE_FIELDS: Record<MergeKind, readonly string[]> = {
  table: ['position', 'groupPosition'],
  column: [], index: [], relationship: [], tableGroup: [],
  domain: ['origin'], word: ['origin'], term: ['origin'], customField: ['origin'],
}
```

`(순서)`·`(소속 테이블)`는 파일에 명시적 키가 없고 배열 위치·파일 소속으로 표현되는 것들이다.
충돌 출력에 이 문구가 그대로 나가는 편이 `order`·`tableId`라는 내부 이름보다 정직하다.

이 표가 세 가지를 동시에 한다: **병합 대상 필드 목록**, **충돌 출력의 필드 이름**, **완전성 게이트**.

### 3.2 완전성을 강제하는 두 테스트

1. **분류 완전성** — 각 종류에 대해
   `Object.keys(FILE_FIELDS[k]) ∪ FILE_INVISIBLE_FIELDS[k] === 실제 엔티티 키 집합 − {id}` 이고
   교집합이 비었음을 단언한다. 실제 키 집합은 zod 스키마(`TableSchema.shape` 등)에서 뽑아
   픽스처 드리프트를 없앤다. 엔티티에 새 필드가 생기면 **분류할 때까지 테스트가 깨진다**
   (`model-diff.ts`의 `KIND_ORDER` 완전성 테스트와 같은 선례).
2. **왕복** — 리치 픽스처 모델 `m`에 대해
   `filesToModel(modelToFiles(m).tree).model`의 가시 필드가 `m`의 가시 필드와 일치한다.
   "가시라고 선언했는데 실제로는 파일에 안 써지는" 반대 방향을 잡는다.

`note`는 `MergeKind`에서 제외되어 병합·op 생성 대상이 아니다. 타입 수준에서 제외하므로
"메모를 깜빡하고 지우는" 실수가 컴파일되지 않는다.

### 3.3 `fileVisibleModel`

```ts
/** 서버 모델을 filesToModel이 만드는 값으로 정규화한다 — base·local과 같은 공간에 놓기 위한 것. */
export function fileVisibleModel(model: ProjectModel): ProjectModel
```

`notes: {}`, 모든 테이블 `position:{x:0,y:0}`·`groupPosition:null`,
domain/word/term/customField `origin: null`. 비교는 **전부 이 공간에서만** 한다.

## 4. 병합 엔진 (`packages/core/src/file-merge.ts`)

`resource-sync.ts`와 같은 성격의 순수 함수다. 서버·CLI 어느 쪽에서도 부를 수 있다.

### 4.1 신규 id — 리맵하지 않고 처음부터 최종 id로

트랙 A의 `filesToModel`은 `id`가 없는 객체에 `new:<경로>#<종류>[<i>]` 임시 id를 준다.
push에서 이걸 나중에 uuidv7로 리맵하면 참조 필드(`tableId`·`domainId`·`parentTableId`·
`columnMappings[].childColumnId` …) 중 하나만 빠뜨려도 조용히 깨진다. 그 경로를 만들지 않는다.

```ts
export function filesToModel(tree: FileTree, opts?: { newId?: () => string }): FilesToModelResult
```

`opts.newId`가 있으면 `idOf`가 그것을 부른다. 없으면 기존 `new:` 동작 그대로라 `validate`는
무영향이다. push·diff는 `newId: uuidv7`을 넘겨 **처음부터 최종 id로 모델을 만든다** — 참조는
그 id로 조립되므로 리맵이 아예 필요 없다. base 트리는 항상 서버가 쓴 것이라 id가 다 있어,
base 쪽에서 신규 id가 생길 일은 없다.

`uuidv7` 패키지를 `packages/cli`의 dependency에 추가한다(core는 `zod` 외 의존성 없음 유지).

### 4.2 상태표

id별로 base(`b`) · local(`l`) · server(`s`)의 **가시 payload**를 놓고 판정한다.

| b | l | s | 결과 |
|---|---|---|---|
| ✗ | ✗ | ✓ | 서버가 pull 이후 추가 → 서버 값 유지(op 없음) |
| ✓ | ✗ | ✗ | 양쪽 삭제 → 없음 |
| ✓ | ✗ | `=b` | 로컬 삭제 → **삭제** |
| ✓ | ✗ | `≠b` | **충돌** — 로컬 삭제 / 서버 수정 (`field: '*'`) |
| ✗ | ✓ | ✗ | **생성** |
| ✗ | ✓ | ✓ | 양쪽이 같은 id로 추가. `l=s`면 no-op, 다르면 다른 필드마다 **충돌**(`base: null`) |
| ✓ | ✓ | ✗ | `l=b`면 서버 삭제 수용, 아니면 **충돌** — 로컬 수정 / 서버 삭제 (`field: '*'`) |
| ✓ | ✓ | ✓ | **필드 단위**(4.3) |

### 4.3 필드 단위 판정

`FILE_FIELDS[kind]`의 각 필드 `f`에 대해(`deepEqual` 사용):

- `l[f] = b[f]` → `s[f]` 채택 (로컬이 안 건드림)
- `s[f] = b[f]` → `l[f]` 채택 (서버가 안 건드림)
- `l[f] = s[f]` → 어느 쪽이든 (같은 값으로 수렴)
- 그 외 → **충돌**

배열·객체 값 필드(`index.columns`·`relationship.columnMappings`·`custom`·`dialectTypes`·
`allowedValues`·`options`)는 **통째로 한 값**으로 본다. 배열 안 원소 단위 병합은 하지 않는다.

### 4.4 출력 타입

```ts
export type MergeConflict = {
  path: string          // 'erdd/tables/MBR.yaml' — 사용자가 열어야 할 파일
  kind: MergeKind
  entityId: string
  label: string         // '컬럼 MBR_NM' (DIFF_KIND_LABEL + 표시 이름)
  field: string         // FILE_FIELDS의 값('name'·'(순서)' 등) 또는 '*'
  reason: 'field' | 'local-delete' | 'server-delete' | 'both-added'
  base: string | null   // 표시용 문자열. 없으면 null → 출력에서 '(없음)'
  local: string | null
  server: string | null
}

export type MergeResult = {
  /** 가시 공간의 병합 결과. 충돌이 있으면 충돌 필드는 서버 값을 담는다(사용하지 않는다). */
  merged: ProjectModel
  conflicts: MergeConflict[]
}

export function mergeModels(
  base: ProjectModel, local: ProjectModel, server: ProjectModel,
): MergeResult
```

**표시 값 해석.** `base`·`local`·`server` 문자열은 **각자의 모델 기준**으로 해석한다 — 서버에서
도메인 이름이 바뀌었으면 서버 열에 새 이름이 나온다. 참조형 스칼라 3종만 이름으로 푼다:
`groupId`→그룹명, `domainId`→도메인명, `tableId`/`parentTableId`/`childTableId`→테이블 물리명.
구조형 값(`custom`·`columnMappings`·`index.columns`·`dialectTypes`·`allowedValues`·`options`)은
`JSON.stringify` 결과를 그대로 보여준다. `null`·`''`은 `null`로 정규화해 출력에서 `(없음)`이 된다.

**`path` 해석.** 테이블·컬럼·인덱스는 소속 테이블 파일(`erdd/tables/<tableFileName>`), 관계는
**자식 테이블**의 파일(관계는 자식 파일에만 적힌다), 나머지는 해당 최상위 파일. 파일명은
**local 모델 우선, 없으면 server 모델**로 계산한다(사용자가 실제로 편집하는 트리 기준).

### 4.5 적용 — 서버 모델 위에 얹는다

```ts
export function applyMerge(
  server: ProjectModel, merged: ProjectModel,
): { model: ProjectModel; pruned: PrunedRef[] }
```

`merged`는 가시 공간이라 좌표·`origin`·`notes`가 비어 있다. 그대로 쓰면 안 된다.

1. `notes`는 **서버 것을 그대로** 통과시킨다.
2. 살아남은 엔티티(server에도 있음) = **서버 엔티티에 가시 필드만 덮어쓴다** →
   좌표·`groupPosition`·`origin`이 보존된다.
3. 신규 엔티티(server에 없음) = merged 엔티티 + 비가시 필드 기본값(`origin: null`).
   신규 **테이블**만 좌표를 받는다(4.6).
4. server에만 있고 merged에 없는 것 = 삭제.
5. `pruneDangling` — 삭제로 매달리게 된 참조를 정리한다.

**5가 필요한 실제 케이스:** 서버가 pull 이후 `ORD → MBR` 관계를 추가했고(base✗ local✗ server✓
→ 유지), 로컬이 `MBR.yaml`을 지웠다(→ 삭제). 그대로 두면 관계가 사라진 테이블을 가리켜
FK 위반으로 500이 난다. `pruneDangling`은 (a) 존재하지 않는 테이블을 가리키는 컬럼·인덱스·관계,
(b) 존재하지 않는 컬럼을 가리키는 인덱스 항목·관계 매핑을 제거하고 무엇을 지웠는지 돌려준다.
지워진 것은 삭제 확인 목록에 **함께 표시**한다.

> 로컬 파일만으로는 이 상태가 만들어지지 않는다 — `MBR.yaml`이 없으면 `ORD.yaml`의
> `to: MBR`이 `filesToModel`에서 파싱 오류가 되어 push가 먼저 거부한다. 서버 쪽 추가와
> 로컬 쪽 삭제가 만나는 경우에만 생긴다.

최종 op는 `diffModels(server, applied)` — **불가침 함수를 그대로 재사용**하고 새 op 생성 경로를
만들지 않는다. `notes`와 좌표가 양쪽에서 동일하므로 그 op는 나오지 않는다.

### 4.6 신규 테이블 좌표

```ts
export function gridPositions(server: ProjectModel, count: number): Position[]
```

서버 테이블들의 bbox를 구해 `maxY + GAP`부터 시작, `minX`를 기준으로 가로 `COLS`개씩 격자로
놓는다(`COLS = 4`, 가로 간격 320, 세로 간격 240). 서버에 테이블이 없으면 `(0,0)`부터.
신규 테이블에는 **id 오름차순**으로 배정해 같은 입력이면 같은 좌표가 나오게 한다.
순수 함수이므로 좌표 산식 자체를 테스트로 고정한다.

## 5. 서버 변경

### 5.1 `runMutation`의 `deriveOps` 시그니처 확장

```ts
deriveOps: (model: ProjectModel, seq: number) => Op[]
```

`runMutation` 안에서 `currentSeq` 호출을 `deriveOps` 위로 올린다. 둘 다 같은 락 안의 읽기라
순서는 무관하다. 기존 호출자 2곳(`model.mutate`·`snapshot.restore`)은 두 번째 인자를 무시하므로
무영향이다. `mutateAndPublish`도 그대로 통과시킨다.

> ⚠️ HANDOFF §5가 경고하는 **"이번 브랜치에서 두 번째 호출자가 생긴 기존 함수"**에 정확히
> 해당한다. 최종 리뷰 프롬프트에 이 함수를 명시한다.

### 5.2 `model.push`

```ts
push: apiProcedure                                  // 토큰 allowlist 6번째
  .input(z.object({
    projectId: z.string().uuid(),
    expectedSeq: z.number().int().min(0),           // 필수
    ops: z.array(z.unknown()).min(1).max(MAX_OPS_PER_MUTATION),
    summary: z.string().min(1).max(200).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx.db, input.projectId, ctx.user.id, 'edit')
    const ops = parseOps(input.ops)                 // OpParseError → BAD_REQUEST
    return await mutateAndPublish(ctx.db, ctx.hub, {
      projectId: input.projectId,
      actorUserId: ctx.user.id, actorName: ctx.user.name,
      source: 'cli',                                // 웹과 구분되어 Revision에 남는다
      deriveOps: (_model, seq) => {
        if (seq !== input.expectedSeq) {
          throw new TRPCError({ code: 'CONFLICT', message: `서버가 앞서 있습니다 (기대 ${input.expectedSeq}, 현재 ${seq})` })
        }
        return ops
      },
      summary: input.summary,
    })
  })
```

락 안에서 던지므로 트랜잭션이 롤백된다. `model.mutate`는 `authedProcedure`(세션 전용) 그대로다.
오류 매핑은 `model.mutate`와 동일하다 — `OpParseError`·`OpApplyError`를 `BAD_REQUEST`로 감싼다.

**서버 테스트(실 DB):**
- `expectedSeq`가 맞으면 반영되고 Revision `source='cli'`로 남는다
- `expectedSeq`가 어긋나면 `CONFLICT`이고 **모델이 변하지 않는다**(롤백 확인)
- 토큰으로 `model.push`는 되고 `model.mutate`는 `UNAUTHORIZED`다(allowlist 경계 회귀)
- Viewer 토큰은 `FORBIDDEN`이다
- 반영이 실시간 채널로 발행된다(`mutateAndPublish` 경유 확인)

## 6. CLI 변경

### 6.1 `client.ts` — POST와 CONFLICT

지금은 GET `query`뿐이다. `mutate(path, input)`를 추가한다
(`POST /trpc/<path>`, `content-type: application/json`, body = input).
`CODE_MAP`에 `CONFLICT: 'CONFLICT'`를 넣고 `CliErrorCode`에 `'CONFLICT'`를 추가한다(종료 코드 1).

### 6.2 `syncDown` 추출

`pull`의 "서버에서 받아 트리·base·sync·config를 쓰는" 부분을 `commands/sync-down.ts`로 뽑는다.
`pull`과 `push`(성공 후 암묵적 pull)가 공유한다. 트랙 A가 주석으로 고정한 **네 쓰기의 순서**
(트리 → base → sync → config)는 그대로 유지한다.

### 6.3 `push`

```
1.  readConfig · readTree · readBase
    · erdd/ 자체가 없으면(readTree 결과가 비었고 base에는 파일이 있음)
      "전부 삭제"로 해석하지 않고 거부 — rm -rf 사고 방지
    · base가 없으면 "먼저 erdd pull을 실행하세요"
2.  filesToModel(local, { newId: uuidv7 }) — ok:false면 validate와 같은 형식으로 VALIDATION 오류
3.  filesToModel(base) — base는 항상 서버가 쓴 트리라 id가 완전하다
4.  client.query('model.get') → { model: server, seq }
5.  mergeModels(base, local, fileVisibleModel(server))
6.  conflicts.length > 0 → 블록형 출력 + exit 1
7.  applyMerge(server, merged) → { model, pruned }
8.  ops = diffModels(server, applied)
9.  ops.length === 0 → '변경 없음' + exit 0
10. 삭제 op가 있으면 목록(+ pruned) 출력 후 확인 — --yes면 생략
11. ops.length > MAX_OPS_PER_MUTATION → 서버에 보내기 전에 막고 안내 (§3.2 선례)
12. client.mutate('model.push', { projectId, expectedSeq: seq, ops, summary })
    · CONFLICT면 4부터 1회 자동 재시도. 두 번째도 CONFLICT면 실패
13. syncDown() — 신규 id가 파일에 채워지고 다음 status가 깨끗해진다
14. emit
```

`summary`는 `-m/--message`로 받고, 없으면 `CLI push (테이블 3건 · 컬럼 12건)` 형태로 자동 생성한다.

**충돌 출력(사람용).**

```
충돌 2건 — push를 중단했습니다.

erdd/tables/MBR.yaml
  컬럼 MBR_NM · logicalName
    기준  회원명
    로컬  회원 이름
    서버  회원성명
  테이블 MBR · comment
    기준  (없음)
    로컬  서비스 가입 회원
    서버  가입 회원 마스터

erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.
```

파일 경로로 그룹핑하고 경로 오름차순, 그룹 안은 `label` 오름차순으로 정렬한다.
`field`가 `'*'`인 항목은 필드명 대신 `reason` 문구를 쓴다 —
`local-delete` → `로컬에서 삭제, 서버에서 수정`, `server-delete` → `로컬에서 수정, 서버에서 삭제`.
(`both-added`는 필드 단위로 나오므로 `'*'`가 아니다.)

**`--json`.**

```json
{ "ok": false, "conflicts": [ { "path":"…","kind":"column","entityId":"…","label":"컬럼 MBR_NM",
  "field":"logicalName","reason":"field","base":"회원명","local":"회원 이름","server":"회원성명" } ] }
```

성공 시:

```json
{ "ok": true, "revisionSeq": 43, "ops": 17,
  "created": {"table":1,"column":5}, "updated": {"column":3}, "deleted": {"index":1},
  "pruned": [], "retried": false }
```

### 6.4 `diff`

`push`의 1~5와 동일하게 계획을 세우고 출력만 한다(서버 호출은 `model.get` 1회, 쓰기 없음).

```
올릴 변경 3건
  + 테이블 PAY
  M 컬럼 MBR.MBR_NM  logicalName: 회원명 → 회원 이름
  - 인덱스 MBR.IX_MBR_02

내려올 변경 1건
  M 테이블 ORD  comment: (없음) → 주문 마스터

충돌 없음
```

- 올릴 변경 = `diffModelsForDisplay(base, local)`
- 내려올 변경 = `diffModelsForDisplay(base, fileVisibleModel(server))`
- 충돌 = `mergeModels`의 결과, push와 같은 블록형

세 모델 모두 가시 공간이라 좌표·메모 잡음이 없다. 기본 exit 0, `--strict`면 충돌이 있을 때 1
(`validate`의 선례). `--json`은 `{ ok, up:[…], down:[…], conflicts:[…] }`.

### 6.5 `skill install`

`packages/cli/skill/SKILL.md`를 동봉하고 `.claude/skills/erdd/SKILL.md`로 복사한다.

- 원본은 `fileURLToPath(import.meta.url)` 기준 상대 경로로 찾는다(CLI는 빌드 없이 tsx로 돈다)
- `--dir <경로>`로 설치 위치 재지정
- 대상이 이미 있으면 `--force` 없이는 덮어쓰지 않고 안내 후 exit 1
- `package.json`의 `files`에 `skill`을 넣는다(지금은 `private: true`라 무해하지만 배포 시 필요)

**SKILL.md 내용:**

```
---
name: erdd
description: Use when reading or changing this project's database schema — the ER model
  lives as YAML under erdd/ and syncs with the ERDD server via the erdd CLI.
---
```

본문(한국어):
1. **구조 파악** — `erdd/tables/*.yaml` 한 파일이 한 테이블. `groups`·`words`·`terms`·
   `domains`·`custom-fields`.yaml. 스키마를 알아야 하면 코드를 뒤지지 말고 이 파일들을 읽는다
2. **워크플로** — `erdd pull` → 파일 수정 → `erdd validate` → `erdd diff` → `erdd push`
3. **물리명 짓기** — 새 컬럼·테이블의 물리명은 임의로 만들지 않는다. `terms.yaml`에서 논리명이
   일치하는 용어를 찾아 그 `physicalName`을 쓰고, 없으면 `words.yaml`의 단어를 조합한다.
   조합에 쓸 단어가 사전에 없으면 `words.yaml`에 함께 추가한다(`erdd validate`가 미등록 단어를
   경고로 잡는다)
4. **도메인·커스텀 항목** — 컬럼 타입은 가능하면 `domain`으로 지정한다. `custom-fields.yaml`에
   `required: true`인 항목이 있으면 값을 반드시 채운다
5. **하지 말 것** — `id` 수정/삭제(서버 발급 identity다), 테이블 파일명 임의 변경(push 대상이
   아니라 pull이 갱신한다), `.erdd/` 편집(내부 상태다), 좌표·메모를 파일에서 찾기(파일에 없다)
6. **자동화** — 모든 명령이 `--json`을 지원한다. 종료 코드 0 성공 · 1 실패 · 2 사용법 오류.
   충돌이 나면 `erdd pull` 후 파일에서 정리하고 다시 push한다

## 7. 파일 구조

| 파일 | 책임 |
|---|---|
| `packages/core/src/file-merge.ts` (신규) | `FILE_FIELDS`·`FILE_INVISIBLE_FIELDS`·`fileVisibleModel`·`mergeModels`·`applyMerge`·`pruneDangling`·`gridPositions` |
| `packages/core/src/file-format.ts` | `filesToModel`에 `opts.newId` 추가 |
| `packages/core/src/index.ts` | 신규 export |
| `apps/server/src/services/mutation.ts` | `deriveOps(model, seq)` |
| `apps/server/src/services/mutate-publish.ts` | 통과 |
| `apps/server/src/routers/model.ts` | `push` 추가 |
| `packages/cli/src/client.ts` | `mutate()` |
| `packages/cli/src/output.ts` | `CONFLICT` 코드 |
| `packages/cli/src/commands/sync-down.ts` (신규) | pull/push 공용 내려받기 |
| `packages/cli/src/commands/push.ts` (신규) | push |
| `packages/cli/src/commands/diff.ts` (신규) | diff |
| `packages/cli/src/commands/conflict-report.ts` (신규) | 블록형 충돌 렌더 (push·diff 공용) |
| `packages/cli/src/commands/skill.ts` (신규) | skill install |
| `packages/cli/skill/SKILL.md` (신규) | 에이전트 스킬 본문 |
| `packages/cli/src/main.ts` | 배선·도움말 |
| `docs/16-cli.md`, `docs/91-checklist.md`, `docs/superpowers/HANDOFF.md` | 갱신 |

## 8. 테스트 전략

**core (`file-merge.test.ts`)**
- 분류 완전성(§3.2 ①) — zod `shape`에서 실제 키를 뽑아 대조
- 왕복(§3.2 ②)
- `fileVisibleModel`이 메모·좌표·origin을 정규화한다
- 상태표 8행 각각(§4.2)
- 필드 단위 4분기(§4.3) — 특히 **서로 다른 필드를 고치면 자동 병합**되고 **같은 필드를 다르게
  고치면 충돌**임을 한 쌍으로
- `applyMerge`가 **좌표·origin·notes를 보존**한다 — 이 한 건이 이 설계의 이유다
- `pruneDangling`이 서버-추가 관계 + 로컬-삭제 테이블 조합을 정리한다
- `gridPositions` 좌표 산식
- `diffModels(server, applyMerge(...).model)`이 **좌표·메모 op를 만들지 않는다**(통합)
- `filesToModel(tree, { newId })`가 참조까지 최종 id로 조립한다

**server (`model-push.test.ts`, 실 DB)** — §5.2의 5건

**cli**
- `push`: 충돌 시 exit 1이고 **`model.push`를 호출하지 않는다**(충돌을 알려면 `model.get`은 부른다), 변경 없음 exit 0,
  삭제 확인 거부 시 `CANCELLED`, `CONFLICT` 1회 재시도 후 성공, 두 번 연속 `CONFLICT`면 실패,
  성공 후 트리·base·sync가 갱신된다, op 상한 초과를 클라가 막는다, `erdd/` 부재 거부
- `diff`: 세 묶음 출력, `--strict` 종료 코드, `--json` 스키마
- `conflict-report`: 블록형 렌더(그룹핑·정렬·`(없음)`·`reason='*'` 문구)
- `skill install`: 설치, 기존 파일 보호, `--force`, `--dir`

**⚠️ 테스트 구분력 실증.** 각 테스트가 지키는 프로덕션 코드를 되돌려 실제로 실패하는지
컨트롤러가 직접 확인한다(HANDOFF §5). 특히 `applyMerge`의 보존 로직과 `pruneDangling`은
"통과하지만 아무것도 검증하지 않는" 테스트가 되기 쉽다.

## 9. 알려진 한계 (이월 후보)

- 배열 안 원소 단위 병합 없음 — `index.columns` 한 원소만 달라도 필드 전체가 충돌한다
- 충돌의 대화형 해소 없음 — pull 후 파일에서 손으로 정리한다
- 한 push가 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 거부한다. 대규모 최초 push(300테이블+)는
  청크가 필요한데 "단일 Revision = undo 1회" 계약과 상충하므로 별도 설계 대상이다
- `push`가 `notes`·좌표·`origin`을 절대 건드리지 않는다 — 파일에서 메모를 관리할 수 없다
- `--json` 실패 응답이 `{error:{code,message}}`와 `{ok:false,conflicts:[…]}` 두 형태다.
  충돌은 오류가 아니라 **계획 결과**라 후자를 쓴다(exit 1은 동일)
- `expectedSeq` 재시도는 1회다. 매우 활발한 프로젝트에서는 반복 실패할 수 있다
- `skill install`은 Claude Code 형식만 낸다(`AGENTS.md`는 범위 밖)
