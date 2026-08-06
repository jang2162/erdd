# CLI push 멱등성 설계 — 신규 id를 로컬 파일에 고정한다

**작성일:** 2026-08-05
**상태:** 승인됨 (brainstorming 3문항 모두 권장안 채택)
**선행 설계:** [CLI push](2026-08-04-cli-push-design.md) — 이 설계는 그 §9 마지막 항목("`push`는 신뢰할 수 없는 전송로 위를 지나는 비멱등 쓰기다")을 채운다

## 1. 목적과 범위

`erdd push`가 서버에 커밋된 뒤 **응답만 유실되면**(TCP reset·프록시 타임아웃·커밋 직후 재시작) 다음
push가 경고 없이 **같은 것을 하나 더 만든다.** 이월 항목 중 유일하게 데이터를 잘못 만드는 것이다.

원인은 한 줄이다 — `plan.ts:42`의 `filesToModel(localTree, { newId: uuidv7 })`이 **호출마다 새 uuid를
발급하고 그것을 어디에도 남기지 않는다.** 첫 push가 커밋한 서버 엔티티는 id `A`를 갖고, 다음 push의
같은 파일 항목은 id `B`를 받는다. 3-way 병합은 둘을 별개 엔티티로 보므로 `A`는 "서버 전용(유지)",
`B`는 "로컬 전용(생성)"이 되어 사본이 태어난다.

**범위:** core `filesToModel`이 "id를 채운 트리"를 함께 내는 것 · CLI `push`가 전송 직전 그 트리의
변경분을 파일에 기록하는 것 · 실패 보고 문구 갱신 · `HANDOFF.md`의 낡은 이월 항목 정정(§8).

**범위 밖:** 서버 멱등 키(`revisions.request_id`, §2.1) · 전송 실패 시 자동 재시도(§2.5) ·
push 설계 §9의 나머지 한계(배열 원소 단위 병합, 대화형 충돌 해소, `MAX_OPS_PER_MUTATION` 청크,
`expectedSeq` 재시도 횟수, `notes`·좌표·`origin` 미취급).

**서버 변경 없음. 마이그레이션 없음. 새 op 엔티티 없음. 새 런타임 의존성 없음.**

## 2. 확정된 결정 (사용자 확정)

### 2.1 멱등성의 기반은 로컬 파일에 기록한 id다 — 서버 멱등 키가 아니다

서버 멱등 키(요청 id를 `revisions`에 기록해 재전송을 같은 리비전으로 흡수)는 **같은 요청을 그대로 다시
보낼 때만** 통한다. 사용자가 나중에 `erdd push`를 다시 실행하면 CLI가 새 요청 id와 새 uuid를 만들므로
서버는 중복인 줄 알 수 없다 — **문제가 닫히지 않는다.** 마이그레이션까지 딸려 온다.

로컬 id 고정은 반대 방향으로 닫는다. `buildPlan`이 `model.get`으로 **서버 상태를 다시 읽어** 계획을
새로 만들기 때문에, 신규 id만 안정되면 재실행이 저절로 수렴한다. update·delete는 원래부터 서버 상태
기준으로 재계산되므로 이미 멱등이다 — **고칠 지점은 신규 id의 안정성 하나뿐이다.**

### 2.2 기록은 사용자가 만든 원래 파일 경로에 한다

`tableFileName`(`file-format.ts:24`)은 물리명으로 파일명을 정하고, **물리명이 겹치면 id 뒷자리를
파일명에 넣는다.** 그리고 `filesToModel`은 파일명과 `name` 필드의 일치를 강제하지 않는다 —
`erdd/tables/새테이블.yaml` 안에 `name: MBR`이 정상이다.

그러므로 `modelToFiles`가 내는 **정규 경로에 기록하면 안 된다.** 그랬다가는 같은 테이블이 두 파일에
존재하게 되고, 다음 `filesToModel`이 `idOf`의 중복 검사로 "id가 …에도 있습니다"를 내며 push 자체가
막힌다. 원래 경로에 기록하면 파일명은 그대로고 내용에 `id` 한 줄만 는다. 성공하면 `syncDown`이 어차피
정규 파일명으로 재작성하고 옛 파일을 지운다.

### 2.3 id를 채우는 주체는 `filesToModel` 자신이다 — 별도 순회 함수를 만들지 않는다

id가 빠질 수 있는 자리는 9곳(`groups`·`domains`·`words`·`terms`·`customFields`·`table`·`columns`·
`indexes`·`relations`)이고 **전부 `idOf` 하나를 지난다.** 별도 `assignMissingIds`를 두면 그 순회가
`filesToModel`과 갈릴 수 있다 — 새 파일 종류나 새 배열이 붙을 때 한쪽만 고쳐지면 조용히 빈 자리가
생기고, 그 자리는 정확히 "매번 새 id를 받는" 자리라 원래 버그가 부분적으로 되살아난다.

`idOf`가 발급하는 그 자리에서 되써 넣으면 복제가 없어 구조적으로 갈릴 수 없다.

### 2.4 기록 시점은 삭제 확인 뒤 · 전송 직전이고, 실패해도 지우지 않는다

- **`confirmDeletes` 뒤**: 사용자가 삭제 확인에서 취소했는데 파일이 바뀌면 안 된다.
- **`model.push` 직전**: 그 뒤로는 전송 결과와 무관하게 파일이 id를 쥐고 있어야 한다.
- **기록 실패 시 전송하지 않고 중단**: id를 못 남긴 채 보내면 원래 문제 그대로다.
- **push가 실패해도 지우지 않는다**: `outcomeUnknown`에서 지우면 바로 그 순간 사본 문제가 부활한다.
  실패 종류별로 정리 여부를 가르는 것은 위험만 늘린다. 남아 있어도 다음 push가 그 id로 정상 생성하므로
  손해가 없다.
- **`erdd diff`는 기록하지 않는다** — 계획 미리보기라 파일을 건드리지 않는 것이 계약이다.

**CONFLICT 재시도에서는 위 첫 항목과 넷째 항목이 부딪힌다. 넷째가 이긴다.**
첫 시도에서 사용자가 삭제를 확인 → `reserveIds`가 id를 기록 → `model.push`가 CONFLICT → 재계산 →
**두 번째 삭제 확인에서 취소**하면, 취소했는데도 파일에는 id가 남는다(2026-08-06 실측: exit 1
`{"error":{"code":"CANCELLED"}}`, `MBR.yaml`에 신규 컬럼 id 있음). 첫 항목이 막으려던 것은 "확인 화면을
한 번도 통과하지 않았는데 파일이 바뀌는 것"이고, 그 계약은 그대로다 — 여기서는 사용자가 첫 확인을
**통과시켰고** 그 시점의 기록은 정당했다. 되돌리면 넷째 항목이 막는 사본 문제가 정확히 부활한다
(다음 push가 같은 항목에 새 id를 발급한다). 삭제 자체는 서버로 나가지 않았으므로 손해는 없다 —
파일에 서버가 모르는 id가 하나 남을 뿐이고, 그것은 §3.2가 정상이라고 적은 상태다.
`push.test.ts`의 `CONFLICT 재계산 뒤 삭제 확인에서 취소해도 첫 시도가 기록한 id는 남는다`가 이 상태를
고정한다(기존 취소 테스트는 첫 시도 취소만 덮는다).

### 2.5 전송 실패 시 자동 재시도는 넣지 않는다

동작은 지금대로 두고 **보고 문구만 바꾼다**("다시 push하면 중복 없이 수렴합니다"가 이제 참이다).
자동 재계산+재시도는 재계산 결과가 달라졌을 때의 삭제 확인 재질의, 서버가 죽은 경우의 대기 같은
분기를 부르는데, 사용자가 `erdd push`를 다시 치면 같은 수렴이 일어나므로 이득이 작다. exit 1은 유지한다.

## 3. 의미 모델

### 3.1 왜 로컬 id 고정만으로 닫히는가

첫 push의 세 가지 결말이 전부 같은 곳으로 수렴한다. 파일에는 어느 경우에도 id `A`가 기록돼 있다.

| 첫 push의 결말 | 다음 `erdd push`가 하는 일 | 결과 |
|---|---|---|
| 커밋됨 + 응답 유실 | `model.get`에 `A`가 이미 있다 → create 없음 | op 0건 "변경 없음" |
| 커밋 안 됨(전송 실패) | `model.get`에 `A`가 없다 → `A`로 create | 정상 반영 |
| 커밋됨 + `syncDown` 실패 | 첫 줄과 같다 | op 0건 "변경 없음" |

**핵심은 다음 push가 이전 계획을 재사용하지 않는다는 점이다.** 계획은 매번 서버를 다시 읽어 새로
만든다. 안정된 것은 id뿐이고, 그것으로 충분하다.

### 3.2 기록된 id가 서버에 없는 상태는 정상이다

기록 후 push가 실패하면 로컬에 서버가 모르는 id가 남는다. 이 id는 `.erdd/base.json`에 없으므로
`status`가 "로컬 변경"으로 표시한다 — **맞는 표시다**(실제로 반영되지 않은 로컬 작업이다).
`validate`도 통과한다(id 형식 검사가 없고 참조는 로컬 안에서 닫힌다).

### 3.3 `idOf`의 id 중복 검사와 충돌하지 않는다

`firstUse` 검사는 파일에 적힌 explicit id를 대상으로 한다. 기록 이후 그 id는 explicit이 되어 검사
대상에 들어가지만, 한 파일에 한 번만 있으므로 통과한다.

**같은 객체를 두 번 지나는 것은 참조 동일성으로 잡는다** — `idOf`가 지나간 객체를 `WeakSet`에 담고
재방문이면 issue를 낸다. YAML anchor/alias(`&이름` … `*이름`)는 배열의 두 원소를 **같은 객체 하나**로
파싱하고 `structuredClone`이 그 공유를 그대로 보존하므로, 잡지 않으면 **두 항목이 조용히 한 항목으로
합쳐진 채 `ok:true`가 나간다**(실측: 컬럼 2개 → 1개). 되쓰기 이전에는 두 방문 모두
`explicit === null`이라 각자 임시 id를 받아 정상이었으므로, 이것은 이번 변경이 만드는 회귀다.

**참조 동일성으로 보는 이유**(2026-08-06 리뷰 I-4). 처음에는 "발급한 id도 `firstUse`에 등록해 두 번째
방문이 explicit으로 읽게 한다"로 구현했는데, 그 판별은 **되쓰기가 있는 `newId` 갈래에서만** 성립한다.
그래서 같은 파일을 `erdd push`는 거절하고 `erdd validate`는 `ok:true`로 통과시켰다(실측). push의 파일
오류 문구가 "erdd validate로 확인하세요"라고 그 명령을 가리키므로, 지시를 따른 사용자·에이전트가
"문제 없음"을 받고 막히는 형태였다. 참조 동일성은 id와 무관하게 직접 보이므로 두 갈래가 같은 판정을
낸다. `firstUse`는 다시 **사용자가 파일에 적은 explicit id**만 다루는 원래 역할로 돌아간다.

**순환이 아닌 공유는 대상이 아니다.** `idOf`를 지나지 않는 자리(두 도메인이 같은 `dialectTypes` 매핑을
alias로 나눠 쓰는 것 같은)는 합쳐질 id가 없으므로 통과한다 — §9의 이월 항목이다.

공유 참조를 끊는 재귀 복사는 **채택하지 않는다.** 순환 보존 memo가 곧 공유 참조 보존이라 "공유는 끊고
순환은 살린다"가 원리적으로 불가능하고, 무엇보다 `yaml.stringify`가 공유 참조를 다시 anchor/alias로
내보내므로 참조를 끊으면 `reserveIds`가 사용자의 alias 파일을 전개형으로 덮어쓴다 — 조용한 데이터 손실이
조용한 파일 파괴로 바뀔 뿐이다.

**충돌 메시지는 세 갈래다.**

| 상황 | 메시지 |
|---|---|
| 같은 객체를 두 번 지났다(anchor/alias) | anchor/alias를 지원하지 않음을 알리고 별칭을 풀라고 안내 |
| 같은 파일 안에서 explicit id 중복 | "id는 하나만 가질 수 있습니다" |
| 다른 파일에도 같은 explicit id | "복사해서 새로 만든 것이라면 id를 지우세요" |

alias 갈래에 전용 메시지가 필요한 이유는, 사용자 파일에 **지울 id 자체가 없을 수 있기** 때문이다
(id 없는 항목을 alias로 재사용한 경우) — 기존 두 메시지는 실행 불가능한 지시가 된다.

단, **사용자가 그 파일을 복사해 새 테이블을 만들면** 이제 id가 들어 있어 "복사해서 새로 만든 것이라면
id를 지우세요" 오류가 뜬다. 이는 pull 직후 파일을 복사했을 때와 **완전히 같은 기존 동작**이고, 그
안내가 바로 올바른 지시다.

## 4. core

### 4.1 `filesToModel`이 id를 채운 트리를 함께 낸다

```ts
export type FilesToModelResult =
  | { ok: true; model: ProjectModel; warnings: FileIssue[]; assignedTree?: FileTree }
  | { ok: false; issues: FileIssue[] }
```

구현은 좁다. `filesToModel` 안에서 입력 `tree`를 읽는 곳은 **3곳뿐이다**(`readList`의 `tree[path]`,
`tablePaths`의 `Object.keys(tree)`, 테이블 순회의 `tree[path]` — 현재 284·362·366행).

1. 진입부에서 `const src = newId === undefined ? tree : structuredClone(tree)`.
2. 그 3곳의 `tree`를 `src`로 바꾼다.
3. `idOf`가 **먼저 재방문을 걸러 내고**(§3.3), 그 다음 id를 발급할 때 그 자리에 되써 넣는다:
   ```ts
   if (visited.has(r)) {                    // YAML alias가 같은 항목을 두 번 지나는 것을 잡는다
     issues.push({ path, message: /* anchor/alias 안내 */ })
     return `${NEW_ID_PREFIX}${path}#${kind}[${index}]`
   }
   visited.add(r)
   const explicit = asStr(r['id'])
   if (explicit === null) {
     if (newId === undefined) return `${NEW_ID_PREFIX}${path}#${kind}[${index}]`
     const id = newId()
     r['id'] = id          // r은 src 안의 객체다 — 입력 tree는 그대로다
     return id
   }
   ```
   재방문 검사가 `newId` 갈래 **바깥**에 있는 것이 핵심이다 — `validate`와 `push`의 판정이 갈리지
   않는다(§3.3).
4. 성공 갈래에 `assignedTree: newId === undefined ? undefined : src`.

- **입력 `tree`는 변형하지 않는다.** 복사본에만 쓴다.
- **`ok:false`에는 담지 않는다.** 파싱이 실패한 트리에 id를 기록할 이유가 없고, 담으면 CLI가 그것을
  쓸 수 있다고 오해할 여지가 생긴다.
- **`newId`가 없으면 복사하지 않는다.** pull·validate·base 파싱에는 되쓸 것이 없으므로 큰 트리를
  통째로 복사할 이유가 없다. 무조건 복사로 바뀌는 성능 회귀는 눈에 보이지 않으므로 테스트로 잠근다
  (`vi.spyOn(globalThis, 'structuredClone')` → "호출되지 않는다", §7.1).
- `structuredClone`은 전역 함수라 core의 "IO·런타임 의존성 free" 규칙에 걸리지 않는다. **JSON 왕복이
  아닌 이유는 yaml이 JSON으로 표현되지 않는 값을 내기 때문이다** — core 스키마의 `.inf`/`.nan`은
  `Infinity`/`NaN`이 되는데 JSON 왕복은 그것을 `null`로 뭉갠다. anchor/alias가 만든 순환 참조
  (`root: &a {self: *a}`)에서는 `JSON.stringify`가 아예 던진다.
  ~~`Date`(타임스탬프 스칼라)를 보존하기 위해서다~~ — **거짓이다.** `yaml@2.9.0`의 기본 core 스키마
  (YAML 1.2)는 타임스탬프를 **문자열로** 낸다(`Date`가 되려면 `version: '1.1'`이나 `!!timestamp` 태그가
  필요한데 둘 다 쓰지 않는다). 2026-08-06 실측으로 확인해 근거를 위 두 가지로 정정했다 — `structuredClone`을
  쓰는 선택 자체는 그대로다.
  현재 `tsconfig.base.json` 아래에서 타입이 잡히는 것을 확인했다(2026-08-05, core `typecheck` EXIT=0).

**키 순서:** 새 `id`는 객체의 **맨 뒤**에 붙는다(`modelToFiles`는 맨 앞에 둔다). 값 구조는 같고
`canonical()` 비교는 키 순서를 무시하므로 무해하다. 앞으로 옮기려면 객체를 재구성해야 하는데 그러면
사용자가 쓴 다른 키의 순서까지 흔들리므로 **하지 않는다.** 성공하면 `syncDown`이 정규화한다.

## 5. cli

### 5.1 `PushPlan`에 `localTree`·`assignedTree` (`plan.ts`)

`buildPlan`은 **아무것도 쓰지 않는다** — `erdd diff`도 같은 함수를 쓰기 때문이다. 읽어 온 로컬 트리와
`localResult.assignedTree`를 계획에 실어 보내기만 한다.

### 5.2 `reserveIds` (`packages/cli/src/commands/reserve-ids.ts`, 신규)

```ts
export async function reserveIds(
  cwd: string, local: FileTree, assigned: FileTree | undefined,
): Promise<string[]>   // 실제로 기록한 파일 경로들
```

- `assigned`가 `undefined`면 아무것도 하지 않고 `[]`를 낸다.
- `canonical(local[rel]) !== canonical(assigned[rel])`인 파일만 고른다 — id가 실제로 늘어난 파일만이다.
- 고른 파일만 `stringifyYaml` 후 쓰고 **fsync**한다(`node:fs/promises`의 `open`/`writeFile`/`sync`/`close`).
- **`writeTree`를 쓰지 않는다.** 그 함수의 삭제·개명 패스가 돌면 §2.2가 막으려는 일이 그대로 일어난다.
- 실패는 그대로 던진다 → `run()`이 감싸고 push는 전송에 이르지 못한다.

`canonical`은 현재 `tree.ts`의 비공개 함수다 → **export한다**(`diffTrees`가 이미 쓰는 같은 비교다).

### 5.3 `push`에 한 줄 삽입 + 보고 문구 갱신 (`commands/push.ts`)

```
buildPlan → [conflicts / op 0건 / 상한 조기반환] → confirmDeletes
  → reserveIds ← 신규 → model.push → syncDown
```

CONFLICT 재시도(`continue`)는 손대지 않는다 — 두 번째 `buildPlan`이 방금 기록된 id를 파일에서 읽으므로
재시도 경로도 저절로 안정된다.

문구:

- `outcomeUnknown`: "다시 push하기 전에 erdd pull 또는 erdd diff로 서버 상태를 확인하세요" →
  **`reservedFiles`의 유무로 두 갈래를 낸다.**
  - 기록한 파일이 있으면: "신규 항목의 id를 파일에 기록해 두었으므로 그대로 다시 push하면 중복 없이
    수렴합니다."
  - 없으면(update만 있는 push): "그대로 다시 push하면 중복 없이 수렴합니다."만 남긴다. 기록한 것이
    없는데 "기록해 두었으므로"라고 말하면 근거가 거짓이라, 바뀌지도 않은 파일을 확인하러 가게 된다.

  뒤이어 붙는 확인 안내는 **`erdd diff`를 권하고 `erdd pull`의 대가를 함께 말한다.** `pull`은 반영되지
  않았을 경우 서버 상태로 트리를 다시 써서(`writeTree`의 삭제 패스) 방금 기록한 id째로 로컬 변경을
  지우므로, 같은 문장의 "그대로 다시 push하면 수렴한다"를 스스로 무효화한다. `diff`는 읽기만 한다.
- `committed:true`(syncDown 실패): 기존 "erdd pull을 실행하세요"를 유지한다(반영이 확정된 경우라
  안내가 이미 정확하다 — 서버가 진실이므로 덮어써도 잃을 것이 없다).
- 두 JSON 봉투와 성공 봉투에 `reservedFiles: string[]`을 더한다 — 에이전트가 무엇이 바뀌었는지 안다.
  **재시도 뒤에만 닿는 두 종료 경로에도 싣는다**: conflicts 봉투와 op 상한 초과. 둘 다 첫 시도가 이미
  파일을 재작성한 뒤에 도달할 수 있다. 상한 초과는 던져서 끝나 자기 봉투가 없으므로
  `CliError`의 `details`로 실어 `{"error":{code,message,reservedFiles}}`가 되게 한다.

## 6. 파일 구조

| 파일 | 변경 |
|---|---|
| `packages/core/src/file-format.ts` | `FilesToModelResult`에 `assignedTree`, `src` 복사본 순회, `idOf` 되쓰기 |
| `packages/core/src/file-format.test.ts` | §7.1 |
| `packages/cli/src/plan.ts` | `PushPlan`에 `localTree`·`assignedTree` |
| `packages/cli/src/tree.ts` | `canonical` export |
| `packages/cli/src/commands/reserve-ids.ts` | 신규 |
| `packages/cli/src/commands/reserve-ids.test.ts` | 신규, §7.3 |
| `packages/cli/src/commands/push.ts` | `reserveIds` 호출 · 문구 · JSON 봉투 |
| `packages/cli/src/commands/push.test.ts` | §7.2 |
| `docs/superpowers/HANDOFF.md` | §8 |
| `docs/superpowers/specs/2026-08-04-cli-push-design.md` | §9 해당 항목에 해소 표시 |

## 7. 테스트 전략

### 7.1 core — `file-format.test.ts` (+10)

1. **완전성 + 동일성** — 9종 전부에 id 없는 항목이 있는 트리를 `filesToModel(tree, {newId})`에 넣고,
   나온 `assignedTree`를 **`newId` 없이** 다시 `filesToModel`에 넣으면 (a) 모델의 **모든 엔티티 id에
   `NEW_ID_PREFIX`가 하나도 없고**, (b) 그 **id 집합이 첫 모델의 id 집합과 같다.**
   (a)는 자리를 빠뜨렸는지를 잡는다 — 임시 id는 정확히 "id가 없는 자리"의 표식이기 때문이다.
   **(b)가 이 커밋의 유일한 계약이다** — "파일에 적은 id"와 "op가 나르는 id"가 갈리면 다음 push가
   파일의 id를 서버에서 못 찾아 원래 버그 그대로 사본을 만든다. (a)만으로는 `r['id'] = newId()`처럼
   **자리마다 아무 id나 채워 넣는 구현도 통과한다**(실측 확인).
   자리를 하나에서 되쓰므로 구현은 새 배열을 자동으로 따라가지만, **이 단언이 새 자리를 감시하려면
   fixture에 그 자리를 함께 추가해야 한다** — 테스트가 저절로 따라가지는 않는다.
2. **입력 불변** — 호출 전 트리를 깊은 복사해 두고, 호출 후 원본이 그대로인지 비교한다.
3. **id만 늘었다** — `assignedTree`의 각 파일에서 `id` 키를 재귀적으로 제거하면 원본 트리와 canonical
   동일하다. (2번이 "원본을 안 건드림", 이것이 "복사본에 id 외에는 아무것도 안 함"이다.)
4. **explicit id는 그대로** — 이미 id가 적힌 항목의 id가 유지되고 새로 발급되지 않는다.
5. **`newId`가 없으면 `assignedTree`가 `undefined`**.
6. **`ok:false`면 `assignedTree`가 없다** — 참조 실패 등으로 실패하는 트리로 확인한다.
7. **`newId`가 없으면 복사하지 않는다** — `vi.spyOn(globalThis, 'structuredClone')`으로 호출 0회를
   확인한다. 조건 없는 복사로 바꾸면 pull·validate·base가 큰 트리를 매번 복사하는데, 그 회귀는
   결과가 같아서 다른 어떤 단언에도 걸리지 않는다.
8. **YAML alias 회귀(§3.3)** — 같은 객체를 `columns` 배열에 두 번 넣은 트리가 `ok:false`가 되고,
   메시지가 anchor/alias를 지목하며 "id를 지우세요"를 **말하지 않는다**(지울 id가 사용자 파일에 없다).
9. **`newId`가 없어도 같은 판정을 낸다**(I-4) — 8번과 같은 트리를 `newId` 없이 넣어도 `ok:false`다.
   이것이 `validate`와 `push`가 갈리지 않는다는 계약이고, `commands.test.ts`에 YAML 원문으로 `validate`를
   실제로 돌리는 한 건이 함께 있다(파서가 정말 같은 객체를 두 자리에 놓는지까지 본다).
10. **id를 나르지 않는 공유는 오류가 아니다** — 두 도메인이 같은 `dialectTypes` 객체를 나눠 쓰는 트리는
    `ok:true`다. 재방문 검사를 `idOf` 바깥으로 넓히는 잘못된 수선을 막는다.

### 7.2 cli — `push.test.ts` (+15)

7. **핵심 회귀: 응답 유실 후 재push가 사본을 만들지 않는다.** `pushImpl`이 **서버 모델을 실제로 갱신한
   뒤** 네트워크 오류를 던진다 → 첫 `push()`는 exit 1 · `outcomeUnknown`. 이어서 `getImpl`이 갱신된
   서버를 돌려주는 상태로 `push()`를 다시 부르면 **exit 0 · ops 0("변경 없음") · `pushCalls` 길이가
   늘지 않는다**(두 번째 `model.push`가 아예 안 나간다).
   *구분력:* `reserveIds` 호출을 지우면 두 번째 push가 create op를 낸다.
8. **미커밋 실패 후 재push는 정상 반영되고 같은 id를 쓴다** — `pushCalls[0]`과 `pushCalls[1]`의 create
   op `entityId`가 같다.
9. **파일명 ≠ 물리명인 신규 테이블도 원래 파일에 기록된다** — `erdd/tables/새테이블.yaml`에 `name: MBR`을
   두고 push → **그 파일에** id가 생기고 `erdd/tables/MBR.yaml`은 **생기지 않는다.** (§2.2의 회귀)
10. **CONFLICT 재시도가 같은 신규 id를 쓴다** — 첫 시도 CONFLICT → 재계산 → 두 `pushCalls`의 신규
    `entityId`가 같다.
11. **삭제 확인에서 취소하면 파일이 안 바뀐다.**
12. **conflicts가 있으면 파일이 안 바뀐다.**
13. **op 0건이면 파일이 안 바뀐다.**
14. **기록에 실패하면 전송하지 않는다** — 쓰기 실패를 주입해 `pushCalls`가 비어 있음을 확인한다.
    (주입 방법은 계획에서 확정한다. 파일 권한은 환경에 따라 흔들리므로, 대상 경로를 디렉터리로 만들어
    `EISDIR`을 내는 쪽이 이식성이 높다.)
15. **성공 봉투에 `reservedFiles`가 담긴다.**
16. **`outcomeUnknown` 문구의 두 갈래**(§5.3) — 기록한 파일이 있으면 근거를 대고, 없으면 대지 않는다.
    두 갈래 모두 `erdd diff`를 권하고 `erdd pull`의 대가를 말한다.
17. **CONFLICT 재계산에서 충돌이 나면 conflicts 봉투에 `reservedFiles`가 실린다**(I-1).
18. **CONFLICT 재계산에서 op 상한을 넘으면 오류 봉투에 `reservedFiles`가 실린다**(I-1) —
    첫 계산은 상한 아래, 재계산은 위가 되게 만들려면 **서버 모델을 로컬 트리를 파싱해서** 세워야 한다.
    컬럼의 `order`는 파일에서 배열 위치로 정해지므로 모델을 손으로 세우면 전부 충돌로 잡힌다(실측 5010건).
19. **CONFLICT 재계산 뒤 취소해도 기록한 id는 남는다**(§2.4, I-2).
20. **순환 참조 YAML을 전송 전에 막고 `NETWORK`로 오분류하지 않는다**(M-4) — `code`가 `VALIDATION`이고
    파일 경로가 문구에 있다. *구분력:* 순환 가드를 지우면 `NETWORK` + "Maximum call stack size exceeded".

### 7.3 cli — `reserve-ids.test.ts` (+6)

21. **변경 없는 파일은 쓰지 않는다** — id가 이미 다 있는 트리를 주면 반환이 `[]`이고 파일 mtime이
    그대로다.
22. **`assigned`가 `undefined`면 no-op**. (나머지 4건은 기록 경로·정렬·새 파일 생성이다.)

### 7.4 cli — `tree.test.ts` (+2) · `commands.test.ts` (+1)

23. **순환 참조는 `CliError('VALIDATION')`이 된다** — `canonical`·`diffTrees` 양쪽에서 확인한다(M-4).
24. **순환이 아닌 공유 참조는 그대로 통과한다** — "이미 본 것 전부"를 순환으로 세는 잘못된 수선을 막는다.
    *구분력:* `onPath.delete`를 지우면 이 건만 FAIL한다.
25. **`erdd validate`가 alias 파일을 통과시키지 않는다**(I-4, `commands.test.ts`).

`erdd diff`가 파일을 안 건드리는 것은 `reserveIds`를 `push.ts`에서만 부르므로 구조적으로 성립한다 —
`diff.test.ts`에 한 건을 더할지는 계획에서 정한다(위 산술에는 넣지 않았다).

**증가: core 453 → 463 · cli 114 → 138.** web·server는 무변경.
(2026-08-06 실측. 사이클 중 리뷰가 더한 것까지 반영한 값이다 — core `file-format.test.ts` +10,
cli `push.test.ts` +15 · `reserve-ids.test.ts` +6 · `tree.test.ts` +2 · `commands.test.ts` +1.)

## 8. 문서 정정 (이 사이클에서 함께 한다)

`HANDOFF.md`가 직전 사이클 막바지 두 커밋을 반영하지 못한 채 남아 있다.

- **6절 "승격 요청 큐"의 "`cancel`이 read-then-write다" 항목을 지운다.** `feb54df`에서 조건부
  UPDATE(`and(eq(id), eq(status,'pending'))`) + `rowCount === 0` → CONFLICT로 이미 고쳐졌고,
  `5c81dd1`이 그 경합 테스트를 `pg_locks`로 실제 대기를 확인하는 형태로 견고화했다(고정 sleep이
  만들던 거짓 통과 제거).
- **1절 "다음 작업"의 2번(cancel 경합)을 지운다.**
- **1절 테스트 기준선을 `core 453 · cli 114 · web 382 · server 143`으로 고친다**(2026-08-05 실측,
  `pnpm verify` exit 0). 현재 문서의 `web 378 · server 141`은 같은 두 커밋 이전 값이다.

## 9. 알려진 한계 (이월 후보)

- **서버는 여전히 멱등이 아니다.** 같은 요청을 그대로 두 번 보내면 리비전이 둘 생긴다. CLI는 재전송을
  하지 않으므로 이 경로를 만들지 않지만, 다른 클라이언트가 `model.push`를 직접 쓰면 가능하다. 막으려면
  `revisions.request_id`(마이그레이션)가 필요하다.
- **기록된 id는 회수되지 않는다.** push가 영영 실패하고 사용자가 그 항목을 파일에서 지우면 id도 함께
  사라지지만, 항목을 남겨 두면 서버가 모르는 id가 파일에 계속 있고 `status`가 계속 "로컬 변경"이라고
  말한다(§3.2 — 맞는 표시이나 지우는 길은 없다).
- **주석·서식은 보존되지 않는다.** 기록 대상 파일은 YAML로 재직렬화된다. 트리는 원래 pull마다
  재작성되므로 새로운 손실은 아니지만, **push가 실패한 경우에도** 파일이 한 번 재작성되는 것은 이번에
  생긴 동작이다.
- **`id`가 매핑의 맨 뒤에 붙는다**(`modelToFiles`는 맨 앞). push가 성공하면 `syncDown`이 정규화한다.
- **자동 재시도 없음**(§2.5) — 전송 실패 시 사용자가 다시 실행해야 한다.
- **던져서 끝나는 경로의 봉투에는 `reservedFiles`가 없다**(2026-08-06 리뷰 I-1의 나머지). `push.ts`가
  직접 만드는 두 봉투(conflicts · op 상한 초과)에는 실었지만, `throw err`로 `run()`이 만드는 봉투 —
  서버 거절(UNAUTHORIZED·FORBIDDEN·NOT_FOUND·VALIDATION)과 **CONFLICT 2회** — 는 그대로다. 둘 다
  재시도 뒤에 닿을 수 있고, 그때 워킹트리는 이미 재작성돼 있다. `CliError`에 `details`가 생겼으므로
  수단은 이미 있다 — 던지는 자리마다 `reservedFiles`를 붙이면 된다.
- **`rel in local` 가드와 `mkdir`은 프로덕션에서 도달하지 않는다**(리뷰 M-5). `assigned`는 `localTree`의
  `structuredClone`이라 키 집합이 항상 같아 `reserveIds`의 두 방어 코드가 실행될 일이 없다(실측: 가드를
  지워도 cli 전부 통과 — `canonical(undefined)`가 `undefined`라 우연히 같은 결과가 난다).
  `reserve-ids.test.ts`는 그 갈래를 검증하는데 `tree.ts`의 주석은 "닿지 않는다"고 적어, 둘이 서로 다른
  이야기를 한다. 방어 코드로 남기는 것 자체는 타당하나 어느 쪽이 사실인지 한 번 정리해야 한다.
- **id를 나르지 않는 공유 참조는 검사에 걸리지 않는다**(리뷰 M-7). `idOf`를 지나지 않는 자리(두 도메인이
  같은 `dialectTypes` 매핑을 alias로 공유하는 것 등)는 합쳐질 id가 없어 §3.3의 검사 대상이 아니고,
  그 파일이 기록 대상이 되면 `stringifyYaml`이 `&a1`/`*a1` 같은 **생성된 이름**으로 anchor를 다시 쓴다.
  위 "주석·서식 미보존"에 준하지만 이름이 바뀌는 것은 별개 손실이다.
- `pull`의 네 단계 쓰기 비원자성, 배열 원소 단위 병합, 대화형 충돌 해소 등 push 설계 §9의 나머지
  한계는 그대로다.
