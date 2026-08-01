# 역할 기반 읽기 전용 화면 설계

**작성일:** 2026-08-01
**상태:** 승인 대기
**원 기획:** [docs/01-concepts.md](../../01-concepts.md) 권한 모델, [docs/90-roadmap.md](../../90-roadmap.md) Phase 3 "권한 세분화(필요 시 …)"
**해소하는 항목:** 로드맵 Phase 3 마지막 항목 — 검토 결과 **새 권한 축은 만들지 않고**, 이미 있는 역할이 화면에 반영되지 않는 결함을 고친다

## 목표

Project Viewer가 에디터를 열면 편집 어포던스가 보이지 않고, Project Editor에게는 `'manage'` 전용 동작(스냅샷 복원·삭제)이 보이지 않게 한다.

지금은 서버 게이트만 있고 화면은 역할을 전혀 보지 않는다. `apps/web/src/editor/*` 어디에도 `canEdit` 개념이 없어, **Viewer에게 테이블 추가·삭제·편집 버튼이 전부 보이고** 누르면 낙관적 반영 → 서버 `FORBIDDEN` → `resync` 롤백 + 토스트로 화면이 튄다. 데이터는 안전하지만 "쓸 수 있는 것처럼 보였다가 튕기는" UX다.

## 권한 세분화 검토 결론 (사용자 확정)

로드맵 문구는 "**필요 시** 그룹 단위 편집 권한 등 검토"다. 검토 결과 **새 권한 축은 도입하지 않는다.**

- **그룹 단위 편집 권한** — 도입하지 않는다. `table`만 `groupId`를 갖고 `column`·`relationship`·`index`는 소속 테이블을 거슬러 올라가야 하며, `domain`·`word`·`term`·`customField`는 애초에 그룹에 속하지 않아 규칙 정의부터 애매하다. 비용 대비 실익이 확인되지 않았다.
- **사전·도메인 편집 권한 분리**(표준 축 vs 모델 축) — 도입하지 않는다. `ENTITY_KINDS`가 두 축으로 깔끔히 갈려 구현은 싸지만, 현재 필요가 확인되지 않았다.
- **실제 필요는 "이미 있는 역할이 UI에 반영되지 않는 것"** 하나였다. 이번 작업의 범위는 여기까지다.

## 핵심 결정 (사용자 확정)

- **숨김 + 입력 잠금.** 편집 전용 버튼은 숨기고, 조회용 패널은 그대로 두되 입력만 읽기 전용으로 잠근다. 값(타입·도메인·설명)은 Viewer가 봐야 하는 정보이므로 감추지 않는다. 전부 회색 `disabled`로 두거나 별도 조회 화면을 만드는 안은 기각했다.
- **캔버스 드래그는 완전 고정.** 노드 위치는 모델 상태(`position`)라 서버에 저장된다. "로컬로만 움직이고 저장 안 함"은 로컬 전용 모델 분기라는 새 개념을 만들고, 실시간 전체 리로드가 뜨면 예고 없이 원위치로 튀는 불일치가 생긴다. 팬·줌·선택·경고 배지는 유지한다.
- **`canManage`도 함께 배선한다.** 스냅샷 복원·삭제는 서버가 `'manage'` 게이트인데 `version-dialog.tsx`가 Editor에게도 버튼을 보여준다. Viewer 문제와 같은 결함이고 배선이 동일해 함께 고친다.

**범위 밖:** 새 권한 역할·축(그룹 단위, 표준 축 분리), Org 관리 화면(`org-detail.tsx`는 이미 `canManage` 분기가 있다), 프로젝트 설정 화면(`project-settings.tsx`는 이미 `canManage` 분기가 있고 편집 폼이 없다), ApiToken 권한(Phase 4 CLI와 함께).

## 아키텍처 / 방침

**서버는 판정 결과를 내려주기만 한다.** `perm.ts`·라우터 게이트는 그대로다.

| 계층 | 파일 | 책임 |
|---|---|---|
| server | `routers/project.ts` (수정) | `get`이 `canEdit`·`canManage`를 함께 반환 |
| web | `editor/store.ts` (수정) | `canEdit`·`canManage` 보관, 기본값 `false` |
| web | `editor/use-model.ts` (수정) | `project.get` → store 배선, `useSubmit` 안전망 가드 |
| web | `editor/*.tsx` 다수 (수정) | 어포던스 숨김·입력 잠금 |

### 1. 판정은 서버가 한다 — 클라는 역할 조합을 미러링하지 않는다

`project.get`이 이미 `requireProjectAccess(…, 'view')`로 얻은 `ProjectAccess`를 갖고 있다. 거기서 `canEdit`·`canManage`를 그대로 실어 보낸다. 클라가 `myOrgRole === 'owner' || myOrgRole === 'admin' || myRole === 'admin' || myRole === 'editor'` 같은 식을 손으로 재현하면 `perm.ts`가 바뀔 때 조용히 어긋난다 — HANDOFF 6절이 `NamingRulesSchema`에서 지적한 "손-미러" 안티패턴과 같다.

기존 `myRole`·`myOrgRole` 반환은 **유지한다**(`project-settings.tsx`가 역할 배지 표시에 쓴다).

### 2. 전달 경로는 기존 선례를 그대로 쓴다

새 React context를 만들지 않는다. 같은 성격의 값이 이미 같은 경로로 흐른다 — `use-model.ts:25`의 주석 그대로 *"명명 규칙·방언은 프로젝트 설정(버전 모델 밖)이라 `project.get`으로 별도 로드해 store에 둔다"*.

```
project.get → use-model.ts의 setProjectConfig → store → useEditorStore(s => s.canEdit)
```

**기본값은 `canEdit: false` / `canManage: false`(fail-closed).** Viewer에게 편집 UI가 잠깐 번쩍였다 사라지는 일이 없어야 한다. Editor 쪽 깜빡임은 실질적으로 없다 — `model.get`(전체 모델)과 `project.get`(한 행)이 병렬로 나가고 후자가 거의 항상 먼저 도착하는데, 툴바 자체가 `loaded`(=`model.get` 완료)로 게이트돼 있다.

### 3. 안전망: `useSubmit` 한 곳에 최종 가드

`useSubmit`이 `canEdit === false`면 서버 왕복도 낙관적 적용도 없이 즉시 `'error'` + 토스트로 끝낸다. 위치는 기존 프로젝트 전환 가드(`loadedProjectId !== projectId`) 바로 다음이다.

어포던스 숨김이 17개 파일에 흩어지므로 하나쯤 놓칠 수 있다. 이 가드가 있으면 최악이 "버튼이 보이는데 눌렀더니 안내 토스트"로 끝나고, 지금처럼 낙관적 적용 → `FORBIDDEN` → `resync` 롤백으로 화면이 튀지 않는다. **보안 경계가 아니다** — 서버가 이미 전부 막는다. UX 일관성 장치다.

⚠️ **가드는 `useSubmit`에만 넣는다. `serializeMutation`이나 `use-realtime.ts`에는 절대 넣지 않는다.** 수신 op 처리는 `serializeMutation` 체인 안에서 `applyOps`·`setModel`·`resync`를 직접 부르고 `useSubmit`을 거치지 않는다(`use-realtime.ts:103-128`). `serializeMutation`에 가드를 걸면 **Viewer가 남의 변경을 받지 못해 화면이 얼어붙는다** — Viewer도 수신·presence는 정상 동작해야 한다는 Phase 3 실시간 설계 확정 사항([2026-07-29-phase3-realtime-collab-design.md](2026-07-29-phase3-realtime-collab-design.md))에 정면으로 어긋난다.

### 4. 화면별 처리

| 영역 | 파일 | Viewer(`canEdit=false`)에게 |
|---|---|---|
| 툴바 편집군 | `toolbar.tsx` | 테이블 추가·메모·자동 정렬·삭제·실행 취소·다시 실행 숨김. 자리에 `읽기 전용` 배지 |
| 캔버스 | `canvas.tsx` | 노드·그룹 드래그, 관계 연결, Delete 키 삭제 차단. 팬·줌·선택·경고 배지 유지 |
| 테이블 트리 | `table-tree.tsx` | `그룹 추가` 버튼 숨김(이 파일의 유일한 편집 액션). 검색·선택·그룹 이동 유지 |
| 편집 패널 | `edit-panel.tsx`, `relationship-panel.tsx`, `note-panel.tsx`, `group-panel.tsx`, `index-section.tsx`, `custom-fields-section.tsx` | 입력은 `readOnly`/`disabled`, 추가·삭제·재생성·용어 등록 버튼 숨김. 값과 경고 배지는 그대로 |
| 사전 | `dict-panel.tsx`, `dict-import-section.tsx` | 목록·사용처·미등록 단어 열람 유지. 추가·수정·삭제·Excel 업로드 숨김 |
| 도메인 | `domain-panel.tsx`, `domain-edit-dialog.tsx` | 목록·정의 열람 유지. 추가·수정·삭제·일괄 반영 숨김 |
| 커스텀 항목 | `custom-field-panel.tsx`, `custom-field-edit-dialog.tsx` | 정의 열람 유지. 추가·수정·삭제 숨김 |
| 공용 리소스 | `resource-panel.tsx` | 라이브러리·항목 열람 유지. 가져오기·재동기화 숨김 |
| 버전 | `version-dialog.tsx` | 스냅샷 목록·이력·비교(diff) 유지. **만들기** 숨김(`canEdit`), **복원·삭제** 숨김(`canManage`) |
| 모델 검사 · 내보내기 · 그룹 뷰 · 뷰 모드 | `naming-check.tsx`, `export-dialog.tsx`, `group-view-select.tsx`, `view-mode-toggle.tsx` | 그대로. 01-concepts의 "Project Viewer — 조회, 내보내기" |
| 실시간 | `use-realtime.ts`, `presence.tsx` | 그대로 접속·수신·presence |

`canManage`가 걸리는 곳은 `version-dialog.tsx`의 복원·삭제뿐이다. 나머지는 전부 `canEdit`이다.

## 인터페이스

```ts
// apps/server/src/routers/project.ts — get의 반환에 추가 (myRole/myOrgRole은 유지)
canEdit: access.canEdit,
canManage: access.canManage,

// apps/web/src/editor/store.ts
type EditorState = {
  // …기존 필드
  /** 모델을 편집할 수 있는가(서버 판정). 로드 전 기본값 false — fail-closed. */
  canEdit: boolean
  /** 프로젝트를 관리할 수 있는가(스냅샷 복원·삭제). 로드 전 기본값 false. */
  canManage: boolean
  setProjectConfig: (
    namingRules: NamingRules,
    dialects: Dialect[],
    perms: { canEdit: boolean; canManage: boolean },
  ) => void
}
```

`setProjectConfig`에 인자를 더하는 이유는 호출부가 한 곳(`use-model.ts`)이고 셋 다 같은 `project.get` 응답에서 나오기 때문이다. 별도 setter를 만들면 두 번 렌더가 돈다.

## 전역 제약 (Global Constraints)

- **`packages/core`는 건드리지 않는다. 새 마이그레이션 없음.** 서버 변경은 `routers/project.ts`의 반환 필드 2개뿐이다.
- 불가침: `apps/server/src/services/perm.ts`(판정 로직), 라우터의 기존 게이트, `packages/core/src/diff.ts`·`op.ts`·`integrity.ts`·`model.ts`.
- **가드는 `useSubmit`에만.** `serializeMutation`·`use-realtime.ts`에 넣으면 Viewer의 실시간 수신이 죽는다.
- 클라가 역할 조합식을 재현하지 않는다 — `canEdit`·`canManage`는 서버가 준 값을 그대로 쓴다.
- store 기본값은 `false`(fail-closed).
- 새 런타임 의존성 금지. UI 카피는 한국어. 배지 문구는 `읽기 전용`.
- **웹 재발 버그 주의**: 이벤트 값은 producer 진입 **전에** 캡처한다(HANDOFF §3.4).
- 커밋은 명시 파일만(`git add .`/`-A` 금지), `.idea/*`·`.env` 제외. 커밋 메시지 한국어 + 트레일러 2줄.

## 테스트 전략

**store** (`store.test.ts`)
- `canEdit`·`canManage` 기본값이 `false`다(fail-closed)
- `setProjectConfig`가 셋을 함께 반영한다

**mutation 가드** (`use-model.test.tsx`)
- `canEdit=false`면 `submit`이 `'error'`를 반환하고 **`model.mutate`를 호출하지 않는다**(서버 왕복 없음)
- `canEdit=false`에서 store의 모델이 바뀌지 않는다(낙관적 적용 없음)
- `canEdit=true`면 기존 동작 그대로다

**실시간 회귀** (`use-realtime.test.tsx`)
- `canEdit=false`여도 수신 op가 정상 적용된다 — 가드를 `serializeMutation`에 잘못 넣으면 실패해야 하는 테스트

**화면** (각 컴포넌트 테스트)
- `canEdit=false`에서 편집 어포던스가 없다(툴바 편집군, 추가·삭제 버튼, 입력 활성 상태)
- `canEdit=false`에서 조회 요소는 그대로 있다(값, 목록, 경고 배지, 내보내기)
- `version-dialog`: `canEdit=false`면 만들기 없음 / `canManage=false`면 복원·삭제 없음 / `canEdit=true·canManage=false`(Editor)에서 만들기는 있고 복원·삭제는 없다

`canEdit=true` 경로는 기존 293개 웹 테스트가 그대로 회귀 방어를 한다 — 기본값을 `false`로 바꾸면 대부분이 깨지므로, 테스트 헬퍼의 store 초기화에서 `canEdit: true`를 기본으로 두고 읽기 전용 케이스만 명시적으로 `false`를 넣는다.

## 열린 항목 (이번 범위 밖, 기록만)

- 그룹 단위 편집 권한, 표준 축(사전·도메인) 편집 권한 분리 — 필요가 확인되면 별도 사이클
- presence에서 Viewer를 Editor와 구분해 표시(현재는 구분 없음)
- ApiToken의 read/write 권한 집행 — Phase 4 CLI와 함께
