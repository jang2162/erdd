# 관계선을 컬럼 위치에 붙인다 (복합키 포함) — 설계

**작성:** 2026-08-12 / **기준 main:** `13bcbca`

---

## 1. 목적과 범위

지금 관계선은 테이블 노드의 **좌우 세로 중앙**에서 나간다(`table-node.tsx:55-58`의 `l`/`r` 핸들
2개). 어느 컬럼이 어느 컬럼을 참조하는지가 그림에 없어서, 컬럼이 10개인 테이블에 관계가 3개
걸리면 세 선이 같은 점에서 갈라져 나온다. dbdiagram·DataGrip 같은 도구는 **실제 FK 컬럼 행**에
선을 붙인다.

이 트랙은 그것을 맞춘다.

- 단일 컬럼 FK → 자식의 FK 컬럼 행 ↔ 부모의 참조 컬럼 행
- 복합 FK → 양쪽 테이블 맨 아래의 **합성 행 `(col1, col2)`** 끼리 선 하나

**범위 밖(의도적으로 뺀 것):**

- 컬럼→컬럼 드래그로 관계 만들기 (D-3)
- 관계에 쓰이지 않는 복합 PK·복합 인덱스의 합성 행 (D-2)
- 같은 컬럼에 여러 관계가 붙을 때의 선 겹침 해소 — 겹치게 둔다
- FK 링크 아이콘(🔗) 같은 컬럼 행 표시 확장 — 연결 위치와 별개 기능이다
- 자기참조 관계의 특수 라우팅 — 기존과 같은 규칙을 그대로 태운다

**core·서버·CLI 변경 없음. 마이그레이션 없음.** 모델 스키마를 건드리지 않는다 — 필요한 정보
(`relationship.columnMappings`, `column.order`)가 전부 이미 있다.

---

## 2. 확정된 결정 (사용자 확정)

### D-1. 복합키 관계는 **합성 행 + 선 1개**다

테이블 맨 아래에 `(order_id, product_id)` 행을 그리고 그 행끼리 선 하나로 잇는다. 매핑 컬럼마다
선을 따로 그리는 안(선 2개)과 첫 컬럼에만 붙이는 안은 배제했다.

### D-2. 합성 행은 **관계가 쓰는 조합에만** 만든다

복합 PK·복합 인덱스가 정의돼 있어도 관계에 안 쓰이면 행을 만들지 않는다. 이유는 **선을 붙일
자리가 항상 보장된다**는 것 하나다 — dbdiagram 방식(인덱스 기준)으로 가면 "관계가 쓰는 조합이
인덱스로 정의돼 있지 않다"는 흔한 상태에서 붙일 행이 없어 별도 규칙이 또 필요해진다.

복합 PK를 표시하는 목적이라면 이미 컬럼마다 🔑가 붙어 있으므로 잉여다.

### D-3. 드래그 연결은 **기존 그대로**다 — 컬럼 핸들은 표시 전용

관계 생성 드래그는 지금처럼 테이블 좌우의 보이는 점(`l`/`r`)에서 시작하고 `planConnection`이
부모 PK 수만큼 FK 컬럼을 만든다. 컬럼 핸들은 **보이지 않고 `isConnectable={false}`** 다.
"자식 컬럼을 집어 부모 컬럼에 떨어뜨리는" UX는 타입 불일치·복합키 부분 지정 판정이 새로 필요해
범위가 크게 는다.

### D-4. mixed 뷰 모드에서 합성 행은 **물리명만** 쓴다

컬럼 행은 mixed에서 물리명·논리명을 둘 다 보이지만, 합성 행은 컬럼이 2~3개라 둘 다 넣으면 노드가
과하게 넓어진다. `logical` 모드에서는 논리명 조합, 그 외에는 물리명 조합이다.

---

## 3. 의미 모델

### 3.1 앵커(anchor) — 선이 붙는 자리

**앵커는 "한 테이블 안에서 선이 붙을 수 있는 한 지점"이고, 컬럼 id 집합으로 식별된다.**

| 원소 수 | 렌더되는 곳 | 예 |
|---|---|---|
| 1 | 그 컬럼 행 | `order_items.order_id` 행 |
| 2 이상 | 테이블 맨 아래 합성 행 | `(order_id, product_id)` |

관계 하나는 **양 끝에 각각** 앵커를 갖는다. 부모 쪽 앵커는 `columnMappings[].parentColumnId`
집합이고 자식 쪽은 `childColumnId` 집합이다 — **둘은 서로 다른 컬럼 집합이므로 따로 계산한다.**
(부모의 `(order_id, product_id)`와 자식의 `(order_id, product_id)`는 이름만 같지 다른 컬럼이다.)

### 3.2 앵커 키

```
단일: c:<columnId>
복합: s:<columnId>+<columnId>+...
```

**컬럼 id는 UUIDv7이라 `:`·`+`를 포함하지 않는다** — 구분자가 안전한 근거가 그것이다.

복합 키의 컬럼 순서는 **`column.order` 오름차순, 동률이면 컬럼 id 사전순**이다. 정렬을 고정하지
않으면 같은 조합이 `columnMappings` 배열 순서에 따라 다른 키가 되어, 같은 행에 붙어야 할 두
관계가 서로 다른(존재하지 않는) 핸들을 가리킨다.

### 3.3 ⚠️ 급소 — 앵커 키의 소재지는 **한 곳**이다

엣지는 `sourceHandle`/`targetHandle`에 문자열로 핸들 id를 적고, 노드는 그 id로 `<Handle>`을
렌더한다. **두 문자열이 한 글자라도 어긋나면 React Flow는 붙일 핸들을 못 찾고 선이 조용히
사라진다** — 예외도 경고도 없다.

그래서 앵커 계산은 순수 함수 `buildAnchors(model)` **하나**가 하고, 엣지·노드·고스트 세 소비자가
그 결과만 읽는다. 각자 계산하는 코드를 절대 만들지 마라.

```
anchors.ts  buildAnchors(model) → AnchorIndex
   ├─ buildEdges       → sourceHandle: `l:${key}` / `r:${key}`
   ├─ buildNodes       → TableNodeData.anchors → TableNode이 그 키로 Handle 렌더
   └─ buildGhostNodes  → GhostNodeData.anchors → GhostNode이 전부 헤더 중앙에 겹쳐 렌더
```

### 3.4 고스트 노드도 **같은 앵커 핸들을 전부 갖는다**

그룹 뷰의 외부 참조 고스트(`ghost-node.tsx`)는 헤더만 있고 컬럼 행이 없다. 그래도 그 테이블의
앵커 핸들을 **전부, 같은 자리(헤더 세로 중앙)에 겹쳐서** 렌더한다.

이유는 분기를 없애기 위해서다 — 고스트가 앵커 핸들을 가지면 `buildEdges`는 "상대가 고스트인가"를
알 필요가 없고, 엣지는 언제나 앵커 키만 쓴다. 결과 그림은 기존과 같다(헤더 중앙에서 선이 나간다).

`buildEdges`에 고스트 집합을 넘기는 대안은 시그니처가 늘고 그룹 뷰 경로에만 사는 분기가 생긴다.

### 3.5 폴백 — 중앙 `l`/`r`로 떨어지는 경우

앵커 키가 `null`이면 그 **끝만** 기존 중앙 핸들을 쓴다(양 끝을 각각 판정한다).

| 상황 | 앵커 키 |
|---|---|
| `columnMappings`가 빈 관계 | 양 끝 `null` |
| 매핑이 모델에 없는 컬럼 id를 가리킴(dangling) | 유효 컬럼만 남기고, 0개면 그 끝 `null` |
| 매핑 컬럼이 그 관계의 테이블 소속이 아님 | 위와 같이 걸러진다 |

빈 매핑 관계는 실제로 존재한다 — DDL/DBML 가져오기가 만들 수 있고, `edges.test.ts`의 기존 픽스처가
바로 그 형태다(`columnMappings: []`). 그래서 폴백은 예외 처리가 아니라 **정상 경로**다.

### 3.6 중복 매핑은 dedup 한다

`remapRelationshipChildColumn`이 같은 `childColumnId`를 두 번 담을 수 있다(`edges.ts:105-107`의
`planJunction`이 같은 이유로 이미 dedup 한다). 중복을 세면 단일 컬럼 관계가 복합으로 오인되어
없는 합성 행을 가리킨다.

### 3.7 좌/우 판정은 **바꾸지 않는다**

`child.position.x >= parent.position.x`면 자식의 왼쪽 핸들 ↔ 부모의 오른쪽 핸들
(`edges.ts:24`). 앵커가 생겨도 판정 근거는 여전히 **테이블 위치**다. 컬럼별로 좌우를 따로 고르면
같은 테이블에서 나가는 선들이 제각각 방향을 잡아 그림이 더 나빠진다.

---

## 4. core 변경

**없다.** `columnMappings`·`column.order`가 이미 필요한 정보를 전부 담고 있다. core가 움직였다면
범위를 넘은 것이다.

---

## 5. 웹 변경

### 5.1 파일

| 파일 | 변경 |
|---|---|
| `editor/anchors.ts` | **신규** — `buildAnchors` 순수 함수, `Anchor`·`AnchorIndex` 타입 |
| `editor/anchors.test.ts` | **신규** |
| `editor/edges.ts` | `buildEdges`가 앵커 키로 `sourceHandle`/`targetHandle`을 정한다 |
| `editor/nodes.ts` | `TableNodeData.anchors`를 싣는다 |
| `editor/table-node.tsx` | 컬럼 행 핸들 + 합성 행 렌더 |
| `editor/ghost-nodes.ts` · `ghost-node.tsx` | `GhostNodeData.anchors` + 겹친 핸들 |
| `editor/canvas.tsx` | `buildAnchors` 1회 계산해 셋에 넘김 + `updateNodeInternals` effect |

### 5.2 `anchors.ts` — 순수 함수 경계

```ts
export type Anchor = {
  /** `c:<id>` 또는 `s:<id>+<id>` */
  key: string
  /** column.order 오름차순(동률이면 id 사전순)으로 고정 정렬된 컬럼 id */
  columnIds: string[]
}

export type AnchorIndex = {
  /** 테이블 id → 그 테이블에 렌더할 앵커 목록(키로 중복 제거) */
  byTable: Map<string, Anchor[]>
  /** 관계 id → 양 끝 앵커 키. null이면 그 끝은 중앙 핸들 폴백(3.5) */
  byRelationship: Map<string, { childKey: string | null; parentKey: string | null }>
}

export function buildAnchors(model: ProjectModel): AnchorIndex
```

`byTable`의 목록 순서도 고정한다(단일 → 복합, 그 안에서는 첫 컬럼의 `order` 순). 순서가 흔들리면
합성 행이 렌더마다 자리를 바꾼다.

### 5.3 소비자 시그니처 — 기본값을 **자기 계산**으로 둔다

```ts
buildEdges(model, visibleTableIds?, peerMarks?, anchors = buildAnchors(model))
buildNodes(model, viewMode, selectedIds, warnings, view?, peerMarks?, columnSelection?, anchors = buildAnchors(model))
buildGhostNodes(model, groupId, anchors = buildAnchors(model))
```

기본값을 옵셔널 `undefined`가 아니라 **자기 계산**으로 두는 이유: 인자를 빠뜨려도 결과가 옳다.
`undefined`면 배선 누락이 "전부 중앙으로 조용히 폴백"으로 나타나 눈에 띄지 않는다.

`canvas.tsx`는 `useMemo(() => buildAnchors(model), [model])`로 한 번 계산해 셋 모두에 넘긴다
(중복 계산 회피 + 5.5의 effect가 같은 값을 봐야 한다).

### 5.4 `table-node.tsx` — 핸들과 합성 행

- 컬럼 행(`<li>`)에 `relative`를 주고, 그 컬럼이 단일 앵커면 좌·우 `<Handle>`을 그 안에 넣는다.
  Handle은 `position: absolute`이므로 **가장 가까운 positioned 조상** 기준으로 배치된다 — `relative`를
  빼먹으면 노드 루트 기준이 되어 전부 같은 자리에 겹친다.
- 합성 행은 컬럼 목록 **맨 아래**에 같은 `<ul>`의 `<li>`로 넣는다(`divide-y`가 구분선을 준다).
  배경만 살짝 구분한다(`bg-secondary/40`). 클릭 대상이 아니다 — `role="button"`도 `onClick`도 없다.
- 컬럼 핸들·합성 행 핸들은 전부 `isConnectable={false}` + 시각적으로 감춘다(`!h-0 !w-0 !min-w-0
  !min-h-0 !border-0 !bg-transparent`). **`display:none`으로 감추면 안 된다** — `getBoundingClientRect`가
  0이 되어 `handleBounds` 좌표가 무너진다.
- 기존 중앙 `l`/`r` 핸들은 **그대로 남는다**(드래그 시작점 + 폴백 자리).

라벨은 D-4에 따라 `logical` 모드면 논리명 조합, 그 외에는 물리명 조합이다.

### 5.5 ⚠️ `updateNodeInternals` — 핸들이 동적이 되면서 생기는 새 의무

**핸들 집합이 이제 모델에 따라 변한다.** 관계를 만들거나 지우면 그 두 테이블의 앵커가 늘고 준다.
React Flow는 `<Handle>`이 붙고 떨어져도 `handleBounds`를 **자동으로 다시 파싱하지 않는다** —
`updateNodeInternals(id)`를 명시적으로 불러야 한다(v12 공식 문서의 "dynamic handles" 항목).
부르지 않으면 관계를 만든 직후 선이 옛 자리에 남거나 붙지 못한다.

`canvas.tsx`에 effect를 둔다 — 이전 `byTable`과 비교해 **앵커 키 목록이 달라진 테이블 id만** 모아
`updateNodeInternals(ids)`를 부른다. 이전 값은 `useRef`에 담는다.

**`keepMeasured`(`canvas.tsx:62`)와 충돌하지 않는다.** 그 함수는 노드 재구성 때 `measured`가 버려져
`parseHandles`가 **기존 `handleBounds`까지 함께 버리는 것**을 막는다(박스 선택 깜박임의 뿌리).
이쪽은 반대로 **필요할 때 갱신을 시킨다.** 방향이 반대이자 상보적이다 — 보존은 "선택이 바뀌었을
뿐인데 측정이 날아가는 것"을 막고, 갱신은 "핸들이 실제로 바뀌었는데 옛 측정이 남는 것"을 막는다.
둘 중 하나만 있으면 각각 깜박임과 선 어긋남이 난다.

---

## 6. 테스트 전략

### 6.1 순수 함수 (`anchors.test.ts`)

- 단일 컬럼 매핑 → `c:<id>`, 부모·자식 각각
- 복합 매핑 → `s:` 키가 `column.order` 순으로 정렬된다(입력 `columnMappings` 순서를 뒤집어도 같은 키)
- 같은 `order` → id 사전순으로 결정적
- 중복 `childColumnId` dedup → 단일 앵커로 남는다(3.6)
- dangling 컬럼 id → 그 끝만 `null`
- 빈 `columnMappings` → 양 끝 `null`
- 두 관계가 같은 조합을 쓰면 `byTable`에 합성 행이 **하나만** 있다

### 6.2 엣지 (`edges.test.ts`)

- `sourceHandle`이 `l:c:<id>` / `r:s:<id>+<id>` 형태다
- 폴백 3종에서 `l`/`r`로 떨어진다 — **양 끝을 각각** 판정한다(한쪽만 폴백되는 케이스를 포함)
- 좌/우 판정은 기존 그대로다(회귀)

### 6.3 ⚠️ 교차 검증 (필수 — 3.3을 잠그는 유일한 방어)

한 모델(단일 FK·복합 FK·빈 매핑·그룹 뷰 고스트를 모두 담은 픽스처)에서:

1. `buildEdges`가 낸 **모든** `sourceHandle`/`targetHandle`을 모은다
2. `buildNodes`·`buildGhostNodes` → `TableNode`/`GhostNode`를 실제로 렌더해 DOM의 핸들 id를 모은다
3. 1이 2의 부분집합인지 전수 대조한다

앵커 키 규칙을 한쪽에서만 바꾸면 이것만 빨개진다. **구분력 실증**: 키 접두사(`c:`)를 한쪽에서만
바꿔 보고 실제로 빨개지는지 확인한다.

### 6.4 컴포넌트 (`table-node.test.tsx` · `ghost-node` )

- 단일 앵커 컬럼 행에 좌·우 핸들이 있고, 앵커가 아닌 컬럼 행에는 없다
- 합성 행이 컬럼 목록 맨 아래에 렌더되고 라벨이 뷰 모드를 따른다(D-4: mixed는 물리명)
- 합성 행은 클릭해도 컬럼 선택이 일어나지 않는다
- 고스트 노드가 앵커 핸들을 전부 렌더한다(3.4)

### 6.5 `canvas.test.tsx`

- 관계를 추가·삭제해 앵커가 바뀐 테이블에 대해 `updateNodeInternals`가 불린다
- 앵커가 그대로면 불리지 않는다(리렌더마다 부르면 매 프레임 DOM을 다시 재는 비용이 붙는다)

### 6.6 브라우저 스모크

컬럼 위치는 DOM 실측이라 jsdom에서 **좌표가 전부 0**이다 — 단위 테스트는 "어느 핸들에 붙는가"까지만
잠그고 "그 핸들이 화면 어디인가"는 못 본다. 이미지의 4테이블 모델(`orders`·`products`·
`order_items`·`order_item_options`)을 DBML로 가져와 눈으로 확인한다:

1. 단일 FK 선이 해당 컬럼 행 높이에서 나간다
2. 복합 FK 선이 양쪽 합성 행끼리 이어진다
3. 테이블을 드래그해 좌우가 뒤집히면 선이 반대편 핸들로 옮겨 간다
4. 그룹 뷰에서 고스트로 가는 선이 헤더 중앙에 붙는다
5. PNG 내보내기에 같은 그림이 나온다

---

## 7. 알려진 한계 (이월 후보)

- **같은 컬럼에 여러 관계가 붙으면 선이 겹친다.** 자식 컬럼 하나가 두 부모를 참조하는 일은 드물지만
  가능하다. 겹침 해소(핸들을 세로로 흩기)는 이번 범위 밖이다.
- **컬럼이 아주 많은 테이블**에서 선이 세로로 길게 퍼진다. 접기(collapse) 기능이 없어서 완화 수단도
  없다 — 노드 접기는 별도 트랙 후보다.
- **자기참조 관계**는 같은 노드의 두 앵커를 잇는다. `getSmoothStepPath`가 그런 경우 보기 좋은 경로를
  내지 않지만, 기존에도 같은 노드의 `l`→`r`이라 나빠지지는 않는다.
- **FK 링크 아이콘(🔗)** 은 넣지 않았다(범위 밖). 컬럼 행이 관계에 참여한다는 사실은 이제 선이
  붙는 것으로 보이므로 우선순위가 내려간다.
