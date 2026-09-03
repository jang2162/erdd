# 용어 수정 시 사용처 일괄 반영 설계

**작성일:** 2026-08-01
**상태:** 승인됨 (사용자 "맞아 진행해줘")
**원 기획:** docs/13-naming.md "용어 수정 시 사용 중인 컬럼에 변경 반영 여부를 선택(일괄 반영 / 유지)"
**해소하는 이월 항목:** HANDOFF §6 "명명 체계 — 용어 수정 시 사용 중 컬럼 일괄 반영 미구현"

## 목표

용어(Term)를 수정했을 때, 그 용어를 쓰고 있는 테이블·컬럼에 변경을 함께 반영할지 선택할 수 있게 한다.

지금은 Term을 고쳐도 사용처는 그대로 남고 `term-mismatch` 경고만 뜬다. 도메인은 `resolveColumn`이 매번 도메인을 읽는 **라이브 해석**이라 수정이 자동 반영되지만, 컬럼·테이블의 물리명은 **자동생성 시점의 문자열 스냅샷**이라 별도 반영 경로가 필요하다. 이 비대칭이 이 작업의 존재 이유다.

**범위 밖:** 용어 *추가* 시 전파(새 용어가 기존 엔티티 논리명과 겹치면 경고가 즉시 뜨지만, 기획 문서가 "용어 수정 시"로 한정한다 — 필요하면 후속 사이클). 단어(Word) 수정 전파(단어는 물리명 생성의 입력일 뿐 엔티티에 1:1 대응하지 않는다). 모델 검사 화면에서의 `term-mismatch` 일괄 해소(별도 진입점).

## 핵심 결정 (사용자 확정)

- **전파 필드는 논리명·물리명·기본 도메인 전부.** 물리명만 맞추는 것보다 강하지만, 사용자가 "용어를 고쳤다"는 것은 그 용어를 쓰는 곳을 새 용어로 갱신한다는 뜻으로 본다.
- **대상은 테이블 + 컬럼 둘 다.** `termUsage`가 이미 둘 다 반환하고, 테이블 물리명도 용어 기반 자동생성 대상이며 `term-mismatch` 경고도 양쪽에 붙는다.
- **저장 시 확인 단계.** 용어 수정 저장 시 전파할 변경이 실제로 있으면 "일괄 반영 / 유지"를 묻는다.

## 아키텍처 / 방침

**웹 전용이다.** 서버·core·마이그레이션 변경이 전혀 없다.

| 계층 | 파일 | 책임 |
|---|---|---|
| web | `editor/dict-edits.ts` (수정) | `planTermPropagation` (순수, 영향 목록 산출) · `applyTermPropagation` (순수 producer) |
| web | `editor/dict-panel.tsx` (수정) | 용어 수정 폼에 확인 단계 삽입 |

기존 `termUsage`가 있는 파일에 나란히 둔다 — 같은 "용어 ↔ 사용처" 관심사다.

### 1. 사용처는 **수정 전 논리명** 기준으로 계산한다

이 설계에서 가장 틀리기 쉬운 지점이다. `termUsage(model, termId)`는 `entity.logicalName.trim() === term.logicalName.trim()`으로 사용처를 찾는다. 논리명을 바꾼 **뒤에** 사용처를 계산하면 아무것도 매칭되지 않아 전파가 조용히 0건이 된다.

따라서 `planTermPropagation`은 **수정 전 모델과 수정 전 Term**을 기준으로 사용처를 확정하고, 거기에 patch를 적용한 결과를 계획으로 낸다.

### 2. 실제로 바뀐 필드만 전파한다

폼에서 논리명·물리명·도메인 중 **값이 달라진 것만** 사용처에 적용한다. 물리명만 고쳤으면 사용처의 논리명은 건드리지 않는다.

| 필드 | 테이블 | 컬럼 | 비고 |
|---|---|---|---|
| `logicalName` | ✅ | ✅ | |
| `physicalName` | ✅ | ✅ | |
| `domainId` | — | ✅ | 테이블에는 필드가 없다 |

"바뀐 필드"는 **patch에 키가 있고 그 값이 수정 전 Term의 값과 실제로 다른 것**을 뜻한다. `Partial<Omit<Term,'id'>>`이므로 키가 없으면 미변경이고, 키가 있어도 값이 같으면 전파 대상이 아니다(폼이 모든 필드를 항상 채워 보내므로 이 구분이 없으면 안 바꾼 필드까지 전파된다).

**`domainId`가 `null`로 바뀐 경우는 전파하지 않는다.** 용어에서 도메인을 떼는 것은 "이 용어에 기본 도메인이 없다"는 뜻이지 "쓰는 곳의 도메인을 지워라"가 아니다. 전파하면 컬럼의 타입 해석이 통째로 사라진다(`resolveColumn`이 `column.domainId`를 못 찾아 직접 입력 타입으로 되돌아간다). `null → 값` 방향과 `값 → 다른 값` 방향만 전파한다.

### 3. 저장 시 확인 다이얼로그

용어 수정 저장 시, **사용처가 1건 이상이고 전파할 필드 변경이 1개 이상일 때만** 뜬다. 둘 중 하나라도 없으면 지금처럼 곧바로 단일 `updateTerm` mutation으로 저장한다(불필요한 확인 단계를 만들지 않는다).

```
"회원번호" 용어를 쓰는 3곳을 함께 갱신할까요?

  MBR.MBR_NO      논리명  회원번호 → 회원식별번호
                  물리명  MBR_NO   → MBR_ID
  ORD.MBR_NO      논리명  회원번호 → 회원식별번호
                  물리명  MBR_NO   → MBR_ID
  MBR             논리명  회원번호 → 회원식별번호
                  물리명  MBR_NO   → MBR_ID

                              [유지]   [3곳에 반영]
```

- **[유지]** — 용어만 수정하고 사용처는 그대로 둔다(현재 동작 그대로. `term-mismatch` 경고가 뜬다).
- **[N곳에 반영]** — 용어 수정 + 사용처 반영을 함께 적용한다.
- 도메인이 바뀌는 항목도 목록에 함께 보여준다. 의도적으로 다른 도메인을 쓰던 컬럼이 있으면 사용자가 그것을 보고 [유지]를 고를 수 있다 — 이것이 필드별 체크박스 대신 전체 목록을 보여주는 이유다.

### 4. Revision 1건

용어 수정과 사용처 반영을 **하나의 mutation**으로 보낸다. undo 한 번으로 둘 다 되돌아간다. `docs/14-domain.md`의 도메인 일괄 반영도 "반영은 Revision 1건으로 기록된다"로 같은 방침이다.

`useModelMutation`의 producer 하나가 `updateTerm` + `applyTermPropagation`을 연달아 적용하면 `diffModels`가 알아서 하나의 op 배치를 만든다.

## 인터페이스

```ts
/** 전파로 바뀌는 필드. 실제로 값이 달라지는 것만 담는다. */
export type TermPropagationChange = {
  field: 'logicalName' | 'physicalName' | 'domainId'
  before: string | null
  after: string | null
}

export type TermPropagationEntry = {
  kind: 'table' | 'column'
  entityId: string
  /**
   * 화면 표시용 라벨. **수정 전 물리명** 기준으로 만든다(사용자가 목록에서 대상을 알아보려면
   * 바뀌기 전 이름이어야 한다). 컬럼은 `"{소속테이블물리명}.{컬럼물리명}"`, 테이블은 `"{물리명}"`.
   */
  label: string
  changes: TermPropagationChange[]
}

export type TermPropagationPlan = {
  entries: TermPropagationEntry[]
}

/**
 * 수정 전 모델·수정 전 Term 기준으로 사용처를 확정하고, patch 적용 시 바뀌는 것만 계획으로 낸다.
 * 반드시 updateTerm을 적용하기 **전**의 모델을 넘겨야 한다(논리명이 바뀌면 사용처 판정이 무너진다).
 * 변경이 없는 엔티티는 entries에서 제외된다.
 */
export function planTermPropagation(
  model: ProjectModel, termId: string, patch: Partial<Omit<Term, 'id'>>,
): TermPropagationPlan

/** 계획을 모델에 적용한다(순수). updateTerm과 같은 producer 안에서 연달아 호출한다. */
export function applyTermPropagation(model: ProjectModel, plan: TermPropagationPlan): ProjectModel
```

## 전역 제약 (Global Constraints)

- **웹 전용.** `packages/core`·`apps/server`를 건드리지 않는다. **새 마이그레이션 없음.**
- 불가침: `packages/core/src/diff.ts` · `op.ts`(`ENTITY_KINDS`·`applyOps`) · `integrity.ts` · `model.ts`.
- `planTermPropagation`·`applyTermPropagation`은 **순수 함수**다(모델 입력 → 값 출력, IO·스토어 접근 없음).
- 용어 수정과 사용처 반영은 **단일 mutation**이어야 한다(Revision 1건). 두 번 나눠 보내면 undo가 두 번 필요해진다.
- 새 런타임 의존성 금지. UI 카피는 한국어.
- **웹 재발 버그 주의**: 이벤트 값은 producer 진입 **전에** 캡처한다(`serializeMutation`이 producer를 마이크로태스크로 미루므로 지연 읽기는 스테일 값을 잡는다) — HANDOFF §3.4.
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. 커밋 메시지 한국어 + 트레일러 2줄.

## 테스트 전략

**순수 함수** (`dict-edits.test.ts`)
- 물리명만 바뀌면 사용처의 물리명만 갱신되고 논리명은 그대로다
- 논리명이 바뀌면 **수정 전 논리명** 기준으로 사용처를 찾는다 (이 설계의 핵심 — 수정 후 기준으로 찾는 구현이면 entries가 0건이 되어 실패해야 한다)
- 테이블과 컬럼이 모두 대상에 들어간다
- `domainId`가 `null`로 바뀌면 전파하지 않는다 (컬럼의 기존 도메인이 보존된다)
- `domainId`가 `null → 값`, `값 → 다른 값`이면 전파한다
- 바뀐 필드가 없으면 `entries`가 비어 있다
- 사용처가 없으면 `entries`가 비어 있다
- 논리명이 같아도 물리명이 이미 용어와 일치하는 엔티티는 물리명 변경이 없다(중복 변경 없음)

**화면** (`dict-panel.test.tsx`)
- 사용처가 있고 전파할 변경이 있으면 확인 다이얼로그가 뜬다
- 사용처가 없으면 다이얼로그 없이 곧바로 저장된다
- [유지]를 고르면 용어만 바뀌고 사용처는 그대로다
- [N곳에 반영]을 고르면 용어와 사용처가 **한 번의 mutation**으로 함께 바뀐다

## 열린 항목 (이번 범위 밖, 기록만)

- 용어 *추가* 시 기존 동명 엔티티로의 전파 — 같은 코드 경로를 재사용할 수 있으나 기획 문구가 "수정 시"로 한정
- 모델 검사 화면에서 `term-mismatch` 경고를 모아 일괄 해소하는 진입점
- 전파 대상 엔티티를 개별 선택(체크박스) — 현재는 전체 반영 / 전체 유지 2택
