# N:M 교차 테이블 자동 생성 — 설계

**작성:** 2026-08-09 / **상태:** 사용자 확정 / **마이그레이션:** 없음 / **서버 변경:** 없음

---

## 1. 목적과 범위

다대다 관계를 설계할 때 사람이 매번 손으로 하는 일 — 교차 테이블을 만들고, 양쪽 PK를 복사해
FK 컬럼을 넣고, 두 관계를 식별 관계로 잇는 것 — 을 버튼 하나로 대신한다.

**범위 안**

- `packages/core` 순수 함수 2개(`resolveManyToMany` · `junctionTableName`)
- 관계 패널의 "교차 테이블로 풀기" 버튼 1개와 그 활성 조건

**범위 밖 (건드리지 않는다)**

- 모델 스키마 — `cardinality` enum은 `'1:1' | '1:N'` 그대로다(2절 D1)
- DDL 생성·diff·3-way 병합·파일 포맷·Excel·CLI — 결과물이 **보통 테이블 1개와 1:N 관계 2개**뿐이라
  이들이 새로 알아야 할 것이 없다
- 서버·마이그레이션 — 기존 `model.mutate` op 파이프라인을 그대로 탄다
- 교차 테이블의 추가 속성 컬럼(수량·단가 등) — 만든 뒤 편집 패널에서 직접 넣는다

---

## 2. 확정된 결정 (사용자 확정)

### D1. 모델은 N:M을 표현하지 않는다 — "만들어 주는 동작"만 둔다

`cardinality`에 `'N:M'`을 **추가하지 않는다.** 버튼을 누른 뒤 모델에 남는 것은 교차 테이블 1개와
1:N 관계 2개이며, 그 뒤로는 사람이 손으로 만든 것과 **구별되지 않는다.**

**왜:** ERDD는 물리 모델 도구다(핵심 산출물이 DDL과 정의서다). 물리 모델에 N:M 관계는 존재할 수
없으므로, 모델에 넣으면 "아직 물리화되지 않은 관계"라는 두 번째 상태가 생기고 DDL 생성·diff·병합·
파일 포맷·Excel이 전부 그 상태를 새로 다뤄야 한다. 얻는 것(논리 ERD를 먼저 그리는 워크플로)에
비해 번지는 범위가 크다.

### D2. 교차 테이블의 PK는 두 FK의 복합 PK다 (identifying)

대리키 + UNIQUE 방식은 쓰지 않는다.

**왜:** 교차 테이블의 교과서적 해소법이고, 같은 쌍이 두 번 들어가는 것을 DB 차원에서 막는다.
`createRelationshipFromParentPk(identifying: true)`가 이미 정확히 그 동작을 하므로 새 코드가 가장 적다.
대가는 나중에 이 교차 테이블을 부모로 쓸 때 FK가 2컬럼으로 번지는 것인데, 그때 사람이 대리키를
추가하면 된다.

### D3. 진입점은 관계 패널의 "교차 테이블로 풀기" 버튼이다

툴바 버튼 + 테이블 2개를 고르는 다이얼로그는 쓰지 않는다.

**왜:** 캔버스에서 관계를 그으면 `onConnect`가 그 관계를 **자동으로 선택**하므로
(`canvas.tsx:117` `selectRelationship`) 관계 패널이 바로 열린다. 즉 "A→B를 긋고 버튼 한 번"이면
끝난다. 새 선택 UI가 필요 없고, 예전에 그어 둔 1:N도 나중에 풀 수 있다. 이 저장소는 테이블·메모·
관계를 전부 다이얼로그 없이 즉시 생성하므로 그 패턴과도 맞는다.

### D4. 교차 테이블의 기본 논리명은 두 부모 논리명을 구분자 없이 이어붙인 것이다

`주문` × `상품` → `주문상품`. "매핑"·"관계" 같은 접미사를 붙이지 않는다.

**왜:** 픽스처의 테이블 명명 관례와 같다(`회원등급` → `MBR_GRD`). 물리명은 기존
`generatePhysicalName`이 사전에서 만들어 주므로(`주문`+`상품` → `ORD_PRD`) **새 명명 로직이 필요
없고**, 사전에 없는 말이 있으면 기존 미등록 단어 경고가 그대로 잡는다. 접미사를 붙이면 그 말이
단어 사전에 없을 때 교차 테이블마다 경고가 뜬다.

---

## 3. 의미 모델

### 3.1 무엇을 무엇으로 바꾸는가

```
바꾸기 전:   [주문] ──1:N──▶ [상품]
             상품.주문번호 (FK, non-PK)

바꾼 뒤:     [주문] ──1:N──▶ [주문상품] ◀──1:N── [상품]
                              주문번호 (PK, FK → 주문)
                              상품번호 (PK, FK → 상품)
             상품.주문번호 는 사라진다
```

원본 관계는 **교체된다**. 남겨 둘 이유가 없다 — "상품이 주문을 참조한다"는 주장이 "주문과 상품은
다대다다"로 바뀌었으므로, 상품에 있던 주문 FK는 더 이상 참이 아니다.

### 3.2 원본 FK 컬럼은 `deleteColumnCascade`로 지운다 — `deleteRelationship`이 아니다

**`deleteRelationship`은 자식 FK 컬럼을 일부러 보존한다**(`relationship.ts:130`의 주석 그대로).
관계만 지우면 `상품.주문번호`가 아무도 참조하지 않는 고아 컬럼으로 남는다.

`deleteColumnCascade`는 반대로 필요한 것을 전부 한다:

| 딸린 것 | 처리 |
|---|---|
| 그 컬럼을 쓰는 관계의 `columnMappings` | 해당 매핑 제거 |
| 매핑이 전부 빈 관계 | **관계 자체를 삭제** — 그래서 원본 관계가 따로 지우지 않아도 사라진다 |
| 그 컬럼을 포함한 인덱스 | 인덱스에서 그 컬럼 제거, **컬럼이 0개가 되면 인덱스 삭제** |

즉 FK 컬럼들을 지우는 것만으로 원본 관계까지 함께 정리된다. 순서상 **컬럼 삭제가 먼저이고 관계
삭제는 그 결과**다.

### 3.3 연쇄가 깨지는 관계는 풀 수 없다 (버튼 비활성)

원본 FK 컬럼을 지울 때 위험한 것은 **그 컬럼을 부모로 삼는 다른 관계가 있는 경우**다. 지우면
`deleteColumnCascade`가 그 관계의 매핑에서 해당 컬럼을 조용히 빼고(매핑이 그것뿐이면 관계 자체를
지운다), 손자 테이블에는 **아무도 참조하지 않는 고아 FK 컬럼**이 남는다.

```
[주문] ──▶ [주문상세] ──▶ [배송]
            PK: (상세순번, 주문번호)   배송.상세순번, 배송.주문번호

주문→주문상세 를 풀면 주문상세.주문번호 가 사라지고
배송의 FK 가 (상세순번) 하나로 줄어든다 — 배송.주문번호 는 고아 컬럼으로 남는다
```

**아무것도 알리지 않는다.** `validateModelIntegrity`는 참조 무결성만 보므로 통과하고, 고아 컬럼을
잡는 경고 종류가 없으며(`computeWarnings`의 '부모 기본 키와 매핑 수가 일치하지 않습니다'는 매핑이
축소된 뒤에도 개수가 맞아 걸리지 않는다), ops가 정상 생성되므로 토스트도 뜨지 않는다.

**가드는 두 개다.**

| 가드 | 조건 | 왜 |
|---|---|---|
| 식별 관계 | `rel.identifying === true` | 식별 관계의 FK는 정의상 자식 PK다. 사용자가 패널의 "식별 관계" 체크를 먼저 해제하면(이미 있는 기능) 풀 수 있다 |
| 하위 관계 참조 | 지울 FK 컬럼 중 하나라도 **다른 관계의 `parentColumnId`** 다 | 실제로 연쇄를 일으키는 조건이다. `identifying`과 FK 컬럼의 `isPk`를 모델이 강제로 묶지 않으므로(3.4) `identifying: false`인데 연쇄가 깨지는 상태가 존재한다 |

**둘은 서로를 덮지 않는다**(실측: 한쪽을 지우면 그쪽 테스트만 실패한다). `identifying: true`인데
하위 관계가 없는 모델은 두 번째 가드에 걸리지 않고, `identifying: false`인데 FK가 자식 PK이면서
하위 관계의 부모인 모델은 첫 번째 가드에 걸리지 않는다. 후자에 도달하는 경로는 **둘 다 정상
기능**이다 — 편집 패널의 PK 체크박스(`edit-panel.tsx`)로 자동 생성 FK에 PK를 체크하는 것과,
복합 FK 중 일부만 자식 PK인 스키마의 DDL 역설계(`ddl-import.ts`)다.

연쇄를 따라가며 고치는 것은 이 기능의 목적을 넘어선다. **버튼을 비활성화하고 이유를 보여준다.**

### 3.4 PK 개수는 "FK를 지운 뒤"를 기준으로 센다

`createRelationshipFromParentPk`는 부모 PK가 0개면 **아무 일도 하지 않고 모델을 그대로 돌려준다**
(`relationship.ts:37`). 두 부모 중 한쪽이라도 PK가 없으면 교차 테이블에 FK를 만들 수 없으므로 그
경우 **버튼을 비활성화한다.** 부분적으로 만들어진 상태(테이블과 관계 하나만 생긴)를 남기지 않기
위해서다.

**세는 시점이 함정이다.** 원본 FK 컬럼은 3.2에서 삭제되므로, 그 컬럼이 자식의 PK였다면 삭제 후
자식의 PK가 줄어든다. 삭제 **전** 개수를 보면 통과시켜 놓고 두 번째 관계 생성이 조용히 no-op이
된다 — 정확히 막으려던 부분 상태다. 그래서 이렇게 센다:

```
원본 parent 의 PK 개수                                        > 0
원본 child  의 PK 개수 − (삭제될 FK 컬럼 중 isPk 인 것의 개수) > 0
```

parent 쪽은 컬럼이 삭제되지 않으므로 그대로 센다.

**중복 매핑은 한 번만 센다.** `rel.columnMappings`는 같은 `childColumnId`를 두 번 담을 수 있다 —
공개 함수 `remapRelationshipChildColumn`이 그렇게 만들고, 관계 패널의 매핑 select도 이미 매핑된
컬럼을 후보에서 빼지 않는다. 중복을 세면 `droppedPk`가 실제 삭제량보다 커져 **풀 수 있는 모델이
조용히 버튼 비활성**이 된다. 그래서 `new Set`으로 중복을 없애고 센다.

**비교는 `=== 0`이 아니라 `<= 0`이다.** 위 dedup이 깨지면 `droppedPk`가 자식 PK 수를 넘어 뺄셈
결과가 **음수**가 되는데, `=== 0` 비교는 그것을 그대로 빠져나가 정확히 막으려던 부분 상태를 만든다.
`<= 0`이면 dedup과 무관하게 막힌다 — 이중 방어다. 중복이 없어도 매핑이 자식 밖 컬럼을 가리키면
(무결성 위반 모델) 음수가 나오므로 dedup만으로는 대체되지 않는다.

**언제 발생하나:** `identifying: true`면 3.3에서 이미 막히므로, 이 경우는 **`identifying: false`인데
FK 컬럼의 `isPk`가 `true`인 불일치 상태**에서만 나온다. 모델은 그 둘을 강제로 묶지 않는다 —
`setRelationshipIdentifying`을 거치면 동기화되지만 DDL 역설계나 컬럼 편집으로 어긋날 수 있고,
실제로 `testing/fixtures.ts`의 `fullModel()`이 그런 상태를 담고 있다(`r2.identifying === false`인데
`c5.isPk === true`이고 `c5`는 `tb3`의 유일한 PK다). 무결성 검사(`validateModelIntegrity`)는 참조
무결성만 보므로 이 상태도, 그 결과인 부분 상태도 잡지 못한다.

### 3.5 컬럼 이름 충돌

`createRelationshipFromParentPk`의 `uniqueName`이 이미 처리한다 — 같은 물리명이 있으면 `_2`를 붙인다.
이 저장소의 PK 명명 관례는 엔티티명을 포함하므로(`회원번호 MBR_NO` · `주문번호 ORD_NO` ·
`등급코드 GRD_CD`) 서로 다른 두 테이블에서는 충돌이 거의 없다.

**자기참조**(부모 = 자식)만 충돌한다 — `사원번호`, `사원번호_2`. 캔버스는 자기참조 연결을 막지만
(`edges.ts:52` `reason: 'self'`) **DDL 역설계로 들어온 자기참조 1:N은 존재할 수 있다.** 이 경우에도
동작하게 두고(막을 이유가 없다) 이름은 사용자가 패널에서 고친다. 논리명도 `사원사원`이 되는데,
이를 위해 특별 규칙을 넣지 않는다 — 드물고, 고치는 비용이 낮다.

---

## 4. core

### 4.1 `junctionTableName(parent, child): string`

```ts
export function junctionTableName(parent: Table, child: Table): string {
  return `${parent.logicalName}${child.logicalName}`
}
```

물리명은 이 함수가 만들지 않는다 — 호출측이 `generatePhysicalName`으로 만든다(5.2). core의 명명
규칙은 `naming.ts` 하나에만 두는 기존 구조를 유지하기 위해서다.

### 4.2 `resolveManyToMany(model, args): ProjectModel`

```ts
export function resolveManyToMany(
  model: ProjectModel,
  args: {
    relationshipId: string          // 풀 대상 1:N 관계
    junction: {
      id: string
      logicalName: string
      physicalName: string
      position: Position
      groupId: string | null        // 활성 그룹뷰가 있으면 그 id
      groupPosition: Position | null
    }
    a: { relationshipId: string; newColumnIds: string[] }   // 원본 parent → 교차
    b: { relationshipId: string; newColumnIds: string[] }   // 원본 child  → 교차
  },
): ProjectModel
```

**id와 이름은 전부 호출측이 발급해서 넘긴다.** `createRelationshipFromParentPk`가 `newColumnIds`를
받는 것과 같은 관례다 — core는 순수 변환만 하고 id 생성(`uuidv7`)·좌표·사전 조회를 모른다.

**동작 순서**

1. `model.relationships[args.relationshipId]`가 없으면 `model`을 그대로 반환(no-op)
2. **`rel.identifying === true`면 `model`을 그대로 반환**(no-op) — 3.3
3. `parentTableId` · `childTableId`를 읽어 둔다(6번에서 관계가 사라지므로 **먼저** 읽는다)
4. **FK를 지운 뒤 기준으로** 양쪽 PK 개수를 세어 하나라도 0 이하면 `model`을 그대로 반환(no-op) — 3.4
5. **지울 FK 컬럼 중 하나라도 다른 관계의 `parentColumnId`면 `model`을 그대로 반환**(no-op) — 3.3
6. `rel.columnMappings`의 `childColumnId`들을 순서대로 `deleteColumnCascade` — 원본 관계가 함께 사라진다
7. 교차 테이블을 `tables`에 추가
8. `createRelationshipFromParentPk(parentTableId → junction, identifying: true, cardinality: '1:N')`
9. `createRelationshipFromParentPk(childTableId → junction, identifying: true, cardinality: '1:N')`

**no-op 규약:** 2·4·5번이 `model`을 그대로 반환하는 것은 이 저장소의 기존 관례다
(`createRelationshipFromParentPk`의 부모 PK 없음, `deleteRelationship`의 없는 id). 호출측이 버튼을
비활성화해 애초에 부르지 않게 하지만(5.3), 함수 자체도 안전해야 한다 — **경합으로 뒤늦게 도착한
mutation이 깨진 모델을 만들지 않기 위해서다**(실시간 동시편집이 있다). 그 mutation은 웹의
`planJunction`을 거치지 않으므로 **core의 가드는 core 테스트로 따로 잠근다** — 웹에만 대칭
테스트가 있으면 core 쪽 되돌림을 아무도 잡지 못한다.

**`newColumnIds` 개수 부족:** `createRelationshipFromParentPk`가 `throw`한다
(`relationship.ts:39`). 호출측이 PK 개수를 세어 발급하므로(5.2) 정상 경로에서는 발생하지 않는다.

---

## 5. 웹

### 5.1 파일

| 파일 | 변경 |
|---|---|
| `apps/web/src/editor/edges.ts` | `planJunction` 추가 |
| `apps/web/src/editor/relationship-panel.tsx` | 버튼 1개 추가 |

`edges.ts`에 두는 것은 `planConnection`이 이미 거기 있고 하는 일이 같기 때문이다 — 모델을 보고
**id를 미리 발급한 계획을 만든다.**

### 5.2 `planJunction`

```ts
export function planJunction(
  model: ProjectModel,
  relationshipId: string,
  genId: () => string,
  ctx: { namingRules: NamingRules; activeGroupView: string | null },
): JunctionPlan

export type JunctionPlan =
  | { ok: false; reason: 'missing' | 'identifying' | 'no-pk' | 'downstream' }
  | {
      ok: true
      junction: {
        id: string; logicalName: string; physicalName: string
        position: Position; groupId: string | null; groupPosition: Position | null
      }
      a: { relationshipId: string; newColumnIds: string[] }
      b: { relationshipId: string; newColumnIds: string[] }
    }
```

`ctx`가 필요한 이유: 물리명 생성에 `namingRules`가 들어가고(5.2-6), 그룹뷰 안에서 풀면 교차 테이블이
그 그룹에 속해야 한다(5.2-7). 둘 다 store에서 읽어 패널이 넘긴다 — `planConnection`이 모델만 받는
것과 달라지는 지점이다.

`planConnection`과 같은 판별 유니온 형태다. 하는 일:

1. 관계·양쪽 테이블 존재 확인 → 없으면 `missing`
2. `rel.identifying` → `identifying`
3. 양쪽 PK 개수를 **3.4의 식으로**(원본 FK 중 `isPk`인 것을 중복 없이 세어 자식 쪽에서 뺀다) 센다.
   부모가 0이거나 자식이 0 이하면 `no-pk`
4. 지울 FK 컬럼 중 하나라도 **다른 관계의 `parentColumnId`**면 `downstream` — 3.3
5. 논리명 = `junctionTableName(parent, child)`
6. 물리명 = `generatePhysicalName(논리명, model.words, model.terms, namingRules).physicalName`
   - **빈 문자열이면**(두 논리명 모두 사전에 없음) `addTable`과 같은 관례로 `TABLE_n`을 쓴다
     (사용 중이지 않은 가장 작은 n). 빈 물리명은 DDL 생성을 깨뜨리므로 남기지 않는다
   - 부분만 해석되면(한쪽만 사전에 있음) 그 부분 물리명을 그대로 쓴다 — **기존 미등록 단어 경고**가
     그 상태를 알린다. 새 경고를 만들지 않는다
7. 위치 = 두 부모 `position`의 중점. 활성 그룹뷰가 있으면 `groupId`를 채우고 `groupPosition`도 두
   `groupPosition`의 중점으로 둔다
   - ⚠️ **`toolbar.tsx`의 `addTable` + `setTableGroup` 조합과 결과가 다르다.** `setTableGroup`
     (`group.ts`)은 `groupPosition`을 건드리지 않아 그 경로는 `null`로 남긴다. 여기서는 중점을
     채운다 — 그룹뷰에서도 두 부모 사이에 놓이는 쪽이 낫기 때문이다
   - 부모의 `groupPosition`이 `null`이면 그 부모의 `position`으로 대신 센다. 그룹에 속했는데
     `groupPosition`이 `null`인 테이블은 실재한다 — 바로 위 `addTable` + `setTableGroup` 경로가
     그 상태를 만든다. 폴백이 없으면 중점이 `NaN`이 되어 교차 테이블이 그룹뷰에서 사라진다
   - **활성 그룹뷰가 이미 삭제된 그룹을 가리킬 수 있다.** 원격 resync는 `activeGroupView`를 일부러
     유지하므로(`store.ts`) 협업자가 그룹을 지우면 죽은 id가 남는다. 없는 그룹을 참조하는 테이블은
     무결성 위반이라 mutation이 통째로 거부된다 — 버튼은 활성인데 누르면 에러가 되므로, core의
     `setTableGroup`과 같이 **미배정(`groupId: null` · `groupPosition: null`)으로 떨군다**
8. `genId()`로 교차 테이블 id 1개 + 관계 id 2개 + FK 컬럼 id(PK 개수만큼 × 2)를 발급

### 5.3 버튼

컬럼 매핑 섹션 아래, `canEdit`일 때만 보인다.

```tsx
<Button size="sm" variant="outline" disabled={plan.ok === false}
  onClick={() => {
    if (!plan.ok) return
    select(plan.junction.id)          // 새 교차 테이블을 선택해 이름을 바로 고칠 수 있게 한다
    void mutate((m) => resolveManyToMany(m, {
      relationshipId: relId, junction: plan.junction, a: plan.a, b: plan.b,
    }), { summary: '교차 테이블로 풀기' })
  }}>
  교차 테이블로 풀기
</Button>
```

비활성일 때 이유를 그 아래 작은 글씨로 보여준다:

| `reason` | 문구 |
|---|---|
| `identifying` | 식별 관계는 풀 수 없습니다 — 위 "식별 관계" 체크를 먼저 해제하세요 |
| `no-pk` | 교차 테이블에 넘길 기본 키가 없습니다 — 부모에 기본 키가 있어야 하고, 자식에는 이 관계의 FK 를 뺀 기본 키가 남아야 합니다 |
| `downstream` | 이 관계의 FK 컬럼을 다른 관계가 참조하고 있어 풀 수 없습니다 — 먼저 그 관계를 정리하세요 |

`no-pk` 문구가 조건을 그대로 말하는 이유: "양쪽 테이블에 모두 기본 키가 있어야 합니다"로 두면
**양쪽에 PK가 있는데도** 같은 문구가 뜬다(자식 PK가 전부 이 관계의 FK인 경우 — 3.4). 사용자가
화면을 보고 이유를 확인할 수 없는 문구다.

`missing`은 패널이 그리는 관계가 존재하지 않는 경우라 화면에 도달하지 않는다(패널이 `rel`이 없으면
`null`을 반환한다). 버튼을 비활성으로 두되 문구는 붙이지 않는다.

**교차 테이블을 선택하는 이유:** 원본 관계는 이 mutation으로 사라지므로, 선택이 그 관계에 남아
있으면 패널이 없는 관계를 그리려다 `null`을 반환해 통째로 사라진다. 교차 테이블을 대신 선택해
**방금 만든 것이 무엇인지 보이게** 하고 이름을 바로 고칠 수 있게 한다.

**`selectRelationship(null)`을 함께 부르지 않는다.** `select`와 `selectRelationship`은 둘 다
`CLEARED_SELECTION`을 펼치므로(`store.ts`) 뒤에 부른 `select`가 앞 줄의 효과를 **전부** 덮는다 —
`selectRelationship(null)`은 죽은 코드다. 잠겨 있는 것은 두 호출의 상대 순서가 아니라
`select`가 관계 선택까지 지운다는 성질이고, 그 성질은 패널이 사라지는 것을 DOM으로 단언해 잠근다
(6.2).

---

## 6. 테스트 전략

### 6.1 core (`relationship.test.ts`에 추가)

순수 함수이므로 여기서 대부분 잡힌다.

| 무엇을 잠그는가 | 단언 |
|---|---|
| 교차 테이블의 PK | FK 2컬럼이 모두 `isPk: true`이고, 교차 테이블의 PK 컬럼이 정확히 그 둘 |
| 원본 소멸 | 원본 관계 id가 `relationships`에 없고, 원본 FK 컬럼 id가 `columns`에 없다 |
| 새 관계 2개 | 각각 `parentTableId`가 원본 parent/child, `childTableId`가 교차 테이블, `identifying: true`, `cardinality: '1:N'` |
| **원본 FK를 쓰던 인덱스 정리** | 그 컬럼만 있던 인덱스는 삭제되고, 다른 컬럼과 함께 있던 인덱스는 그 컬럼만 빠진다 |
| 식별 관계 no-op | `identifying: true`인 관계에 부르면 반환 모델이 입력과 **깊게 같다** |
| 부모 PK 없음 no-op | 원본 부모에 PK가 없으면 반환 모델이 입력과 깊게 같다 |
| **FK가 자식의 유일한 PK면 no-op** | `identifying: false`인데 FK 컬럼의 `isPk`가 `true`이고 그것이 자식의 유일한 PK일 때 입력과 깊게 같다 — 삭제 **전** 개수로 세면 통과해 버리는 케이스다(3.4) |
| **하위 관계가 FK 컬럼을 참조하면 no-op** | 손자 테이블이 있는 3단 모델에서 입력과 깊게 같다(3.3). `identifying: false`인데 FK의 `isPk`가 `true`인 상태로 만들어야 한다 — 식별 관계 가드에 먼저 걸리면 이 가드를 검증하지 못한다 |
| **삭제량이 자식 PK 수를 넘어도 no-op** | 매핑이 자식 밖 컬럼을 가리켜 뺄셈이 음수가 되는 모델에서 입력과 깊게 같다 — `<= 0` 이중 방어를 단독으로 잠근다(3.4) |
| **중복 매핑** | 같은 `childColumnId`가 두 번 담긴 모델에서, 자식 PK가 남으면 정상적으로 풀고(dedup 단독 구분력) 안 남으면 no-op 이다(3.4) |
| 없는 관계 no-op | 존재하지 않는 id로 부르면 입력과 깊게 같다 |
| 자기참조 이름 충돌 | 부모 = 자식일 때 FK 물리명이 서로 다르다(`_2`) |
| `junctionTableName` | 두 논리명을 구분자 없이 이어붙인다 |

**no-op 단언은 `toEqual(model)`로 깊게 비교한다.** 반환값만 보면 "테이블은 만들고 관계는 안 만든"
부분 상태를 놓친다.

### 6.2 웹

| 무엇 | 단언 |
|---|---|
| `planJunction` (`edges.test.ts`) | 네 `reason` 각각, 물리명 생성 3갈래(사전 완전·부분·없음 → `TABLE_n`), 발급된 id 개수가 PK 개수와 맞는다, 죽은 그룹뷰 id를 미배정으로 떨군다, 부모의 `groupPosition`이 `null`이면 `position`으로 대신 센다 |
| 패널 (`relationship-panel.test.tsx`) | 비활성 사유 3개(`identifying` · `no-pk` · `downstream`) 각각 버튼이 `disabled`이고 이유 문구가 보인다 / 정상일 때 클릭하면 교차 테이블이 생기고 원본 관계가 사라진다 / 읽기 전용이면 버튼이 없다 / **선택이 사라진 관계에 남으면 패널이 DOM에서 사라진다**(5.3의 선택 이동이 막는 것) |

⚠️ **가드는 core와 웹 양쪽에 있고, 한쪽 테스트가 다른 쪽을 대신하지 못한다.** 같은 규칙이라도
core 가드는 `relationship.test.ts`가, 웹 가드는 `edges.test.ts`가 각각 잠근다 — core만 타는 경로가
실재하기 때문이다(4.2의 no-op 규약).

⚠️ **패널의 DOM 테스트가 잠그는 것은 결과이지 호출 순서가 아니다.** 핸들러를 `async`로 바꿔
`select`를 `await mutate(...)` 뒤로 옮겨도 최종 상태는 같아서 전부 통과한다(실측). 중간 렌더에서
패널이 한 번 빈다는 것은 이 스위트가 잡지 못한다.

### 6.3 구분력

각 수정에 대해 프로덕션 코드를 되돌려 **새 단언이 실제로 실패하는지** 확인하고 복구한다. 특히:

- `deleteColumnCascade` → `deleteRelationship`으로 바꾸면 "원본 FK 컬럼이 없다" 단언이 실패해야 한다
  (이걸 바꿔도 통과하면 고아 컬럼을 잡지 못하는 테스트다)
- `identifying: true` → `false`로 바꾸면 PK 단언이 실패해야 한다
- 식별 관계 가드를 지우면 no-op 단언이 실패해야 한다 — **하위 관계 참조 가드는 이것을 대신하지
  않는다.** 한쪽만 지우면 그쪽 단언만 실패한다(실측)
- 하위 관계 참조 가드를 지우면 3단 모델 no-op 단언이 core·웹 양쪽에서 실패해야 한다
- `<= 0` → `=== 0`으로 되돌리면 "삭제량이 자식 PK 수를 넘어도 no-op" 단언이 실패해야 한다
- `groupPosition ?? position` 폴백을 빼면 그룹뷰 중점 단언이 실패해야 한다

⚠️ **이중 방어를 넣으면 각각의 단독 구분력이 사라진다.** dedup과 `<= 0`은 겹치므로, 한쪽만 잠그는
모델(중복은 있는데 PK가 남는 경우 / 중복은 없는데 뺄셈이 음수인 경우)을 따로 만들어야 한다.

### 6.4 브라우저 스모크

이 사이클의 스모크는 **기능 확인이 아니라 실제 설계처럼** 돌린다 — 사용자가 아직 이 도구로 실제
모델을 만들어 본 적이 없어서, 다대다가 있는 작은 모델(회원 · 상품 · 관심상품)을 처음부터 만들며
마찰을 함께 찾는다. 최소한 다음을 본다:

- 관계를 긋고 버튼을 눌러 교차 테이블이 생기는 것, **DDL 내보내기에 복합 PK가 실제로 나오는 것**
- 식별 관계로 바꾸면 버튼이 비활성이 되는 것(대조군)
- 사전에 단어가 없을 때 물리명과 경고가 어떻게 보이는지

---

## 7. 알려진 한계 (이월 후보)

- **교차 테이블의 추가 속성 컬럼을 만들어 주지 않는다.** 주문상품의 수량·단가처럼 교차 테이블에
  속성이 붙는 경우가 흔하지만, 무엇이 필요한지는 도메인마다 다르므로 만든 뒤 편집 패널에서 넣는다.
- **되돌리기(교차 테이블 → 1:N)는 없다.** 잘못 눌렀으면 `cmd+Z`로 되돌린다. 나중에 다시 1:N으로
  바꾸려면 교차 테이블을 지우고 관계를 다시 긋는다.
- **연쇄가 깨지는 관계는 풀 수 없다**(3.3) — 식별 관계이거나, FK 컬럼을 부모로 삼는 다른 관계가
  있는 경우다. 전자는 사용자가 식별 관계를 먼저 해제해야 하는데 그 해제 자체가 자식 PK를 바꾸므로
  같은 연쇄 문제가 그 시점에 드러나고, 후자는 하위 관계를 먼저 정리해야 한다. 둘 다 다루려면
  "PK 구성 변경이 하위 관계에 미치는 영향"을 일반적으로 처리해야 하고, 그것은 이 기능보다 큰
  주제다. **`setRelationshipIdentifying`·컬럼 PK 편집에는 이 가드가 없다** — 같은 고아 컬럼을
  다른 경로로 만들 수 있다는 뜻이고, 그것도 위 일반 처리에 딸린 문제다.
- **대리키 방식을 고를 수 없다**(D2). 조직 표준이 대리키인 곳에서는 만든 뒤 대리키 컬럼을 추가하고
  두 FK의 `isPk`를 해제한 다음 UNIQUE 인덱스를 직접 만들어야 한다.
- **자기참조 다대다의 기본 이름이 어색하다**(3.5) — `사원사원` · `사원번호_2`. 캔버스가 자기참조
  연결을 막아 DDL 역설계로 들어온 관계에서만 발생하므로 특별 규칙을 넣지 않았다.

---

## 8. 이 사이클과 무관하게 발견한 것 (이월)

**새 테이블에 논리명을 입력해도 물리명이 자동 생성되지 않는다.** `addTable`이 물리명에 `TABLE_n`을
채우는데(`model-edits.ts:11`), 편집 패널은 **물리명이 빈 문자열일 때만** 자동 생성한다
(`edit-panel.tsx:92`). 그래서 "테이블 추가 → 논리명 `주문` 입력" 흐름에서 물리명은 `TABLE_1`로 남고,
사용자가 물리명을 직접 지워야 `ORD`가 생성된다.

이 설계는 교차 테이블의 물리명을 **직접 계산해 넣으므로**(5.2) 영향받지 않는다. 다만 일반 테이블
생성 경로에는 남아 있는 마찰이고, 실제로 모델을 만들어 보면 바로 걸린다. 고치려면 결정이 하나
필요하다 — `addTable`이 물리명을 비워 두게 할 것인가(그러면 물리명 없는 테이블이 잠시 존재한다),
아니면 편집 패널이 "임시 기본값처럼 보이면 덮어쓴다"고 판정할 것인가(`TABLE_n` 패턴 매칭이라
사용자가 진짜로 `TABLE_1`을 원한 경우와 구별되지 않는다).
