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

`firstUse` 검사는 **파일에 적힌 explicit id만** 대상으로 한다(발급된 id는 정의상 유일해 검사를 받지
않는다). 기록 이후 그 id는 explicit이 되어 검사 대상에 들어가지만, 한 파일에 한 번만 있으므로 통과한다.

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
3. `idOf`가 id를 발급할 때 그 자리에 되써 넣는다:
   ```ts
   if (explicit === null) {
     if (newId === undefined) return `${NEW_ID_PREFIX}${path}#${kind}[${index}]`
     const id = newId()
     r['id'] = id          // r은 src 안의 객체다 — 입력 tree는 그대로다
     return id
   }
   ```
4. 성공 갈래에 `assignedTree: newId === undefined ? undefined : src`.

- **입력 `tree`는 변형하지 않는다.** 복사본에만 쓴다.
- **`ok:false`에는 담지 않는다.** 파싱이 실패한 트리에 id를 기록할 이유가 없고, 담으면 CLI가 그것을
  쓸 수 있다고 오해할 여지가 생긴다.
- `structuredClone`은 전역 함수라 core의 "IO·런타임 의존성 free" 규칙에 걸리지 않는다. YAML이 낼 수
  있는 `Date`(타임스탬프 스칼라)도 보존한다 — JSON 왕복 복사를 쓰면 안 되는 이유다.
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
  **"신규 항목의 id를 파일에 기록해 두었으므로 그대로 다시 push하면 중복 없이 수렴합니다
  (erdd diff로 먼저 확인할 수 있습니다)"**.
- `committed:true`(syncDown 실패): 기존 "erdd pull을 실행하세요"를 유지한다(반영이 확정된 경우라
  안내가 이미 정확하다).
- 두 JSON 봉투와 성공 봉투에 `reservedFiles: string[]`을 더한다 — 에이전트가 무엇이 바뀌었는지 안다.

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

### 7.1 core — `file-format.test.ts` (+6)

1. **완전성** — 9종 전부에 id 없는 항목이 있는 트리를 `filesToModel(tree, {newId})`에 넣고, 나온
   `assignedTree`를 **`newId` 없이** 다시 `filesToModel`에 넣으면 모델의 **모든 엔티티 id에
   `NEW_ID_PREFIX`가 하나도 없다.** 임시 id는 정확히 "id가 없는 자리"의 표식이므로, 자리를 하나라도
   빠뜨리면 이 단언이 깨진다. 새 파일 종류·새 배열이 붙을 때도 자동으로 감시한다.
2. **입력 불변** — 호출 전 트리를 깊은 복사해 두고, 호출 후 원본이 그대로인지 비교한다.
3. **id만 늘었다** — `assignedTree`의 각 파일에서 `id` 키를 재귀적으로 제거하면 원본 트리와 canonical
   동일하다. (2번이 "원본을 안 건드림", 이것이 "복사본에 id 외에는 아무것도 안 함"이다.)
4. **explicit id는 그대로** — 이미 id가 적힌 항목의 id가 유지되고 새로 발급되지 않는다.
5. **`newId`가 없으면 `assignedTree`가 `undefined`**.
6. **`ok:false`면 `assignedTree`가 없다** — 참조 실패 등으로 실패하는 트리로 확인한다.

### 7.2 cli — `push.test.ts` (+9)

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

### 7.3 cli — `reserve-ids.test.ts` (+2)

16. **변경 없는 파일은 쓰지 않는다** — id가 이미 다 있는 트리를 주면 반환이 `[]`이고 파일 mtime이
    그대로다.
17. **`assigned`가 `undefined`면 no-op**.

`erdd diff`가 파일을 안 건드리는 것은 `reserveIds`를 `push.ts`에서만 부르므로 구조적으로 성립한다 —
`diff.test.ts`에 한 건을 더할지는 계획에서 정한다(위 산술에는 넣지 않았다).

**예상 증가: core 453 → 459 · cli 114 → 125.** web·server는 무변경.

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
- `pull`의 네 단계 쓰기 비원자성, 배열 원소 단위 병합, 대화형 충돌 해소 등 push 설계 §9의 나머지
  한계는 그대로다.
