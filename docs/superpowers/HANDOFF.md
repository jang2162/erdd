# ERDD 작업 인계 문서 (새 세션 시작점)

**최종 갱신:** 2026-09-03 / **main HEAD:** `2618fc6`(`merge: CLI DDL·DBML 내보내기/가져오기 트랙을 병합한다`) / **마이그레이션:** 0013까지(그룹 별칭 `model_table_groups.alias` — **테이블 물리명/논리명 형식 템플릿은 둘 다 마이그레이션 없음**)

새 세션에서 이 프로젝트를 이어받을 때 **이 문서를 먼저 읽고**, 아래 "읽을 문서" 순서를 따르면 된다. 이 문서는 매 sub-project 완료 시 갱신한다.

---

## 1. 현재 상태 요약

### 완료 (main에 머지됨)

| 사이클 | 내용 |
|---|---|
| **초기 MVP** M0~M9 | 계정/조직/프로젝트, GUI 에디터(테이블·컬럼·관계·인덱스·메모), 그룹핑(색상영역·그룹뷰·외부참조 고스트), 버전(Revision 이력·스냅샷·복원), 내보내기(DDL 4방언·이미지 PNG/SVG) |
| **초기 이월 정리** M10 + 후속 | 그룹 영역 드래그, 자동 정렬(dagre), DDL 식별자 조건부 인용(방언별 예약어), 0컬럼 DDL 제외+경고 통합, 그룹 라벨 가림 해소, 중복 헬퍼 통합 |
| **도메인** | 도메인 CRUD·컬럼 지정(라이브 해석·타입란 잠금)·일괄반영·삭제가드·DDL 통합(방언타입·CHECK·기본값), 마이그 0004 |
| **명명 체계** | 단어/용어 op 엔티티, 물리명 자동생성(용어일치→최장일치 분해), 명명 경고 5종(기존 computeWarnings 확장), 사전 관리 화면, 자동생성 에디터 통합, 명명 검사 화면, 마이그 0005 |
| **커스텀 항목** | 정의=10번째 op 엔티티 `customField`(도메인/사전과 동일 패턴), 값=`table.custom`/`column.custom`(문자열, 기본값 라이브 해석, dangling 키 관대). 필수 미입력 경고(`custom-required`), 정의 관리 화면, 편집 패널 인라인 값 입력(text/boolean/select), 검사 화면 표시명 "모델 검사"로 정리, 마이그 0006 |
| **공용 리소스 fork** | 전역·조직 2계층 라이브러리(`resource_libraries`/`resource_items`, op 로그 밖), 모델 4종(domain/word/term/customField)에 `origin` 필드, 3-way 병합 엔진(core `resource-sync.ts` 순수 함수), 프로젝트 "공용 리소스" 통합 화면(가져오기=재동기화 같은 경로), 충돌 항목별 3상태 라디오, 전역 예시 시드, 마이그 0007·0008 |
| **Excel 산출물/업로드** | 정의서 Excel 내보내기 5시트(테이블 목록·테이블정의서·단어사전·용어사전·도메인정의서, 커스텀 항목 컬럼 포함), Excel 사전 업로드(신규/중복/오류 미리보기 + 건너뛰기·덮어쓰기), 양식 다운로드, 범위 선택기 공용화(그룹 드롭다운), `Word.englishName` 추가, 마이그 0009 |

| **스냅샷 diff** | 표시 전용 `diffModelsForDisplay`(core 순수 함수 — 기존 `diffModels`(Op[])는 불가침), 버전 다이얼로그 "비교" 섹션(기준/비교 각각 선택: 현재+스냅샷), 변경분 정의서 Excel(한 시트 flat, 1행 제목·2행 헤더), 배치 좌표 제외, 참조형 속성 이름 해석. **서버 변경·마이그레이션 없음** |
| **실시간 동시편집** | `/ws?projectId=` WebSocket 채널(`@fastify/websocket`, 쿠키 인증·close code 4401/4403), 인메모리 `RealtimeHub`(프로젝트별 채널·같은 사용자 다중 소켓 병합), `mutateAndPublish`로 **커밋 후에만** op 브로드캐스트(모든 변경 경로의 유일한 진입점), 웹 `useRealtime`(seq 3분기: 연속 적용/과거 무시/간극 전체 리로드, 기존 `serializeMutation` 체인 재사용), presence 아바타 + 캔버스 선택 하이라이트, 충돌 토스트. **마이그레이션 없음** |

| **DDL 역설계** | 손으로 쓴 좁은 파서(`CREATE TABLE`/`ALTER TABLE ADD CONSTRAINT`/`CREATE INDEX`/`COMMENT ON`)로 기존 DDL을 파싱해 미리보기 후 모델에 적용. 논리명은 코멘트→사전→물리명 순으로 복원, 왕복이 깨지는 5건은 테스트 상수로 고정. **마이그레이션 없음** |
| **CLI 트랙 A** | 개인 액세스 토큰(`access_tokens` 테이블, `erdd_pat_` 접두 평문 + SHA-256 저장, 만료 없이 폐기만), 조직·프로젝트 역할에서 그대로 파생되는 권한(새 축 아님) + 토큰 노출 프로시저 5개 allowlist(`apiProcedure`), 파일 포맷(`packages/core/src/file-format.ts` — plain object만 다루고 YAML은 모름), 신규 패키지 `packages/cli`(`@erdd/cli`, 바이너리 `erdd`)의 읽기 명령 `init`/`pull`/`status`/`validate`, 마이그 0010 |
| **CLI 트랙 B** | 파일 3-way 병합 core 순수 함수(`packages/core/src/file-merge.ts` — `FILE_FIELDS`/`FILE_INVISIBLE_FIELDS`·`fileVisibleModel`·`mergeModels`·`applyMerge`·`pruneDangling`·`gridPositions`), 신규 프로시저 `model.push`(토큰 allowlist 6번째, 필수 `expectedSeq`를 프로젝트 행 락 안에서 검증해 경합 차단, `model.mutate`는 세션 전용 유지), CLI `push`(필드 단위 자동 병합·충돌 시 블록형 출력+exit 1·삭제 확인 프롬프트·성공 후 암묵적 pull로 신규 id 채움)·`diff`(항상 3-way 계획 미리보기, `--base` 없음)·`skill install`(`.claude/skills/erdd/SKILL.md` 동봉, `--dir`/`--force`). **마이그레이션 없음** |

| **공용 리소스 승격** | fork의 반대 방향 — 프로젝트 사전 4종을 조직/전역 라이브러리로 올린다. core 순수 함수 `resource-promote.ts`(`planPromote` 3상태 분류 / `applyPromotePlan` write+`origin` 갱신), `runMutation`의 트랜잭션 내 선행 훅 `prepare`로 라이브러리 쓰기와 모델 op를 한 트랜잭션에 묶는 신규 프로시저 `resource.promote`(권한 3중·라이브러리 항목 `FOR UPDATE`·기대치 불일치 skip), `listForProject`의 `canWrite`, 공용 리소스 다이얼로그를 탭 2개로 분리 + "조직으로 승격" 탭. **마이그레이션 없음** ([설계](specs/2026-08-04-resource-promotion-design.md)) |
| **승격 요청·승인 큐** | 라이브러리 쓰기 권한이 없는 Editor의 요청 경로. `promotion_requests`(op 로그 밖, 마이그 0011)는 **엔티티 포인터만** 담고 승인 시 `planPromote`를 재계산한다. `resource.promote`의 트랜잭션 본문을 `services/promote.ts`(`runPromoteInTx`·`loadLibraryItems`)로 추출해 승인이 같은 엔진을 타고, 요청 행 종결이 같은 `prepare` 훅에 들어가 함께 롤백된다. 프로시저 7개(`create`/`listForProject`/`cancel`/`listForOrg`/`get`/`pendingCount`/`resolve`), 승격 탭의 요청 모드, 조직 화면 승인 목록·검토 다이얼로그, 헤더·홈 배지 ([설계](specs/2026-08-04-promotion-request-queue-design.md)) |
| **CLI push 멱등성** | 커밋 후 응답이 유실돼도 다음 push가 사본을 만들지 않게 한다. `filesToModel`이 신규 id를 발급하는 자리(`idOf`)에서 그 id를 입력 트리의 복사본에 되써 **`assignedTree`를 함께 내고**, CLI `push`가 `confirmDeletes` 뒤·`model.push` 직전에 **id가 늘어난 파일만 원래 경로에** 기록한다(`commands/reserve-ids.ts`). 다음 push는 `model.get`으로 서버를 다시 읽어 계획을 새로 만들므로 신규 id만 안정되면 세 결말(커밋+응답유실 / 미커밋 / 커밋+`syncDown` 실패)이 전부 수렴한다. **서버 변경·마이그레이션 없음** ([설계](specs/2026-08-05-cli-push-idempotency-design.md)) |
| **초대 링크·비밀번호 재설정 링크** | 관리자가 초기 비밀번호를 정해 전달하던 두 경로를 **일회용 링크**로 바꿔 평문 비밀번호를 관리자 손에서 없앴다. 일회용 토큰 2종(`invitations`·`password_reset_tokens`, **마이그 0012**)과 발급·만료·1회용 판정을 모은 `services/one-time-token.ts`(`issueToken`/`tokenExpiry`/`assertLive`), 신규 `invitation` 라우터 5개(`create`/`listForOrg`/`revoke`/`peek`/`accept` — 뒤 둘은 공개), `admin.users.create`·`resetPassword` → **`invite`·`resetLink`로 교체** + `admin.invitations.list`/`revoke`, 공개 `auth.resetPassword`, `createAccount`가 호출자의 트랜잭션을 수용, 비보호 라우트 2개(`/invite/:token`·`/reset/:token`)와 페이지 2개, 조직 화면 초대 섹션·관리자 화면 폼 교체, **서버가 표식으로 내리는** 오류 판정(`LinkDeadError` → `data.linkDead`/`data.linkReissuable`, 웹은 `lib/link-error.ts`에서 그 표식만 읽는다)과 `<meta name="referrer" content="no-referrer">`. **관리자 화면에 비밀번호 입력란이 하나도 남지 않았다.** core·CLI 변경 없음 ([설계](specs/2026-08-06-invite-and-reset-links-design.md)) |

| **N:M 교차 테이블 자동 생성** | 관계 패널에서 버튼 하나로 1:N 을 **교차 테이블 + 식별 1:N 관계 2개**로 푼다. **모델에 N:M 을 넣지 않고 동작만 뒀다** — 결과물이 보통 테이블 1개와 관계 2개뿐이라 DDL·diff·병합·파일 포맷·CLI 가 새로 알 것이 없다(`cardinality` enum 은 `'1:1' \| '1:N'` 그대로). core 순수 함수 2개(`resolveManyToMany`·`junctionTableName`), 웹의 계획 함수 `planJunction`(id·이름·좌표를 미리 계산해 넘긴다), 관계 패널 버튼. 원본 FK 제거에 **`deleteRelationship` 이 아니라 `deleteColumnCascade`** 를 쓴다(전자는 자식 FK 컬럼을 일부러 보존해 고아를 남기고, 후자는 매핑이 비면서 원본 관계까지 함께 정리한다). 풀지 않는 조건 3가지 — 식별 관계 / FK 를 지운 뒤 양쪽 PK 가 0 이하 / **지울 FK 컬럼을 다른 관계가 부모로 참조**(하위 연쇄 방지). **서버 변경·마이그레이션 없음** ([설계](specs/2026-08-09-many-to-many-junction-design.md)) |

| **DDL 역설계 인라인 제약** | DataGrip·pg_dump 가 내는 표준 형태 — 컬럼 정의 안의 `constraint <이름> references <부모>`(참조 컬럼 목록 생략)와 컬럼 수준 `[constraint <이름>] unique` — 가 **파서에서 통째로 유실**되던 것을 고쳤다. 사용자 실물 DDL(24 테이블)에서 FK 37건·유니크 4건이 **경고 한 줄 없이** 사라지던 상태였다. 원인은 셋 — 인라인 REFERENCES 만 참조 컬럼 괄호를 필수로 요구했고(`if (m)` 밖으로 조용히 빠졌다), 컬럼 수준 UNIQUE 를 아예 읽지 않았고, 컬럼 정의 안의 `CONSTRAINT <이름>` 을 버렸다. REFERENCES 절 해석을 **`parseReferencesClause` 하나로 모아** 세 호출처(테이블 수준 FK·`ALTER TABLE` FK·인라인)가 공유하게 하고, 참조 컬럼 목록은 **부모 이름이 끝난 자리에서 곧장 괄호가 열릴 때만** 인정한다(`REFERENCES T CHECK (X > 0)` 의 괄호를 참조 컬럼으로 읽던 결함이 테이블 수준·`ALTER` 경로에도 있었고 함께 없어졌다). 부모 이름은 종결 키워드 열거 대신 **식별자 문법**으로 끊는다. 컬럼 인라인 제약은 `parseColumnDef` 가 함께 내주는 **속성 구간에서만** 읽어, 컬럼 이름이 구조 키워드와 같아도(`model_indexes."unique" boolean`) 정규식 가드가 아니라 **구조로** 막힌다. `ddl-import.ts` 는 한 줄도 안 고쳤다 — `refColumns: []` 를 "부모 PK 암묵 참조"로 해석하는 코드가 이미 있었다. 부수로 마스킹 통합(3.11)과 식별자 정규식 통일(3.12)이 따라왔고 `main` 의 선재 결함 6종이 함께 사라졌다. **서버·웹·CLI 변경 없음, 마이그레이션 없음** |

| **물리명 우선 명명 + 필수값 표시** | 논리명 → 물리명 한 방향이던 명명을 **양방향 대칭**으로 만들었다. 역생성 함수는 **새로 만들지 않았다** — `restoreLogicalName`(`naming.ts:70`)이 DDL 역설계용으로 이미 있었고 UI 에 노출만 했다. 규칙은 정생성과 완전 대칭이다(반대쪽이 **비어 있을 때만** 자동, 「복원」 버튼은 덮어쓴다) — 둘 다 "빈 칸일 때만"이라 두 자동 규칙이 서로를 덮어쓸 수 없다. 논리·물리가 함께 나오는 **모든 폼**을 물리 우선 순서로 뒤집었고(편집 패널 테이블·컬럼, 단어·용어 다이얼로그, 공용 리소스), 사전에 **미등록 약어 → 논리명** 역방향 등록을 **같은 `createWord` 경로**로 더했다. `addTable` 이 물리명을 비워 이월 항목(「새 테이블 물리명이 `TABLE_1` 로 남는다」)을 해소했고, 빈 물리명 테이블은 **DDL 에서 제외 + 경고**한다(0컬럼 테이블과 같은 정책). 필수 표시는 `FieldLabel` 하나로 통일하고 `required-empty` 경고를 더했다. **서버·CLI 변경, 마이그레이션 없음** ([설계](specs/2026-08-10-physical-first-naming-design.md)) |
| **DBML 가져오기·내보내기** | dbdocs 문서 발행이 주 용도. **DBML 전용 경로를 만들지 않았다** — 파서(`dbml-parse.ts`)만 새로 쓰고 결과를 `ParsedDdl`(+`groups`·`customValues`) 형태로 내어 `planDdlImport`·`applyDdlImport`를 그대로 탄다. 내보내기(`dbml.ts`)는 `generateDdl`과 테이블 선정 판정·타입 해석을 공유한다(`ddl.ts`가 `selectTables`·`tableColumns`·`hasEmptyPhysicalName`·`commentText`를 export). 커스텀 항목은 note 의 JSON 꼬리로 싣고 **키는 정의 이름**이다(모델 키는 UUID). 왕복을 지키려고 **관계 이름에 `FK_자식_부모` 폴백을 쓰지 않고**(원본에 없던 이름이 생긴다) **1:1 에 UNIQUE 를 동반시키지 않으며**(없던 유니크 인덱스가 생긴다) **`pk` 를 낸 컬럼에 `not null` 을 덧붙이지 않는다**(DBML 에서 pk 가 not null 을 함의하고 가져오기도 `nullable: !notNull && !isPk` 로 판정한다). 관계 이름은 **`oneToOne` 이 `undefined` 인 fk(=DDL 파서 산출물)에서는 버린다** — 안 그러면 DDL 내보내기의 자동 생성 제약명이 되읽혀 들어온다. 리뷰(Critical 0 · Major 3 · Minor 4 · Nit 5)에서 **왕복이 실제로는 깨지던 자리 셋**을 고쳤다 — 컬럼 `[pk]` 를 **pk 제약으로도 정규화**하지 않아(DDL 파서는 한다) 단일 PK 자식의 `identifying` 이 전부 뒤집히던 것, 트리플 쿼트가 **백슬래시를 이스케이프하지 않아** 리터럴 `\t`·`\n` 이 변조되고 백슬래시로 끝나는 설명이 **테이블을 통째로 삼키던** 것, note 의 JSON 꼬리를 "마지막 `{` 부터" 찾아 **커스텀 값 안의 `{`** 에서 꼬리가 통째로 설명으로 새던 것(→ "앞에서부터 훑어 파싱되는 첫 `{`"). 그 밖에 그룹 설명 왕복·`default` 표현식 오탐(`'a' \|\| 'b'`)·색 unquote·닫히지 않은 블록 경고. **서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-10-dbml-import-export-design.md)) |
| **캔버스 다중 선택 + 클립보드 + 단축키** | 테이블·컬럼을 여러 개 골라 복사·잘라내기·붙여넣기 하고, 캔버스에서 컬럼을 클릭하면 사이드바가 그 컬럼으로 스크롤·하이라이트한다. store 의 단일 선택을 **배열로 교체**했고(병기하지 않는다 — 3.13), 컬럼 선택은 테이블 선택에 종속된다. 클립보드는 **시스템 클립보드 JSON**(`__erdd`·`v` 표식)이라 다른 프로젝트·탭까지 건너가고, **id 를 싣지 않으며** 도메인·커스텀 항목은 **이름으로 재연결**(없으면 「없음」), 이름 충돌은 `_사본`/`_COPY` 로 자동 개명한다. 붙여넣기는 `paste` 이벤트로 받는다(`readText` 는 권한 프롬프트를 띄운다). 관계는 복사하지 않고 인덱스만 따라간다. 이 트랙 자체는 **presence 프로토콜을 건드리지 않았다**(다중 선택이어도 첫 번째만 발신) — 뒤이어 병합된 사이드바 트랙이 프로토콜을 `selections` 배열로 넓혀 **지금은 다중 선택 전체가 발신된다.** **core·서버·CLI 변경, 마이그레이션 없음** ([설계](specs/2026-08-10-canvas-selection-clipboard-design.md)) |

| **좌측 사이드바 다중 선택·드래그 그룹 이동** | 사이드바를 읽기 전용 탐색기에서 **조작 표면**으로 바꿨다. 선택 상태는 캔버스와 **한 벌**(`selectedTableIds`)이고, 사이드바 안에서 끌어 그룹을 옮기고, **캔버스에서 끌어와 사이드바 그룹에 떨어뜨린다**. 그룹 이동 규칙의 소재지는 `applyGroupMove` **한 곳**이라 세 진입점(일괄 패널 드롭다운·사이드바 드롭·캔버스 드롭)이 같은 결과를 낸다(결과 동치를 테스트가 잠근다). 좌표는 `planGroupMove`가 **상대 배치를 보존한 채** 대상 그룹 오른쪽으로 옮기고 **그룹 밖 테이블과 겹치면 아래로 민다**(브라우저 스모크가 잡은 결함 — 초판 설계는 기준 bbox를 대상 그룹 멤버만으로 잡았다). `groupId`·`groupPosition`·좌표가 **한 producer**라 `cmd+Z` 한 번에 전부 원복된다. 드롭 판정은 좌표 하나로 수렴하고(`dropTargetOf`), 드래그 중에는 검색·그룹 뷰로 숨은 그룹이 드롭 타깃으로 다시 열린다. 일괄 작업 패널(2개 이상 선택 시 전환)은 그룹 이동 드롭다운(드래그의 **접근성 대체 경로**)과 확인 다이얼로그를 거치는 삭제를 담고, op 상한 가드는 **다이얼로그 안**에 있어 진입점이 몇 개든 새지 않는다. presence는 `Peer.selections` 배열로 확장해(상한 50·중복 제거를 절단 **앞**에) **선택 전부**를 브로드캐스트한다 — 일괄 삭제 직전에 "남이 그걸 만지고 있다"가 보여야 하기 때문이다. 선택 정리는 `keptSelection` **한 규칙**을 `resync`·`pruneSelection`·`setLoaded`가 공유해 같은 삭제가 도착 경로(op 배치/seq 간극/로컬 편집/거절 복구)에 따라 다른 결과를 내지 않는다. ⚠️ **`onSelectionChange`는 통제 모드에서 쓸 수 없다** — 창구는 `onNodesChange`의 `select` 델타다(설계 4절에 근거). **서버 변경은 presence 프로토콜뿐, 마이그레이션 없음** ([설계](specs/2026-08-10-sidebar-multiselect-dnd-design.md)) |

| **캔버스 박스 선택 깜박임(버그 수정)** | shift+드래그 박스 선택 중 **캔버스 전체 테이블이 깜박이고, 손을 뗀 뒤 박스가 덮지도 않은 전체가 선택된 채 굳던** 결함. 원인은 `derived`가 선택에 의존해 노드 배열을 통째로 새로 만드는데 **그 노드에 `measured`가 없다**는 것 하나다 — `adoptUserNodes`는 `userNode` 참조가 이전과 다르면 internals를 재생성하면서 `parseHandles`를 부르고, 그 함수는 `!userNode.measured`이면 **이전 `handleBounds`까지 함께 버린다.** 그러면 `NodeWrapper`가 `visibility: hidden`으로 그리고(노드가 사라졌다 재측정 후 다시 나타난다), `getNodesInside`가 **박스 밖 노드까지 전부** 고른다. ⚠️ **전량 선택에는 갈래가 둘이고 둘 다 `measured` 소실이 뿌리다** — (A) `forceInitialRender = !handleBounds`, (B) 크기가 `measured.width ?? width ?? initialWidth ?? 0`으로 떨어져 **면적이 0**이 되는 바람에 `overlappingArea(0) >= area(0)`도 참(테이블 노드에는 명시 width/height가 없다). **그래서 `handleBounds`만 캐시하는 대안은 절반만 고친다.** 박스 선택은 `commitUserSelectionRect`가 pointermove마다 재계산하므로 "선택 변경 → 노드 재생성 → 측정 소실 → 전량 선택 → 재측정되면 되돌림"이 무한히 도는 진동 루프가 된다. 고친 것은 `keepMeasured` 하나 — `setNodes` 두 곳에서 이전 배열의 `measured`를 id로 이어붙인다. 실제 크기가 바뀌면 `updateNodeInternals`의 `dimensionChanged` 분기가 갱신하므로 stale이 굳지 않는다. **core·서버·CLI 변경 없음, 마이그레이션 없음** |
| **에디터 도구 재분배(상단 묶음 + 하단 바)** | 헤더 한 줄에 몰려 1024px 에서 잘리던 도구를 **「캔버스를 조작하는가」** 하나를 축으로 두 줄로 나눴다. 하단은 화면 **전체 폭 고정 바**(`bottom-bar.tsx`)로 편집 도구·실행 취소/다시 실행·뷰 전환·표시 모드·줌을 담는다 — 그룹 뷰와 표시 모드는 트리·편집 패널의 표시에도 걸리는 **전역 상태**라 캔버스 열 안이 아니라 전체 폭이 의미상 맞다. `Toolbar`·`GroupViewSelect`·`ViewModeToggle` 은 **한 줄도 고치지 않고** `BottomBar` 가 조립만 한다. React Flow 기본 `<Controls>` 는 전체 폭 바 위에 겹쳐 "두 겹 툴바"가 되므로 제거하고 같은 API 를 쓰는 `ZoomControls` 로 대신했다(`Background`·`MiniMap` 은 유지). 상단은 8개 → **4개**(「버전」·「사전·리소스 ▾」·「모델 검사 (N)」·「파일 ▾」)로 묶었다 — 앞의 넷은 "재사용할 정의를 관리한다"는 한 성격이지만 버전은 이력, 모델 검사는 진단이라 성격이 달라 단독으로 뒀고 특히 모델 검사는 **경고 건수 배지가 상시 보여야** 해서 메뉴에 숨기면 신호가 죽는다. 다이얼로그 **8개를 전부 제어형으로 전환**하고 트리거 렌더 책임을 `header-tools.tsx` **한 곳**으로 옮겼다(3.4) — 열린 도구가 단일 상태라 둘이 동시에 열리는 상태가 구조적으로 생기지 않는다. `ddl-import-dialog` 의 `if (!canEdit) return null` 가드는 **메뉴 항목으로 옮겼다** — 제어형이 되면 컴포넌트가 스스로 사라져도 **메뉴에는 눌러도 아무 일 없는 죽은 항목이 남는다**(8개 중 이 가드를 가진 것은 이것 하나다). `export-dialog` 가 열릴 때 내보내기 범위를 초기화하던 부수 효과는 `useEffect` 로 옮기되 **열려 있는 동안 그룹 뷰가 바뀔 때는 재설정되지 않도록** 그 순간의 값을 store 에서 직접 읽는다(의존성에 넣으면 기존 동작과 달라진다). 부수로 「가져오기」 이름 충돌(6절 이월)이 해소됐다 — 헤더 쪽이 「파일 ▾ → DDL·DBML 가져오기」가 되어 사전 다이얼로그의 Excel 업로드 탭과 갈린다. **core·서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-12-editor-toolbar-split-design.md)) |

| **관계선을 컬럼 위치에 붙임** | 관계선이 테이블 좌우 **중앙**에서 나가 어느 컬럼이 어느 컬럼을 참조하는지 그림에 없던 것을 고쳤다. 단일 FK 는 그 컬럼 행에, 복합 FK 는 양쪽 테이블 맨 아래의 **합성 행 `(col1, col2)`** 끼리 붙는다. 합성 행은 **관계가 쓰는 조합에만** 만든다(복합 PK·인덱스 기준이 아니다 — 그러면 "관계가 쓰는 조합이 인덱스로 정의돼 있지 않다"는 흔한 상태에서 붙을 자리가 없다). ⚠️ **급소는 앵커 키의 소재지가 한 곳이라는 것** — 엣지가 적는 `sourceHandle` 문자열과 노드의 `<Handle id>` 가 한 글자만 어긋나면 React Flow 는 **예외도 경고도 없이 선을 그리지 않는다.** `anchors.ts` 의 `handleId()` 만이 그 문자열을 만들고, `anchor-wiring.test.tsx` 가 "엣지가 가리키는 핸들 ⊆ 실제 렌더된 핸들"을 전수 대조해 잠근다(그린으로 들어온 테스트라 `anchor-handles.tsx` **한쪽에서만** 키를 망가뜨려 빨개지는 것을 실증했다 — `handleId` 를 고치면 엣지·노드가 **함께** 바뀌어 여전히 일치하므로 실증이 되지 않는다). 고스트 노드(컬럼 행이 없다)에도 **같은 앵커 핸들을 전부 헤더 중앙에 겹쳐** 달아 `buildEdges` 가 "상대가 고스트인가"를 몰라도 되게 했다. ⚠️ **핸들이 모델에 따라 붙고 떨어지므로 `updateNodeInternals` 가 새 의무로 붙는다** — React Flow 는 `<Handle>` 이 바뀌어도 `handleBounds` 를 자동 재파싱하지 않아, 부르지 않으면 관계를 만든 직후 선이 옛 자리에 남는다. 직전 사이클의 `keepMeasured`(측정 **보존**)와 방향이 반대이자 상보적이다. ⚠️ **그 재측정 대상을 앵커 `키` 로만 고르면 컬럼 재정렬을 놓친다(리뷰 M-1).** 핸들의 y 는 키가 아니라 **그 행이 노드 안 몇 번째인가**로 정해지는데 `reorderColumn` 은 두 컬럼의 `order` 만 맞바꿔 키 집합이 그대로다 → 서명이 같아 갱신이 안 걸리고, React Flow 도 스스로 재측정하지 않아(행 집합이 같아 노드 크기가 안 변하니 ResizeObserver 도 `dimensionChanged` 도 없고, `parseHandles` 는 `keepMeasured` 가 보존한 `measured` 를 보고 **이전 `handleBounds` 를 그대로 물려준다**) **선이 옛 행 높이에 남는다.** 그래서 서명은 `키@행인덱스` 다 — 위치를 바꾸는 편집만 서명을 바꾸므로 5.5 의 "매 렌더 전부 부르지 않는다"도 함께 지켜진다. **`keepMeasured` 가 이 결함의 조건이라는 점이 핵심이다** — 측정을 보존하는 최적화가 "핸들이 움직여도 옛 측정이 살아남는다"는 부작용을 만들므로, 앞으로 핸들을 동적으로 다는 것은 무엇이든 **자기 위치 변화를 스스로 서명에 넣어야 한다.** ⚠️ **앵커 핸들은 `isConnectable={false}` 라(연결 드래그는 중앙 핸들이 계속 전담한다) `canvas.test.tsx` 의 "핸들 전부가 `connectable`" 전수 단언과 충돌한다** — 단언 대상을 중앙 핸들(`data-handleid="l"|"r"`)로 좁히고, 앵커 핸들은 반대로 연결 불가여야 한다는 단언을 함께 넣어 축소가 검사를 무르게 하지 않도록 했다. **core·서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-12-column-anchored-edges-design.md)) |

| **선택 테이블로 새 그룹** | 테이블을 골라 둔 채 우측 일괄 패널의 버튼 하나로 그것들을 담는 그룹을 만든다. 지금까지는 빈 그룹을 만들고(선택이 풀린다) 다시 골라 드롭다운으로 옮겨야 해 **Revision 2건**이었다. 「새 그룹 하나 만들기」 규칙(권한·미사용 최소 번호·다음 색·그룹 뷰 좌표 비움)을 **`group-edits.ts`의 `createGroupWith` 한 곳**에 모으고 좌측 「그룹 추가」도 같은 함수를 쓴다(`applyGroupMove`와 같은 형태 — 진입점이 둘이면 규칙은 하나여야 한다). 생성과 배정이 **한 producer**라 `cmd+Z` 한 번에 원복된다. ⚠️ **좌표는 건드리지 않는다** — `planGroupMove`는 *대상 그룹의 기존 멤버* bbox를 기준으로 삼는데 새 그룹에는 기준이 없어 정의상 빈 배열이라, 부르지 않는 편이 의도가 드러나고 컬럼 전수 스캔도 안 돈다. 리팩터의 부수 효과로 이름·색을 **producer가 받은 모델**에서 계산하게 되어(옛 `onAddGroup`은 store 스냅샷을 읽었다) 낙관적 체인에서 이름이 겹치지 않는다. **core·서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-12-group-from-selection-design.md)) |

| **명명 입력 UI 개편** | 이름을 치는 자리(편집 패널 테이블·컬럼)에서 사전을 오가지 않고 이름을 완성하게 했다. 컬럼의 2열 가로 배치를 **세로**로 펴고(라벨 자리가 생겨 필수 표시가 붙는다), 재생성 버튼을 **입력란 안**으로 넣고 이름을 「물리명 재생성」·「논리명 재생성」으로 통일했다. ⚠️ **급소는 두 draft 를 한 컨테이너(`NamePair`)가 쥐는 것이다** — ↻ 는 *반대편 필드의 아직 커밋되지 않은 값*을 기준으로 삼아야 맞는데, draft 가 각 필드 안에만 있으면 그 값에 닿을 수 없다. 이것이 이월 결함(「버튼이 blur 커밋 전 값을 읽는다」)을 **실제로 닫는** 자리다(옛 코드는 비제어 인풋이라 친 값이 React 상태 어디에도 없었다). ⚠️ **`onMouseDown` 의 `preventDefault` 가 막는 것은 포커스 이탈뿐이고 뮤테이션 수와 무관하다.** blur 는 발화하고 `commitSide` 까지 **도달한다** — 억제하는 것은 `use-model` 의 `ops.length===0 → noop` **하나뿐이다**(`regenerate` 가 반대편 draft 를 같은 patch 에 접어 넣어 모델이 이미 그 값이 된 뒤 blur 가 도착하므로 diff 가 비어 있다). ⚠️ **`commitSide` 의 값-동일 조기 반환은 걸리지 않는다** — `onBlur` 콜백이 자기 렌더의 props 를 쥐고 있어 `current` 가 옛 값이라 `skip=false` 로 통과한다. 수정 라운드가 그것을 "둘 중 하나" 로 적었다가 재검증 계측에서 갈렸다(같은 종류의 결함이 한 번 더 나온 것이다). **설계·계획서·초판 보고가 이 줄을 두고 적은 인과는 셋 다 틀렸고, 리뷰가 그것을 잡았다** — 지금은 「포커스 유지」 케이스 3건이 그 줄을 잠근다. ⚠️ **컬럼의 「용어 등록」도 같은 대우가 필요하다** — 초판은 그 버튼만 `extra` 에 고정 `ReactNode` 로 들어가 draft 에 닿지 못해 이월 결함이 같은 카드 안에서 열린 채였다(리뷰 M1). `extra` 는 **렌더 prop**(`(draft) => ReactNode`)이다. 자동완성은 core `suggestCompletions` **하나**만 내려갔다 — 쿼리 산출이 `generatePhysicalName`·`restoreLogicalName` 과 **같은 분해 규칙**이어야 하고 `abbreviationIndex` 가 `naming.ts` 의 private 함수라 밖에서 재현할 수 없다. **용어만 입력 전체로 찾는다**(용어의 적용 규칙이 논리명 전체 완전일치라 꼬리 조각으로 찾으면 의미가 달라진다 — 그래서 용어 후보의 `start` 는 0 이다). ⚠️ **미등록 칩은 커밋된 값으로 계산한다** — draft 로 하면 타이핑 중 마지막 구간이 늘 미등록이라 칩이 깜박인다(**자동완성은 입력 중, 칩은 입력 후**로 역할을 가른다). 인라인 등록은 사전 화면의 일괄 등록과 **같은 `createWord` 경로**이고, 등록과 「반대편이 비면 채우기」를 한 producer 로 묶어 Revision 1건이다. 사전 화면의 미등록 항목은 **방향별 하위 탭 2개**로 갈리고 55줄 중복이던 두 섹션이 `direction` prop 하나로 합쳐졌다(그 통합이 `DEFAULT_NAMING_RULES` 하드코딩도 함께 닫았다). ⚠️ **컬럼의 「논리명이 용어와 완전일치하면 도메인도 함께 채운다」 규칙은 `applyNames` 안에 되살려야 한다** — 컬럼에만 있는 규칙이라 컨테이너가 모르고, 계획서가 그것을 옮겨 담지 않아 조용히 사라질 뻔했다. ⚠️ **되살릴 때 「물리명이 비어 있을 때만」 가드까지 함께 가져와야 한다** — 초판이 그 가드를 빠뜨려 「항상」으로 넓어졌고, 테스트가 0건이라 아무것도 빨개지지 않았다(리뷰 M3). 지금은 4건이 잠그고 그중 하나가 가드 자체를 본다. ⚠️ **제어 인풋 승격은 새 경로를 하나 만든다** — 한쪽 prop 만 원격으로 바뀌어도 draft 를 통째로 덮으면 반대쪽의 커밋되지 않은 타이핑이 날아간다(리뷰 M4). 이전 prop 을 ref 로 들고 **바뀐 키만** 덮는다. **서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-14-naming-input-ux-design.md)) |

| **논리명 구분자 + 상대 필드 적용** | 논리명 저장값에 단어 구분자(`_`)를 넣고, 편집 패널의 `↻` 2개를 **상대 필드를 채우는 화살표 2개**로 바꿨다. `logicalSeparator` 는 물리명 `separator` 와 **별도 축**이다 — 한글 논리명과 영문 약어는 구분자 정책이 다를 이유가 충분하고, 공유하면 물리명 규칙을 바꾸는 순간 **저장된 논리명 전체가 규칙 위반**이 된다. ⚠️ **급소는 분해 폴백이다** — `decomposeByWords` 는 구분자 split 이 1차이고 **사전에 없는 토큰만** 최장일치 그리디로 재분해하는데, 이 폴백이 없으면 구분자 없는 기존 논리명(`회원주문번호`)이 split 후 토큰 하나가 되고 사전에 그런 단어가 없어 **통째로 미등록 단어**가 된다(물리명 생성이 죽고 칩에 이름 전체가 뜬다 — 기존 프로젝트가 전부 그 꼴이 된다). 폴백 덕에 바뀌는 것은 경고 한 줄뿐이다. **용어는 저장값을 바꾸지 않는다** — 비교할 때 양쪽에서 `stripLogicalSeparator` 로 벗기고 넣을 때만 `withLogicalSeparator` 로 변환한다(용어는 전역·조직 라이브러리에서 fork 로 내려오므로 남의 데이터에 이 프로젝트의 정책을 강요할 수 없다). ⚠️ **기본값이 주입되는 자리는 서버의 `project.get` 하나뿐이다** — DB 컬럼 기본값은 마이그레이션에 구운 3키라 `NamingRulesSchema.parse` 를 태우지 않으면 `logicalSeparator: undefined` 가 그대로 클라이언트에 나간다(**Task 1 에서 `DEFAULT_NAMING_RULES` 가 4키가 되는 순간 이 테스트가 빨개진다** — 서버 변경을 뒤로 미룰 수 없었다). 새 경고 `missing-logical-separator` 는 **분해가 2개 이상일 때만** 띄운다(단일 단어에까지 붙이면 신호가 죽는다). 덮어쓰기는 **blur 만 제외**한다(blur 는 필드를 스쳐 지나가기만 해도 발생한다) — 자동완성 확정은 **상대 draft 만** 바꾸고 커밋은 blur/Enter 때 두 필드가 함께 나간다(Revision 1건). ⚠️ **`commitSide` 만으로는 그 「함께」가 성립하지 않는다** — 확정이 draft 만 바꿔 두는데 blur 는 `shouldFill` 이 false 라 그 값을 안 실어 보낸다. `foldOtherDraft` 가 아직 커밋되지 않은 반대편 draft 를 patch 에 접어 넣는다. **수용된 퇴행 하나:** 구분자 규칙에서 **옛 형식**(구분자 없는) 논리명을 이어 치면 자동완성 쿼리가 입력 전체가 되어 단어 후보가 좁아진다(밑줄을 한 번 찍으면 곧바로 돌아온다). 분해 폴백과 다른 판단인 이유는 그쪽은 물리명 생성이 죽고 이쪽은 후보가 줄 뿐이기 때문이다. **마이그레이션 없음**(jsonb 읽기 시점 주입) ([설계](specs/2026-08-15-logical-name-separator-design.md)) |

| **메모·관계선 단축키** | 캔버스에서 메모·관계선을 `Delete`/`Backspace` 로 지우고 메모를 `Cmd+C`/`X`/`V` 로 복사·잘라내기·붙여넣는다. **이 트랙이 서는 근거는 선택이 항상 한 종류라는 것**(`store.ts` 의 `selectRelationship`·`selectNote`·`selectGroup` 이 전부 `...CLEARED_SELECTION` 을 앞에 둔다 — 3.13) — 「테이블과 메모가 동시에 선택된」 상태가 구조적으로 없으므로 우선순위를 정할 필요 없이 분기를 얹기만 하면 된다. ⚠️ **다만 그 분기는 기존 `nothingSelected` 가드보다 반드시 앞에 와야 한다** — 메모·관계가 선택되면 `selectedTableIds` 는 비어 있어서 뒤에 두면 그 가드에 걸려 아무 일도 일어나지 않는다. 삭제는 우측 패널 버튼과 **같은 함수·같은 summary·같은 순서**(선택을 먼저 비우고 mutate)다 — 진입점이 둘이면 규칙은 하나여야 한다(`applyGroupMove`·`createGroupWith` 가 세운 형태). ⚠️ **특히 관계는 `deleteRelationship` 이다**(`deleteColumnCascade` 가 아니다) — 전자는 **자식 FK 컬럼을 일부러 보존**하므로 무심코 후자를 쓰면 같은 「관계 삭제」가 진입점에 따라 다른 결과를 낸다. 그 급소를 잠그는 케이스(「관계를 지워도 자식 FK 컬럼은 남는다」)를 **`deleteColumnCascade(deleteRelationship(m, relId), 'c4')` 로 바꿔 정확히 그 1건만 빨개지는 것을 실증**했다(`deleteColumnCascade` 단독으로 바꾸면 관계가 안 지워져 다른 케이스가 먼저 깨져 실증이 되지 않는다). 클립보드는 `kind: 'notes'` 를 더했고 **`CLIPBOARD_VERSION` 을 올리지 않았다** — `parseClipboard` 가 `raw['v'] !== CLIPBOARD_VERSION` 이면 버리므로 올리면 사용자가 이미 복사해 둔 테이블·컬럼이 전부 무효가 된다(kind 추가는 하위호환이다: 옛 페이로드는 그대로 읽히고 새 페이로드를 옛 코드가 읽으면 `null` 로 안전하게 무시된다). 메모는 참조가 없어 이름으로 재연결할 것이 없고 필드가 셋(`content`·`color`·`position`)으로 끝난다. ⚠️ **붙여넣기만은 `activeGroupView` 가드가 따로 필요하다**(리뷰 M1) — 하단 바 「메모」 버튼이 `disabled={!!activeGroupView}` 로 막는 것과 같은 규칙인데 새 분기에 그것이 없었다. **C·X 는 그룹 뷰 진입이 선택을 비워 도달 자체가 안 되지만 붙여넣기는 선택과 무관하게 도달한다** — 가드가 없으면 메모가 모델에는 들어가는데 그룹 뷰는 `noteNodes` 를 빼고 조립해 안 그려지고, `selectNote` 가 **보이지 않는 것을 선택해** 편집 패널만 뜬다. **`apps/web` 전용 — core·서버·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-16-note-relationship-shortcuts-design.md)) |

| **그룹 별칭 (+ 컬럼 행 배지 레이아웃)** | 그룹에 물리 식별자 별칭(`alias`)을 붙였다. 그룹 이름은 `회원관리`처럼 한글이라 물리명 조합에 쓸 수 없어서 따로 두는 값이다. ⚠️ **`.nullable().default(null)`(3.3 관례)을 따르지 않고 `.default('')` 다** — 별칭은 `comment`(없음이 의미 있다)가 아니라 `physicalName`(비어 있을 수 있는 식별자) 쪽 성격이라 `null` 이면 소비처마다 `?? ''` 가 붙고 템플릿이 붙을 때 그 분기가 늘어난다. `.default('')` 도 옛 op 페이로드 파싱을 똑같이 만족한다(3.3 이 막으려는 것은 `undefined` 가 그대로 흘러드는 것이다). 3.3 이 요구하는 **구 스냅샷 회귀**(그룹에 `alias` 키 없음 → 빈 `changes` 의 update op 가 안 나간다)를 함께 넣었고, `diff.ts` 의 가드를 `if (true)` 로 바꿔 그 케이스만 빨개지는 것을 실증했다. ⚠️ **이번 사이클이 끝나도 별칭은 쓰이는 곳이 없다 — 그것을 알고 고른 것이다.** 소비자는 다음 사이클의 **테이블명 형식 템플릿**(`TB_{그룹별칭}_{커스텀속성}_{물리명}`)인데, 템플릿은 「저장된 물리명 vs 조합해서 보여 주는 물리명」이라는 새 개념을 들여와 DDL·Excel·DBML·역설계 왕복·중복검사가 전부 그 갈림에 걸리므로 **모델·마이그레이션·등록처 배선을 먼저 닫아** 검증했다. 입력 규칙은 **타이핑 중에 강제한다**(3.15). ⚠️ **`z.strictObject` 라 필드 하나가 저장소 전역의 `TableGroup` 리터럴 22곳을 깨뜨렸다** — core·cli·web 픽스처와 `file-format.ts`·`ddl-import-edits.ts`·`model-store.ts` 의 생성 지점까지 typecheck 로 훑어 고쳤다. ⚠️ **계획서가 `FILE_FIELDS.tableGroup.alias` 를 뒤 태스크에 뒀는데 그럴 수 없다** — `file-merge` 의 「모든 필드가 가시/비가시 중 정확히 한쪽에 있다」 완전성 게이트가 **필드 추가 즉시** 빨개져서, 미루면 그 사이 커밋이 red 로 남는다. ⚠️ **`FILE_FIELDS` 만으로는 CLI 왕복이 성립하지 않는다** — `groups.yaml` 을 쓰고 읽는 것은 `file-format.ts` 이고 그쪽 배선(빈 값은 다른 기본값처럼 생략)이 따로 필요했다. 계획서에 없던 부분이다. 함께 고친 것 하나 — **컬럼 행 경고 배지**가 `NamePair` 와 같은 flex row 에 `shrink-0` 으로 있어 **경고가 있는 컬럼만 이름 입력란이 좁아지던** 결함을 `absolute` 로 띄워 되돌렸다(직전 사이클 설계 3.7 의 「카드 우상단」 의도). ⚠️ **그것은 테스트로 잠기지 않는다**(jsdom 이 레이아웃을 계산하지 않아 「폭이 같다」를 관측할 수 없다 — 클래스 문자열 단언은 스타일 복사일 뿐이다). **마이그 0013** ([설계](specs/2026-08-16-group-alias-design.md)) |

| **테이블 물리명 형식 템플릿** | 테이블의 최종 물리명을 `TB_{그룹별칭}_{물리명}` 같은 틀로 조합한다. **저장값은 부분만**이고 접두는 저장하지 않는다 — 형식을 바꾸거나 그룹을 옮기면 최종 이름이 즉시 따라간다. **아키텍처의 핵심은 조합 함수 하나(`composeTablePhysicalName`)가 템플릿 유무를 흡수하는 것이다** — 템플릿이 비면 `physicalName` 을 그대로 돌려주므로 소비처(DDL·DBML·Excel·검사)가 분기를 몰라도 된다. 그 계약이 없으면 「템플릿이 있는가」 판단이 스무 곳으로 샌다. ⚠️ **빈 변수는 정규식 후처리로 접지 않는다** — `_{2,}` → `_` 로 흉내내면 구분자가 `_` 가 아닌 형식에서 안 먹고 **부분 이름 안의 연속 밑줄(`A__B`)까지 접힌다.** 토큰 단위로 「빈 변수는 자기 자신과 바로 뒤 리터럴을 함께 지우고, 뒤에 리터럴이 없으면 앞 리터럴을 지운다」로 못 박았다(실증: 그 세 줄을 `continue` 한 줄로 바꾸면 `TB__ORD`·`_ORD`·`MBR_` 로 5건이 빨개진다). ⚠️ **검사는 셋만 조합 기준이다** — 중복·길이·예약어는 최종 이름(실제 DB 에서 충돌하는 것이 그것이다), **용어 불일치만 부분 기준**이다(사전의 표준 물리명은 사용자가 입력하는 값이라 접두가 없어, 조합 이름과 비교하면 **항상** 불일치가 뜬다 — 실증으로 잠갔다). ⚠️ **`NamingRulesStrictSchema` 에 `tablePhysicalTemplate: z.string()` 을 다시 적어야 한다** — `.extend` 로 덮지 않으면 읽기 스키마의 `.default('')` 를 물려받아 **키를 안 보낸 클라이언트의 `project.update` 가 설정해 둔 템플릿을 빈 문자열로 덮는다**(실증: 그 한 줄을 지우면 update 가 400 대신 200 으로 통과한다). `logicalSeparator` 가 같은 이유로 이미 갈라져 있던 자리다. ⚠️ **`buildExcelSheets` 의 `opts.rules ?? DEFAULT_NAMING_RULES` 폴백을 없앴다**(3.16) — 테스트 호출처 약 70곳은 **import 별칭 심**으로 흡수했다(호출부는 한 곳도 안 건드렸다). ⚠️ **`NamingRules` 에 필드 하나를 더하니 저장소 전역 리터럴 11곳이 깨졌고, strict 스키마가 필수 키를 요구해 서버의 기존 `project.update` 테스트 3건이 400 이 됐다**(페이로드에 키를 더해 해소 — 의도된 동작이다). **왕복은 깨진 채로 둔다**(D2) — 내보낸 DDL 을 되읽으면 `TB_MBR_ORD` 가 통째로 부분이 되고, 그 동작을 **테스트로 고정**했다(역분해를 넣으면 그 테스트가 빨개져 재검토를 강제한다). **서버 코드 변경·마이그레이션 없음**(jsonb 읽기 시점 주입) ([설계](specs/2026-08-17-table-name-template-design.md)) |

| **테이블 논리명 형식 템플릿 + 접기 규칙 변경** | 테이블의 최종 **논리명**도 `{그룹명}_{논리명}` 같은 틀로 조합해 **DDL 코멘트·DBML note·Excel 논리명 열**에 내보낸다. **조합 몸통 `compose(template, table, model)` 하나를 두고 `composeTablePhysicalName`·`composeTableLogicalName` 두 형제가 각자 템플릿만 골라 넘긴다** — 변수 해석·접기 규칙이 통째로 공유된다. ⚠️ **논리명 조합은 산출물 전용이다**(설계 D1) — `warnings.ts` 는 **한 줄도 안 바꿨고**, 그 무변경 자체를 「논리 템플릿을 걸어도 경고 목록이 통째로 같다」로 테스트에 잠갔다. 사전·미등록 단어 검사·물리명 재생성이 조합 이름을 보면 사용자가 **조합된 이름**을 사전에 등록해야 하고, 재생성이 그룹 약어를 물리명 부분에 넣어 물리명 템플릿과 **이중 적용**된다(실증: `checkNamingEntity` 의 `t.logicalName` 을 조합으로 바꾸면 그 4건 중 2건이 빨개진다). ⚠️ **변수는 언제나 저장된 부분을 돌려준다** — 논리 템플릿의 `{물리명}` 은 `table.physicalName` 이지 조합 물리명이 아니라 **재귀가 원리적으로 불가능하다.** ⚠️ **「논리명==물리명이면 코멘트 생략」 판정을 양쪽 다 조합 이름으로 바꿨다**(설계 D5) — 한쪽만 조합이면 최종 산출물에서 같은 이름인데도 코멘트가 한 번 더 나간다. **함께 접기 규칙을 고쳤다**(설계 D2, 이월 항목 해소) — 지우는 단위를 「리터럴 토큰 하나」에서 **「그 리터럴 선두·말미의 밑줄」**로 좁혀 `TB_{그룹별칭}_LOG` 가 별칭이 비어도 `TB_` 가 아니라 `TB_LOG` 가 된다. ⚠️ **말미 정리는 빈 조각을 건너뛰며 뒤에서부터 훑고 변수 값 조각을 만나면 멈춘다** — 직전 조각 하나만 보면 `TB_{A}_{B}` 가 둘 다 빌 때 A 가 남긴 빈 조각에 막혀 `TB_` 가 나오고, 변수 값을 건드리면 사용자가 넣은 말미 밑줄(`ORD_`)이 지워진다. ⚠️ **밑줄이 아닌 구분자는 남긴다**(`TB_{그룹별칭}-LOG` → `TB_-LOG`) — 「글자·숫자가 아닌 문자」로 넓히면 **논리명 템플릿의 한글 리터럴을 먹는다.** ⚠️ **접기 규칙 변경이 기존 프로젝트의 산출물을 바꾼다** — 사실상 버그 수정이지만 이미 내보낸 DDL 과 갈리므로 사용자 매뉴얼에 안내를 적었다. **서버 코드 변경·마이그레이션 없음**(두 스키마를 다르게 고치는 3.16 의 규칙을 그대로 따랐고, 그 strict 한 줄을 지우면 update 가 400 대신 200 으로 통과하는 것을 실증했다) ([설계](specs/2026-08-18-logical-name-template-design.md)) |
| **덤프 머릿말 메타 왕복 복원** | 내보낸 DDL·DBML 머리에 「조합된 최종 이름 → 사용자가 입력한 부분」을 적은 **주석 한 줄**(`-- erdd:v1 {…}` · DBML 은 `// erdd:v1 …`)을 실어, 되읽을 때 접두가 물리명에 박히던 것을 없앴다. **직전 사이클의 D2(왕복이 깨진 채로 둔다)를 뒤집은 자리**이고, 그 고정 테스트를 「머릿말 있음/없음」 두 짝으로 갈랐다. ⚠️ **역분해가 아니다** — 이름을 뜯어 접두를 잘라내지 않고 **내보낼 때 적어 둔 값을 그대로 읽는다.** 그래서 접두에 밑줄이 섞이든 별칭이 물리명과 겹치든 정확하고, 남의 DDL 은 머릿말이 없어 **옛 동작 그대로** 떨어진다. **배선은 두 자리뿐이다** — `ParsedDbml` 이 `ParsedDdl` 을 상속하므로 필드는 `ParsedDdl.nameMeta` 한 곳, 복원은 DDL·DBML 공용 플래너 `planDdlImport` 한 곳이다. ⚠️ **두 파서 모두 파싱 전에 주석을 걷어내므로**(`splitStatements` · `stripComments`) 머릿말은 **원문에서 먼저** 읽어야 한다. ⚠️ **머릿말은 「조합 결과가 부분과 다른 테이블」만 싣는다**(설계 D4) — 「템플릿이 비었는가」를 검사하지 않는다. 템플릿을 안 쓰면 자연히 빈 맵이 되어 줄 자체가 안 나가고 **기존 산출물이 한 글자도 안 바뀐다**(실증: 그 한 줄을 지우면 `ddl.test.ts` 의 전체 문자열 `toBe` 비교가 함께 빨개진다). **논리명은 머릿말이 코멘트를 이긴다**(설계 D5) — 코멘트에는 **조합된** 논리명이 들어 있고 설명(`' - '` 뒤)만 코멘트에서 가져온다. 깨진 JSON·모르는 버전·안 맞는 키는 전부 `null`/`undefined` 로 떨어뜨리고 **예외를 던지지 않는다**(설계 D6). ⚠️ **계획에 없던 세 자리를 함께 고쳤다** — 테이블 색인(`tableByUpper`·`usedIndexNames`)은 **DDL 원문 이름**으로 잡아야 인덱스·UNIQUE·그룹 해소가 살고, 관계(`childPhysicalName`)는 반대로 **복원된 이름**을 가리켜야 웹의 `tableIdByName.get(...)!` 이 `undefined` 를 잡지 않으며, 이름 충돌도 **만들어질 이름**으로 봐야 복원 결과가 기존 테이블과 부딪히는 것을 놓치지 않는다. **서버·웹·CLI 변경 없음, 마이그레이션 없음** ([설계](specs/2026-08-18-name-meta-roundtrip-design.md)) ⚠️ **뒤이어 병합된 그룹·별칭 트랙이 형식을 `erdd:v2` 로 올리고 싣는 기준을 넓혀, 지금은 표기가 `-- erdd:v2 {…}` · `// erdd:v2 …` 이고 「기존 산출물이 한 글자도 안 바뀐다」는 보장이 「그룹도 템플릿도 안 쓰는 프로젝트」로 좁아졌다**(다음 행). |
| **가져오기 세는 범위 + 부분 이름 잠금** | 이름 템플릿 트랙의 이월 두 건. (A) `planDdlImport` 의 `claimed` 갈래가 `skippedTables` 에 담지 않아 **건너뛴 테이블이 경고 목록에만 뜨고 미리보기 요약의 「건너뜀 N개」에는 안 잡히던 것**을 고쳤다 — 그 갈래의 두 사유(머릿말이 서로 다른 두 원문 이름을 같은 부분으로 되돌림 · DDL 에 같은 `CREATE TABLE` 이 두 번) 모두 담는다. ⚠️ **이월 문구는 앞엣것만 지목했지만 뒤엣것도 이 트랙 이전부터 안 세고 있었다.** 담는 값은 **DDL 원문 이름** 그대로이고(경고 `target` 과 같은 기준) 요약 문구도 안 바꿨다. (B) 설계 D3 의 「사이드바 트리·캔버스는 부분을 유지한다」를 테스트로 못 박았다 — **프로덕션 무변경**. ⚠️ **그 두 테스트의 구분력은 전적으로 픽스처가 진다**(템플릿이 비면 조합 = 부분이라 단언이 그냥 통과한다). **프로덕션 변경은 `ddl-import.ts` 한 줄이고 서버·CLI·마이그레이션 없음** |
| **이름 트랙 잔여 3건(병렬)** | 워크트리 3개를 동시에 돌려 각 워커가 **브레인스토밍부터** 했다. (1) **컬럼 이름 템플릿 — 만들지 않기로 정했다**(용어가 컬럼 논리명과 1:1 이라 접두가 붙으면 정의상 표준 물리명과 어긋나는데 용어 검사는 부분 기준이라 경고도 안 뜬다 · 테이블 템플릿을 정당화한 「중복은 최종 기준」의 대응물이 컬럼에는 0). 근거와 「그래도 만든다면」의 설계를 [결정 문서](specs/2026-08-20-column-name-template-decision.md)에 남겼고 `docs/13-naming.md` 의 낡은 문장 다섯도 고쳤다. **코드 변경 0.** (2) **머릿말 잔여** — 그룹 좌표는 안 하기로 판정(정본 파일 형식이 좌표를 이미 빼므로 실으면 교환 형식이 정본보다 충실해지는 역전), 동명 그룹이 뭉개지는 방식을 「먼저 나온 것이 이긴다」로 통일, **`35a1684` 가 만든 회귀를 닫았다**(충돌 판정과 8번 절이 서로 다른 사실을 봐서 같은 물리명이 둘 생겼다 — `groupOf` 하나로 통일해 갈릴 수 없는 구조로 만들었다). (3) **경고 좌표·문구** — `reserved` 문구를 core 에서 잠그고, `validate` 와 `push`·`diff` 충돌 리포트의 좌표를 **재조립이 아니라 읽어 온 실제 파일**로 바꿨다(`filesToModel` 에 `tableFiles` 가산). **서버·마이그레이션 없음** |
| **머릿말이 그룹·별칭까지 왕복 복원** | 머릿말 형식을 `erdd:v2` 로 올려 최상위를 `t`(테이블)·`g`(그룹) 두 구획으로 갈랐다. 테이블 항목에 소속 그룹 이름(`g`)이, 그룹 구획에 **별칭·색·코멘트**가 실린다(v1 은 계속 읽는다). `ddl.ts`·`dbml.ts` 에 복제돼 있던 머릿말 빌더를 `name-meta.ts` 의 `buildNameMeta` 하나로 합치고 그룹 수집을 얹었다. 가져오기는 머릿말 그룹을 `DdlImportGroup[]` 에 합류시키고(같은 이름의 DBML `TableGroup` 블록보다 **머릿말이 이긴다** — 설계 D7), 이름 충돌 판정 키를 **(그룹 이름, 만들어질 부분 이름)** 으로 넓혀 그룹이 다른 같은 이름의 테이블이 더 이상 잘못 건너뛰어지지 않는다. 별칭이 갈리면 `group-conflict` 경고를 낸다(색·코멘트는 표시용이라 조용하다 — 설계 D3). ⚠️ **「템플릿을 안 쓰는 프로젝트의 산출물은 한 글자도 안 바뀐다」가 「그룹도 템플릿도 안 쓰는 프로젝트」로 좁아졌다**(설계 D4) — 그룹만 쓰던 프로젝트의 DDL 첫 줄에 이제 주석이 생긴다. **서버·CLI·마이그레이션 변경 없음**, 웹은 `ddl-import-edits.ts` 의 별칭 한 줄뿐이다 ([설계](specs/2026-08-19-group-meta-roundtrip-design.md)) |
| **CLI 로컬 모드(`erdd serve`)** | `erdd serve` 가 Fastify + **축소 tRPC 라우터** + 파일 저장소(`packages/cli/src/local/`)를 띄워 계정·DB 없이 `erdd/` 파일을 진실 원천으로 **기존 웹 에디터를** 브라우저에 연다(`erdd init --local` 은 `erdd.config.yaml` 만 쓴다). `apps/server` 를 재사용하지 않은 이유는 재사용할 계층의 대부분(`FOR UPDATE` 락 · op 영속화 · 권한 게이트)이 Postgres 전제라 **축소 라우터가 추상화보다 작기** 때문이다. ⚠️ **급소는 계약 잠금이다**(→ 3.18) — 웹은 `AppRouter` **타입**으로 클라이언트를 만들어 로컬 라우터가 어긋나도 **컴파일에 안 잡히고 런타임에 깨진다.** 좌표·메모는 `erdd/layout.yaml` 로 **갈랐다** — 스키마 파일에 넣으면 테이블을 **옮기기만 해도** diff 가 뜨고(그래서 원래 뺐다), git-ignore 하면 팀이 공유하는 그림을 잃는다. 서버와 오가는 파일은 그대로라 `pull`/`push` 는 이 파일을 보지도 않는다. 파일 감시의 **자기 쓰기는 내용 서명 비교**로 거른다(안 거르면 쓰기 → 감시 → 재로드 루프가 돈다) — ⚠️ **`load()` 전후의 서명을 비교하면 안 된다**(서명은 `flush()` 만 바꾸므로 언제나 같다). **읽은 것과 쓴 것**을 비교해야 한다. 웹의 재로드는 `setLoaded` 가 아니라 **`resync`** 다 — `resync` 만 `keptSelection` 을 타서 사라진 대상이 선택에 남지 않고 그룹 뷰에서 튕기지 않는다. `apps/server` 변경은 `auth.me` **한 곳**(`mode` 를 core 의 `RunMode` 로 명시). 마이그레이션 없음 → [설계](specs/2026-08-20-cli-local-mode-design.md) |
| **CLI DDL·DBML 내보내기/가져오기** | 소비처 피드백 3·4·5번. 신규 명령 `erdd export`(`--format ddl\|dbml` · `--dialect` · `-o`)와 `erdd import <파일>`(`--format` · `--dialect` · `--dry-run`), 그리고 `erdd init --local` 의 `--dialect`·`--case`. **서버를 타지 않는 순수 파일 경로**라 두 모드에서 같이 돈다. 선행으로 `applyDdlImport` 와 그룹 팔레트를 web → core 로 옮기고(`ddl-apply.ts`·`group-palette.ts`) **배치를 `LayoutFn` 주입 인자로 뺐다** — core 는 dagre 를 의존할 수 없어 기본값이 격자(`gridPositions`)이고 web 이 `computeAutoLayout` 을 주입한다(주입을 빼면 오류 없이 격자로 바뀌므로 web 에 잠금 테스트 1건을 남겼다). 가져오기는 **웹 다이얼로그와 같은 경로**라 머지 동작도 같다(이름이 겹치는 테이블은 **건너뛴다** — 갱신이 아니다). 신규 id 는 `uuidv7` 로 파일에 바로 박고 `base`·`sync` 는 건드리지 않는다(서버 반영은 기존대로 `push`). 부수로 **DBML 의 방언 판별 결함**을 고쳤다 — `detectDialect` 는 DDL 전용인데 DBML 의 `[pk, …]` 속성 문법이 mssql 대괄호 시그니처를 항상 때려 모든 DBML 이 mssql 로 읽혔다(스모크에서 실측). DBML 은 웹과 같이 `Project { database_type }` 을 본다. `packages/core/README.md` 신설(소비처 tsconfig `target` 하한 **ES2022** 실측). **서버 변경·마이그레이션 없음** |

> **공용 리소스 fork·Excel 산출물/업로드**는 병렬 worktree 2개로 동시에 진행해 순서대로 병합했다(머지 커밋 `1012e9d`, `d580028`).
> **스냅샷 diff → 실시간 동시편집**은 각각 별도 사이클로 진행했다(머지 커밋 `9dbdeef`).
> **DDL 역설계 → CLI 트랙 A(읽기) → CLI 트랙 B**(`push`·3-way 병합·`diff`·에이전트 스킬) 순으로 마쳤다.

### 테스트 기준선 (이 상태에서 전부 그린이어야 정상)

```
core 877 · cli 287 · web 943 · server 209 · typecheck EXIT=0
```

⚠️ **직전 사이클(CLI DDL·DBML 내보내기/가져오기)에서 `web` 이 956 → 943 으로 줄었다 — 회귀가 아니다.**
`ddl-import-edits.test.ts` 14건이 `applyDdlImport` 와 함께 core 로 **옮겨 갔고**(core 의 +18 중 14 가
이동분이다) 그 자리에 「web 이 dagre 를 주입한다」 잠금 1건만 남겼다.

⚠️ **`server 209` 는 최근 사이클들이 재지 않고 옮겨 적기만 한 값이다.** 서버 스위트는 `DATABASE_URL`
이 필요해 워크트리에서 건너뛴 사이클이 이어졌다. **서버를 건드리는 다음 사이클은 격리 DB로 다시 재고
이 줄을 지워라.** 나머지 셋과 typecheck 는 매 사이클 실측한 값이다.

**사이클 끝마다 네 수를 전부 실측해 갱신한다.** 기준선이 낡으면 "내 사이클이 올린 수"를 계산할 수
없다. 사이클별 증감·라운드 내역은 그 사이클이 도는 동안의 작업 로그이므로 여기 남기지 않는다 —
끝난 사이클의 내역은 `git log` 가 들고 있다.

#### 스위트를 돌리는 법

가장 확실한 것은 루트 `pnpm verify` 하나다 — typecheck + 네 스위트(`packages/core`·`packages/cli`·
`apps/web`·`apps/server`)를 `&&`로 묶어 어느 하나라도 실패하면 비정상 종료한다. 서버 스위트는 DB env
가 필요하다. **`DATABASE_URL`을 `erdd_test`로 명시해서 준다:**

```bash
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm verify
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
```

`apps/server` 테스트는 **`DATABASE_URL`을 직접 줘야 한다** — 없으면 조용히 174건이 skip되고
`20 passed | 174 skipped`로 초록색을 낸다. **실패로 보이지 않으니 수를 확인해라**(`209 passed`, skip 0).

🔥 **`. ./.env` 로 verify 를 돌리지 마라 — 개발 DB가 통째로 날아간다.** 여기에는 이전에
`set -a && . ./.env && set +a && pnpm verify` 가 정상 절차로 적혀 있었는데, **그것은 개발 데이터를
파괴하는 명령이다.** 루트 `.env` 의 `DATABASE_URL` 은 개발 DB(`erdd`)를 가리키고, 서버 테스트는 그
값을 **그대로** 쓰며(`apps/server/src/testing/helpers.ts:7` → `buildServer({ databaseUrl:
process.env.DATABASE_URL })`), 각 테스트가 **전 테이블을 `TRUNCATE ... CASCADE`** 한다
(`apps/server/src/testing/db.ts:16`). **2026-08-12 실제 발생** — 이 문서의 지시를 그대로 따라 `erdd` 의
데이터가 전부 지워졌다. 테스트는 전건 통과했으므로 **아무 경고도 뜨지 않는다.** 워크트리의 `.env` 를
로드해 verify 를 돌리는 것도 같은 사고다 — 그 `.env` 의 `DATABASE_URL` 은 그 트랙의 **개발** DB다.

⚠️ **`erdd_test` DB가 없으면 만들어 두고 마이그레이션을 적용해라.** 없는 상태로 위 명령을 돌리면 연결이
실패하고, 그때 `.env` 로 되돌리고 싶어지는 것이 바로 이 사고의 경로다. 워크트리에서는 그 트랙의 격리
test DB(`erdd_test_a` 등)를 같은 방식으로 준다.

```bash
docker exec -i erdd-db-1 createdb -U postgres erdd_test
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm -C apps/server exec drizzle-kit migrate
```

⚠️ **여기서 루트 `pnpm db:migrate` 를 쓰지 마라.** 그 스크립트는 `dev` 와 같은 관용구로 `.env` 를
셸에 로드하는데, **`.env` 의 `DATABASE_URL` 이 인라인으로 준 값을 이긴다** — `DATABASE_URL=...erdd_test
pnpm db:migrate` 는 조용히 `.env` 의 **dev** DB에 적용된다(실측: 존재하지 않는 DB명을 인라인으로 줘도
성공한다). `.env` 가 아닌 DB를 가리킬 때는 위처럼 **인라인 + 원시 호출**을 쓴다.

⚠️ **`pnpm -s -r typecheck`의 출력만 보고 판정하지 말 것.** `-s`가 자식 출력을 삼켜서, 타입 오류가
있어도 **출력이 0바이트이고 종료코드만 1**이다. 실시간 사이클에서 이 함정 때문에 구현자·리뷰어가 전원
"typecheck clean"으로 오판했고 암묵적 any 3건이 그대로 main에 머지됐다. **종료코드로 판정하거나
패키지별로 돌린다.** 파이프(`| tail`)를 붙이면 `$?`가 tail의 종료코드가 되어 또 오판한다. 리뷰어에게
typecheck를 시킬 때도 이 주의를 프롬프트에 넣어라.

```bash
pnpm -r typecheck; echo "EXIT=$?"      # EXIT=0이어야 통과
pnpm -s -C apps/server typecheck        # 또는 패키지별 — 오류가 그대로 보인다
```

### 다음 작업

**다음 후보**

계획해 둔 작업은 모두 끝났다. 공용 리소스의 반대 방향(승격)과 그 위의 요청·승인 큐까지 채웠고, 정해진 다음 작업은 없다. 후보는 (a) 6절 이월 항목 정리, (b) 사용자가 실제로 쓰다 걸린 것 중 조직 내부 도구로서 가치가 큰 것. 과금은 여전히 최우선이 아니다 — 조직 내에서 쓸 수 있는 도구 완성이 우선.

> **2026-08-10 이후 우선순위가 바뀌었다.** 물리명 우선 명명·캔버스 다중 선택·사이드바 드래그 그룹
> 이동 세 사이클은 로드맵이 아니라 **사용자가 실제로 쓰다 걸린 것**에서 나왔다(폼 순서, 양방향 명명,
> 다중 선택, 클립보드, 단축키, 필수값 표시, 그룹 정리). 이 방향이 로드맵의 남은 항목보다 값이 크다는
> 신호다 — 아래 1·2번보다 **6절의 "실사용에서 드러난 마찰"과 사이클별 잔여 항목을 먼저 보라.**
> (그 세 사이클에서 지금도 열려 있는 것: **presence 가 그룹 선택을 추적하지 않는다** · **컬럼 행
> 필수 표시** — 둘 다 6절에 항목으로 있다.)

값이 큰 순서로 추린 것:

1. **메일 발송 인프라** — 초대·비밀번호 재설정 자체는 링크로 해소됐고(위 완료 표) **발송 한 겹만
   남았다.** 지금은 관리자가 화면의 링크를 복사해 슬랙·구두로 전달한다. 메일이 붙으면 셋이 함께
   해소된다 — 링크 자동 전달, **로그인 화면의 "비밀번호 찾기"**(지금은 없다. 메일이 없는 상태에서
   두면 계정 존재 여부를 탐색당하는 미인증 공개 엔드포인트가 생길 뿐, 어차피 관리자가 링크를
   전달해야 해서 뺐다), **승격 요청 큐의 알림**(현재는 폴링 배지뿐). 발송자 선택·도메인 인증·발송
   실패 처리·개발 환경의 발송 차단이 선행 결정이다. **토큰과 화면은 그대로 두고 얹는다** — 설계가
   그렇게 나뉘어 있다([초대·재설정 링크 설계](specs/2026-08-06-invite-and-reset-links-design.md) §2.2).
2. **발주처별 Excel 양식 템플릿** — 이 저장소는 공공 SI 대상이고(전역 시드가 "행안부 표준 사전"이다)
   발주처마다 정의서 양식이 다른 것은 반복되는 마찰이다. 기존 5시트 내보내기 위에 양식 정의를
   얹는 구조. **착수 전에 실물 양식 샘플이 필요하다** — 무엇이 어떻게 다른지 없이는 설계가 안 선다.
3. 프로젝트당 복수 스키마/복수 다이어그램, MCP 서버, 6절 이월 항목 정리.

> **2026-08-09 사용자가 배제한 것 둘 — 다시 1순위로 올리지 마라.**
> - **실제 DB 접속 스키마 스캔:** "이 프로젝트 성격에 안 맞다." 설계 도구가 운영 DB에 붙는 일이고,
>   DDL 텍스트 가져오기로 값의 대부분을 이미 얻는다. 로드맵에서도 제외 표시했다.
> - **메일 발송(위 1번):** "지금 필요한 타이밍이 아니다." 조직 내부에서 관리자가 링크를 전달하는
>   것이 아직 감당된다. 항목 자체는 유효하니 **지우지 않고 보류**로 둔다.
>
> **아직 실제 설계 작업에 써 본 적이 없다**(2026-08-09 사용자 확인). 로드맵이 다 채워진 지금,
> 다음으로 값이 큰 것은 새 기능이 아니라 **한 모델을 처음부터 끝까지 이 도구로 만들어 보고 마찰을
> 목록으로 뽑는 것**일 수 있다. N:M 사이클의 스모크를 그 축소판으로 돌렸고, 거기서만 실사용 마찰
> 2건이 나왔다(6절 "실사용에서 드러난 마찰" 참조).

> **해소된 후보는 그 사이클에서 이 목록과 6절에서 함께 지운다.** 안 지우면 다음 세션이 끝난 일을
> 후보로 고른다 — `cancel` 의 read-then-write 가 실제로 그랬다(고쳐진 뒤로도 양쪽에 남아 있었다).
> 지울지 다시 쓸지는 **"이 항목이 가리키던 마찰이 전부 사라졌는가"** 로 판정한다. 절반만 해소됐으면
> 통째로 지우지 말고 **남은 것만 좁혀 다시 적는다**(초대·재설정이 그 예다 — 링크가 생기고 발송이
> 남아 1번으로 좁혔다). 통째로 지우면 다음 세션이 남은 것을 잊고, 그대로 두면 이미 만든 것을 다시
> 설계한다.

무엇을 고르든 착수 전에 brainstorming 스킬로 사용자와 우선순위·load-bearing 결정을 먼저 확정한다(5절 "작업 방식" 참조).

## 2. 읽을 문서 (순서)

0. **`CLAUDE.md`**(저장소 루트, `AGENTS.md`가 같은 파일을 가리킨다) — 반드시 지켜야 할 작업 규칙:
   메모리 기능 금지, git(최상위 체크아웃·스테이징·커밋 메시지), 워크트리 생성·포트·격리 DB, Orca
   오케스트레이션 우선. Claude Code 세션에 자동 로드되지만, **재사용할 결정을 기록할 때 목적지를
   정하려면 직접 읽어라.**
1. **이 문서** — 현재 상태·불변식·환경·워크플로
2. 작업할 영역의 **설계 문서** — `docs/superpowers/specs/`. 기능을 왜 그렇게 만들었는지의 근거와
   결정 기록이 여기에 있고, 새 사이클의 패턴 참고용이기도 하다. 최신 것 몇 개를 본다. 직전 사이클은
   `specs/2026-08-20-cli-local-mode-design.md` 이고, 만들지 않기로 정한 것을 남긴 결정 문서의 예는
   `specs/2026-08-20-column-name-template-decision.md` 다. **계획서는 병합 뒤 지우므로 `specs/` 만 남는다**(5절)
3. **사용자용 매뉴얼** — `docs/manual/install.md`(사내 서버 설치·운영), `docs/manual/user-guide.md`(웹 UI 기능별 레퍼런스 19절), `docs/manual/cli-guide.md`(`erdd` CLI 11절 — 설치·연결, 워크플로, 파일 포맷, 명령 레퍼런스, 3-way 병합·충돌, 에이전트 연동, `--json` 규약), `docs/manual/local-guide.md`(로컬 모드 8절 — 준비·시작, 되는 것과 없는 것, 파일과 git, 스냅샷, 서버 이관). 개발자용이 아니라 **제품 사용자용**이다. 기능을 바꾸면 여기도 함께 고쳐야 한다 — 특히 화면 문구를 바꾸면 user-guide 의 「」 인용이 어긋나고, 환경변수·compose·마이그레이션을 건드리면 install 의 표와 절차가 어긋나며, **CLI 의 명령·옵션·출력 문구·종료 코드·파일 포맷을 바꾸면 cli-guide 가 어긋난다**(그 문서는 실물 출력을 그대로 인용한다). **로컬 모드 분기(`useIsLocal`)를 늘리거나 줄이면 local-guide 4.2 의 장별 대조표와 user-guide 각 장 머리의 「로컬 모드에는 없다」 표시가 함께 어긋난다** — 둘은 같은 사실을 두 곳에서 말한다. **게시 형태가 바뀌면 두 매뉴얼의 설치 절이 함께 어긋난다** — cli-guide 2절과 local-guide 2절이 사내 레지스트리 설치(`.npmrc`·토큰·`pnpm add -D @erdd/cli tsx`)와 「웹 번들이 패키지에 동봉된다」를 각자 적고 있어서, 배포 형태·레지스트리 주소·번들 동봉 여부를 바꾸면 두 곳을 함께 고쳐야 한다(절차 자체는 → [4.1](#41-릴리스--사내-레지스트리에-cli-패키지를-게시한다)).

> `.superpowers/sdd/progress.md`(SDD 진행 원장)는 **git-ignored 스크래치**다. 세션이 바뀌면 신뢰하지 말고 이 문서 + `git log`를 기준으로 삼는다.

---

## 3. 아키텍처 불변식 (위반 시 실제 버그가 났던 것들)

### 3.1 데이터 계층
- **정규화 상태 테이블(source of truth) + append-only `revisions` op 로그.** 모든 모델 변경은 op(create/update/delete)로만. 단일 파이프라인 `runMutation`(`apps/server/src/services/mutation.ts`)이 프로젝트 행 `FOR UPDATE` 락으로 직렬화.
- **클라이언트는 producer + diff 패턴**: UI가 "다음 모델"을 만들고 `diffModels`가 op 배치를 도출 → 낙관적 `setModel` → 전역 `serializeMutation` 체인. `useModelMutation(projectId)` → `mutate(producer, { summary })`.
- id는 클라이언트 생성 UUIDv7(`newId()`).

### 3.2 새 op 엔티티를 추가할 때 (체크리스트)
현재 엔티티 10종: `tableGroup, domain, word, term, customField, table, column, relationship, index, note`

등록해야 하는 **6곳**:
1. `packages/core/src/op.ts` — `ENTITY_KINDS`
2. 같은 파일 — `ENTITY_SCHEMAS`
3. 같은 파일 — `COLLECTION_BY_KIND`
4. 같은 파일 — `applyOps` 초기 `next` spread (옛 모델 방어로 `{ ...(model.x ?? {}) }`)
5. `packages/core/src/integrity.ts` — `IntegrityIssue['entity']` union + `collections` 배열 (+ 참조 검사)
6. `apps/server/src/services/model-store.ts` — `TABLE_BY_KIND` + `loadProjectModel` 매핑

추가로 놓치기 쉬운 곳: `apps/server/src/services/mutation.ts`의 `KIND_LABEL`(없으면 요약이 `undefined 생성`), `apps/server/src/testing/helpers.ts`의 `withUuidIds`(fixture id 리매핑).

**⚠️ ENTITY_KINDS 순서는 정확성 제약이다.** `diffModels`는 creates를 이 배열 순서로, deletes를 역순으로 낸다. `persistOps`는 그 순서대로 SQL을 실행하고 FK는 NOT DEFERRABLE이다. → **참조 대상(부모)을 참조하는 쪽(자식)보다 앞에 둬야 한다.** 어겼을 때 스냅샷 복원(`diffModels(current, snap.model)` 단일 배치)이 FK 위반으로 500이 났다(도메인 sub-project에서 실제 발생). 새 참조 엔티티는 diff 순서 테스트(부모 create idx < 자식 create idx, 자식 delete idx < 부모 delete idx) + 실 DB 단일 배치 persist 테스트를 반드시 추가.

**⚠️ 임시 `persistOps` 가드는 `OpApplyError`로 throw.** 엔티티를 `ENTITY_KINDS`에 넣는 태스크와 서버 `TABLE_BY_KIND` 배선 태스크가 나뉘면 중간에 임시 가드를 넣게 되는데, plain `Error`면 라우터 catch(`OpApplyError`만 400)를 못 타 미제어 500이 된다(도메인·명명 두 번 재발). `@erdd/core`의 `OpApplyError`를 쓰고 "해당 op → 400" 회귀 테스트를 남긴다.

**⚠️ 한 뮤테이션의 op 상한은 `MAX_OPS_PER_MUTATION`(5000)이다**(`apps/server/src/routers/model.ts`, Fastify `bodyLimit`도 함께 올려 둠). 사전 일괄 등록처럼 "단일 뮤테이션 = Revision 1건 = undo 1회"를 지켜야 하는 기능은 이 천장에 걸린다 — 대량 배치를 만드는 UI는 **미리 막고 안내**한다(낙관적 반영 후 서버 거절로 되돌려지는 것을 사용자가 겪지 않도록). 원래 500이었는데 600단어 사전이 400으로 막혀 Excel 사이클에서 올렸다.

**⚠️ diff 함수가 두 개다. 용도를 섞지 마라.**
- `diffModels`(`diff.ts`) → `Op[]`. **적용용**이고 FK 안전 순서로 정렬된다. 스냅샷 복원·CLI push(`applyMerge` 결과 위에서 호출)가 의존하는 불가침 함수다.
- `diffModelsForDisplay`(`model-diff.ts`) → `ModelDiff`. **표시용**이고 사람이 읽는 순서로 정렬, 이름 해석, 배치 좌표 제외, 참조형 속성(id) → 이름 변환을 한다.
- `model-diff.ts`의 **`KIND_ORDER`가 사실상 7번째 엔티티 등록처**다(이 배열을 순회해 diff를 만든다). 누락하면 그 종류가 정의서에서 조용히 빠진다 — 완전성 테스트가 `ENTITY_KINDS`와 대조해 잡는다. `FIELD_LABEL`도 함께 채워야 한다(누락 시 필드명 원문이 노출될 뿐 테스트는 통과한다).
- **판정과 표시를 분리한다**: 변경 감지는 원시 값(`formatValue`)으로만 하고, 이름 해석(`formatFieldValue`)은 표시에만 쓴다. 판정이 이름 기준이 되면 도메인 이름만 바꿔도 그 도메인을 쓰는 컬럼이 전부 "변경"으로 잡힌다.

### 3.2b 공용 리소스(전역·조직 라이브러리)
- `resource_libraries` / `resource_items`는 **op 로그 밖의 일반 테이블**이다(프로젝트 모델이 아님). 프로젝트로 fork된 결과만 op 엔티티가 된다.
- 모델 4종(`domain`/`word`/`term`/`customField`)의 `origin` = `{ libraryId, sourceId, sourceVersion, base }`. **`base`는 가져온 시점에 프로젝트 공간으로 투영해 써넣은 payload**라, `payloadOf(현재) ≠ base` 하나로 "프로젝트가 고쳤는지"가 판정되고 3-way 병합 전체가 core 순수 함수(`resource-sync.ts`)로 닫힌다. 버전 이력 테이블이 없다.
- 적용은 **새 엔드포인트 없이 기존 `model.mutate` 경로**를 탄다 → Revision 1건, undo 1회로 원복.
- 원본에서 삭제된 항목은 프로젝트에 그대로 둔다(삭제 제안 없음 — 프로젝트 독립성 원칙).

**반대 방향(승격, `resource-promote.ts` + `resource.promote`)** — 가져오기와 대칭이지만 규칙이 셋 더 있다.

- **`origin.base`는 승격에서도 "가져오기 직후"와 같아야 한다.** 라이브러리에 쓴 payload를 **다시 프로젝트 공간으로 투영한 값**을 넣는다(프로젝트의 현재 payload를 그대로 넣으면 안 된다). 정상 케이스는 왕복이 항등이라 곧바로 동기 상태가 되고, **도메인을 빼고 올린 용어**는 `base.domainId=null ≠ 현재값`이라 "프로젝트가 고침"으로 잡혀 나중에 `auto-update`가 도메인 연결을 조용히 지우는 사고가 구조적으로 막힌다. core 테스트가 양방향으로 고정한다.
- **승격은 프로젝트 엔티티의 `origin`만 바꾼다.** 그래서 op는 전부 `origin` 1필드 update이고 선택 항목 수 = op 수다. undo는 `origin`만 되돌리며 **라이브러리에 쓴 항목은 남는다**(op 로그 밖이라 구조적으로 그렇다).
- **판정 순서가 DB 행 순서에 의존하면 안 된다.** `loadProjectModel`의 `SELECT`에는 `ORDER BY`가 없어서, 동명 항목이 둘일 때 클라와 서버가 서로 다른 쪽에 `name-match`를 주면 양쪽 다 `plan-changed`로 건너뛰어 **영원히 수렴하지 않는다.** `planPromote`가 엔티티를 **id 오름차순으로 정렬한 뒤** 선점을 판정해 막는다 — 새 선점 규칙을 넣을 때 이 정렬을 지워선 안 된다.
- 클라는 payload를 보내지 않는다. `{entityId, expectedStatus, expectedTargetItemId, expectedTargetVersion}`만 보내고 서버가 락 안에서 계획을 재계산해 어긋난 항목만 건너뛴다(`missing`/`plan-changed`). **`expectedTargetVersion`이 없으면** 다이얼로그를 연 사이 남이 고친 원본을 낡은 미리보기 기준으로 덮어쓴다.

**요청·승인 큐(`promotion_requests` + `promotion.*`)** — 위 승격 위에 얹힌 층이라 규칙이 셋 더 있다.

- **승격의 유일한 엔진은 `services/promote.ts`의 `runPromoteInTx`다.** `resource.promote`(직접 승격)와
  `promotion.resolve`(요청 승인)가 이것을 공유한다. 세 번째 승격 경로를 만들면 반드시 이 함수를 거쳐야
  하고, **`prepare` 훅 밖에서 부르면** 프로젝트 행 락 밖에서 라이브러리를 쓰게 된다. 라이브러리 항목
  조회도 같은 파일의 `loadLibraryItems` 하나뿐이어야 한다 — 요청 시점(`promotion.create`)과 승인
  시점(`runPromoteInTx`)이 **같은 값을 계산해야 하고**, `orderBy(asc(createdAt))`가 `planPromote`의
  동명 선점 순서를 정하므로 한쪽만 바뀌면 판정이 갈린다.
- **요청 행은 엔티티 포인터(`entityIds`)만 담는다.** payload를 동결하면 `origin.base` 규칙(3.2b 첫
  항목)을 요청 시점 기준으로 다시 유도해야 하고, 그 사이 엔티티가 삭제되면 `origin`을 쓸 대상이 없어지며,
  요청 행이 모델과 별개의 진실 원본이 된다. 승인 화면은 `promotion.get`이 **지금** 계산한 계획을 쓰고,
  요청 당시 있었으나 계획에서 사라진 항목은 `unavailable`로 분리한다.
- **`promotion_requests`에 `orgId` 컬럼을 두지 않는다.** 조직 단위 조회는 `resource_libraries.orgId`
  조인으로 얻는다 — `create`가 `library.orgId === project.orgId`를 강제하므로 두 경로가 같은 값을
  가리키고, 컬럼을 따로 두면 그 둘이 어긋날 자리가 생긴다. **조직 경계는 테스트로 잠겨 있다**(외부인이
  소유한 조직에 pending 요청을 심는 `seedForeignPendingRequest` 픽스처) — 이 픽스처를 지우면
  `listForOrg`의 행 필터와 `pendingCount`의 조인 조건이 동시에 무방비가 된다.

### 3.3 하위호환 (스냅샷·옛 리비전)
- 모델에 새 컬렉션을 추가하면 `ProjectModelSchema`에서 `.default({})`. 단, **`z.infer` 출력 타입은 필수**이므로 `: ProjectModel` 리터럴(fixtures, model-store 반환 등)에는 전부 키를 추가해야 한다(typecheck-driven으로 훑기).
- 엔티티에 새 필드를 추가하면 `.nullable().default(null)`(옛 op 페이로드 파싱).
- **스냅샷 복원은 정규화 필수**: `snapshot.ts` restore가 `diffModels(current, { ...createEmptyModel(), ...snap.model })`로 누락 컬렉션을 보충한다. 새 컬렉션을 추가해도 이 패턴 덕에 옛 스냅샷이 깨지지 않는다(제거하지 말 것). 단, 이 정규화는 **컬렉션 키만** 보충하고 **엔티티 필드**(예: `table.custom`)는 안 채운다 — 옛 스냅샷의 엔티티에 새 필드가 없으면 `diffModels`가 그 차이를 감지하되(커스텀 항목 sub-project에서 실제 발생), **빈 `changes`의 update op는 만들지 않는다**(`diff.ts`가 target 기준으로 실변경 없으면 op를 내보내지 않도록 방어). 새 엔티티 필드를 추가할 때는 이 케이스(구 스냅샷에 필드 없음)를 회귀 테스트로 남긴다.

### 3.4 웹 UI 재발 버그
- **에디터 다이얼로그의 트리거는 `header-tools.tsx` 만 렌더한다.** 다이얼로그 컴포넌트 8개(`version-dialog`·
  `domain-panel`·`dict-panel`·`custom-field-panel`·`resource-panel`·`naming-check`·`ddl-import-dialog`·
  `export-dialog`)는 **제어형**이라 `open`·`onOpenChange` 를 받고 **자체 열림 상태를 갖지 않는다.**
  선택적 제어(prop 이 있으면 제어, 없으면 자체 상태)로 두지 않는다 — 규칙이 두 벌이 되고 트리거가 두 군데서
  날 수 있다(3.13 과 같은 뿌리). **컴포넌트 안의 권한 가드도 트리거 쪽으로 간다** — 제어형은 컴포넌트가 스스로
  사라져도 메뉴에 눌러도 아무 일 없는 죽은 항목을 남긴다(`ddl-import-dialog` 의 `canEdit`).
- **이벤트 값은 producer 진입 전에 캡처.** `serializeMutation`이 producer를 마이크로태스크로 지연 실행하므로, `mutate((m) => ... e.target.value ...)`처럼 lazy read하면 제어 인풋이 먼저 리셋되어 stale 값을 읽는다. 반드시 `const v = e.target.value` 후 producer에 넘긴다.
- 경고 표면은 이미 있다: `computeWarnings(model, rules?, dialects?)`(core `warnings.ts`) → `buildNodes`가 scope별로 분배 → `WarningBadge`. 새 경고 종류는 이 함수를 확장하면 배지·패널·명명 검사 화면에 자동 노출된다.
- 프로젝트 설정(방언·명명 규칙)은 버전 모델이 아니라 `projects` 행에 있고, `useModelLoader`가 `project.get`으로 조회해 store(`namingRules`, `dialects`)에 넣는다.

### 3.5 core 규칙
- `packages/core`는 **IO·런타임 의존성 free**(순수 도메인 로직). 레이아웃 계산용 dagre 같은 것은 `apps/web`에만. Excel의 `exceljs`도 `apps/web`에만 두고 **동적 `import()`로만** 쓴다(초기 번들 영향 없음) — 양식 정의·파싱 규칙 자체는 core의 순수 함수(`excel-sheets.ts` / `excel-import.ts`)다.
- DDL은 `generateDdl(model, dialect, scope)` 시그니처 불변, 경고는 `ddlWarnings(model, dialect, scope)`로 분리.
- **Excel 왕복 계약**: 내보내기 헤더 배열과 업로드 파서가 같은 상수를 공유해, 내보낸 파일을 그대로 다시 올릴 수 있다(단어·용어·도메인 3시트). 양식 다운로드도 같은 빌더를 쓴다. 유일한 예외는 용어사전의 `구성 단어`(파생값 — 업로드 시 무시).

### 3.5b 논리명 구분자 (`NamingRules.logicalSeparator`)

- **`logicalSeparator` 는 물리명 `separator` 와 별도 축이다. 하나로 합치지 마라.** 합치면 물리명
  규칙을 `''` 로 바꾸는 순간 **저장된 논리명 전체가 규칙 위반**이 된다 — 저장 데이터가 다른 축의
  설정에 끌려다니는 결합이다.
- **논리명 분해는 구분자 split 이 1차이고, 사전에 없는 토큰만 그리디로 재분해한다**
  (`decomposeByWords` 의 폴백). ⚠️ **이 폴백을 지우면 구분자 없는 기존 논리명이 통째로 미등록
  단어가 되어 물리명 생성이 죽는다.** 실증: `else segments.push(...greedyDecompose(token, words))`
  를 `{ text: token, word: null }` 로 바꾸면 「구분자가 없는 옛 논리명은 그리디로 재분해한다」가
  `['회원주문번호']` 로 빨개진다.
- **용어 매칭은 항상 `stripLogicalSeparator` 를 거친다.** 용어 저장값은 건드리지 않는다 — 전역·조직
  라이브러리에서 fork 로 내려오므로 이 프로젝트의 구분자 정책을 강요할 수 없다. 넣을 때만
  `withLogicalSeparator` 로 변환한다. 이 정책을 쓰는 자리는 넷이다:
  `generatePhysicalName` 1단계 · `restoreLogicalName` 1단계 · `suggestCompletions` 의 용어 후보 ·
  `warnings.ts` 의 `findMatchingTerm`. **한 곳만 고치면 같은 이름이 경로에 따라 매칭되거나 안 된다.**
- ⚠️ **기본값이 주입되는 지점은 `project.get` 의 `NamingRulesSchema.parse` 하나뿐이다.**
  DB 컬럼 기본값은 마이그레이션에 구운 3키라 파싱을 태우지 않으면 `logicalSeparator: undefined` 가
  클라이언트에 도착한다. **`DEFAULT_NAMING_RULES` 에 키를 더하는 순간 이 파싱이 없으면 서버 테스트가
  빨개진다** — 명명 규칙에 새 필드를 붙일 때 서버 변경을 뒤로 미룰 수 없다는 뜻이다.
  CLI 는 같은 문제를 `readConfig` 반환 직전의 보정으로 푼다(필수로 요구하면 기존 사용자의 pull 이 깨진다).
- **`decomposeByWords` 의 계약이 바뀌었다** — 세그먼트 `text` 를 이어붙여도 **원본이 복원되지 않는다**
  (구분자가 빠진다). 원본을 되살리려면 `rules.logicalSeparator` 로 join 해야 한다.
- **분해 규칙을 쓰는 함수는 `rules` 를 받아야 한다. `DEFAULT_NAMING_RULES` 를 하드코딩하지 마라** —
  `buildExcelSheets`(「구성 단어」 파생 컬럼)와 `wordUsage` 가 이번에 인자를 뚫었고, 실호출처는
  프로젝트의 `namingRules` 를 넘긴다. 하드코딩하면 구분자를 끈 프로젝트에서 조용히 어긋난다.
  - ⚠️ **그 배선은 잠기지 않는다 — 되돌려도 전건 초록이었다**(리뷰 실측, 3곳 전부). 지금은
    `findMatchingTerm`(core 2건) · `export-dialog`(web 1건) · `dict-panel`(web 2건)이 각각 잠근다.
    **잠금 픽스처를 만들 때 두 규칙에서 결과가 실제로 갈리는지 대상 함수를 직접 불러 확인해라** —
    `wordUsage` 는 그리디가 구분자를 넘어 같은 단어를 찾으므로 순진한 픽스처로는 갈리지 않는다
    (용어 경로를 태워야 갈린다).
- ⚠️ **읽기 스키마와 쓰기 스키마를 같은 것으로 쓰지 마라.** `NamingRulesSchema` 의
  `.default('_')` 는 **읽기 시점 주입**이 목적인데 쓰기 입력에 걸면 **키 누락이 곧 기본값 쓰기**가
  되어, 3키만 보낸 클라이언트가 꺼 둔 프로젝트(`''`)를 조용히 켠다. `project.update` 는
  `NamingRulesStrictSchema`(모든 키 필수)를 쓴다 — 두 스키마의 목적이 정반대다.
- **성능:** 이 사이클 초판은 옛 형식 모델(구분자 없는 논리명, 100테이블×20컬럼·단어610·용어300)에서
  `computeWarnings` 가 **p50 534ms** 였다(기준선 180ms). `useMemo` 3곳에서 도니 모델 변경 1회당
  1.6초다. 셋을 고쳐 **189ms** 로 되돌렸다 — ① `GenResult.segments` 재사용(같은 논리명을 두 번
  분해하지 않는다) ② `stripLogicalSeparator` 조기 반환 ③ `decomposeByWords` 가 구분자 없는 이름에서
  Map 생성 전에 그리디로 떨어진다. **①은 용어 완전일치로 끝난 갈래에 `segments` 가 없다는 것을
  반드시 처리해야 한다**(무조건 대체하면 용어로 끝나는 논리명의 구분자 경고가 사라진다).
  ⚠️ **D3 이 모든 기존 프로젝트를 그 느린 상태로 만든다** — 분해 경로를 건드리면 이 수치를 다시 재라.

---

---

### 3.6 실시간 협업 (실제로 물린 것들)

- **모델을 바꾸는 모든 경로는 `mutateAndPublish`를 거친다**(`apps/server/src/services/mutate-publish.ts`). `runMutation`을 직접 부르면 커밋은 되지만 **실시간 채널로 전파되지 않는다.** 호출처는 `model.mutate`·`snapshot.restore`·CLI `model.push`(CLI 트랙 B) 셋이다. 발행은 `db.transaction()`이 resolve된 **뒤**에만 일어나야 한다 — 콜백 안에서 발행하면 롤백된 op가 채널로 나간다(drizzle의 `transaction()`은 `commit`을 await한 뒤에만 resolve하므로 현재 구조에선 구조적으로 불가능).
- **`store.seq`에는 의미가 하나여야 한다.** 이 사이클의 Critical 결함이 여기서 나왔다: `use-model.ts`의 `submit()`이 서버 응답 seq로 `setSeq`하고, `use-realtime.ts`는 그 값을 "내가 적용한 마지막 seq"로 읽었다. 두 의미가 갈리면, 내 mutation이 서버 락에 대기하는 동안 커밋된 **남의 op가 "에코"로 오인돼 영구 유실**된다(seq 불연속도 안 잡혀 자가 치유도 발동 안 함). 현재는 `submit()`이 `seq !== seqBefore + 1`이면 `model.get`으로 통째 resync해서 막는다. **seq에 새 writer를 추가하려면 이 불변식을 먼저 확인하라.**
- **소켓 핸들러에서 `await` 앞에 close 리스너를 걸어라.** `hub.subscribe()` 직후·`await` 이전에 `socket.on('close', ...)`를 등록하지 않으면, 인증(DB 왕복 3회)이나 `currentSeq` 대기 중 끊긴 소켓이 허브에 **영구 유령 항목**을 남긴다 — 다른 참여자에게 유령 아바타·잔상 하이라이트가 서버 재시작 전까지 남고 하트비트 타이머도 누수된다.
- **재접속 시 클라이언트 상태를 다시 알려야 한다.** 서버 `Entry`는 `selection: null`로 새로 시작하는데, 선택 발신 effect는 "값이 바뀔 때만" 보낸다. `socket.onopen`에서 현재 선택을 무조건 재발신하지 않으면 재접속 후 하이라이트가 사라진 채로 남는다. presence는 서버→클라 방향만 전체 스냅샷이고 클라→서버는 델타라 이 비대칭이 생긴다.
- **인증 실패 close(4401/4403)는 재접속 백오프에서 제외한다** — 안 그러면 무한 루프다.
- **수신 op는 기존 `serializeMutation` 체인에 태운다**(`use-model.ts`에서 export). 별도 직렬화를 만들면 내 낙관적 mutation과 교차한다.
- `resync`는 `setLoaded`와 다르다 — **`activeGroupView`를 보존**한다(남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다). 선택은 대상이 사라졌을 때만 해제한다. **서버가 모델을 바꾸는 경로**(스냅샷 복원·승격)는 성공 후 `model.get`으로 되맞추는데, 모델 전체가 바뀌는 복원은 `setLoaded`, 사전만 건드리는 승격은 `resync`가 맞다.
- **모델 밖 테이블을 같은 트랜잭션에서 써야 하면 `runMutation`의 `prepare(tx, model)` 훅을 쓴다**(승격이 라이브러리 항목을 이렇게 쓴다). 프로젝트 행 락 획득·모델 로드 뒤, `deriveOps` 앞에 돌아 권위 모델을 손에 쥔 채 쓰고 여기서 던지면 모델 변경과 함께 롤백된다. **훅 없이 `runMutation`을 직접 부르면** 네 번째 직접 호출자가 생겨 브로드캐스트를 손으로 발행해야 하고, 그 순간 이 절의 첫 불변식이 깨진다.
- dev에서 **React StrictMode가 effect를 2회 실행**해 소켓이 잠시 2개 생기고 presence 프레임이 중복된다. 프로덕션 빌드에는 없다 — dev 로그에서 중복 프레임을 보고 버그로 오인하지 말 것.
- 허브는 **인메모리 단일 인스턴스** 전제다. 다중 인스턴스로 가면 Redis pub/sub 브리지가 필요하다(설계상 예정된 확장점, 현재 범위 밖). `publishOps`/`peers`가 동기 API라 그때 시그니처를 async로 바꿔야 한다.

### 3.7 액세스 토큰 인증 (CLI 트랙 A)

> **새 tRPC 프로시저의 기본은 `authedProcedure`(세션 전용)다.** 액세스 토큰으로 호출 가능하게 하려면 `apiProcedure`로 명시적으로 열어야 하고, 그 목록은 CLI가 실제로 쓰는 것으로 한정한다. 기본이 거부이므로 프로시저를 추가해도 토큰에 저절로 열리지 않는다.

### 3.8 CLI push의 낙관적 동시성 (CLI 트랙 B)

- **`runMutation`의 `deriveOps`가 `(model, seq)`를 받는다**(`apps/server/src/services/mutation.ts`, 예전엔 `model`만). `currentSeq` 조회를 `deriveOps` 호출 **위로** 끌어올려, `model.push`의 `expectedSeq` 비교가 프로젝트 행 `FOR UPDATE` 락 안에서 이뤄지는 유일한 지점이 됐다 — **이 지점이 CLI push의 유일한 경합 방어선**이다(락 밖에서 seq를 읽으면 읽기와 커밋 사이에 남이 끼어들 여지가 생긴다). 기존 호출자 `model.mutate`·`snapshot.restore`는 두 번째 인자를 무시해 무영향이고 `mutateAndPublish`도 시그니처를 그대로 통과시킨다. **이번 브랜치에서 두 번째 호출자가 생긴 기존 함수**(5절의 최종 리뷰 질문)로 `runMutation`/`mutateAndPublish`와 `filesToModel`(`opts.newId` 주입)이 해당한다.
- **`FILE_FIELDS`/`FILE_INVISIBLE_FIELDS`(`packages/core/src/file-merge.ts`)는 3.2절과는 별개의 체크리스트다.** 3.2절의 6곳(+ `model-diff.ts`의 `KIND_ORDER`)은 **새 op 엔티티 종류**를 등록하는 곳이고, 이건 **이미 등록된 엔티티에 필드를 추가**할 때 그 필드를 파일에 보이는 것(`FILE_FIELDS`)인지 안 보이는 것(`FILE_INVISIBLE_FIELDS`)인지 분류하는 곳이다 — 서로 다른 유지보수 범주라 하나로 이어 세면 안 된다. 분류하지 않으면 `file-merge.test.ts`의 분류 완전성 테스트가 깨진다(zod shape과 실제 필드 집합을 대조해 자동으로 잡는다 — `model-diff.ts`의 `KIND_ORDER` 완전성 테스트와 같은 선례).

### 3.9 CLI push의 신규 id 고정 (멱등성)

- **`filesToModel`은 `newId`를 받으면 입력 트리의 `structuredClone` 위에서 파싱하고, 발급한 id를 그
  복사본에 되써 `assignedTree`로 낸다**(`newId`가 없으면 복사도 `assignedTree`도 없다 — `pull`·
  `validate`는 큰 트리를 다루므로 복사 비용을 지면 안 된다). **되쓰는 자리는 발급 자리(`idOf`)
  하나뿐이다** — 별도 `assignMissingIds` 순회를 두면 9곳(`groups`·`domains`·`words`·`terms`·
  `customFields`·`table`·`columns`·`indexes`·`relations`) 중 한쪽만 고쳐질 때 조용히 빈 자리가 생기고,
  그 자리가 정확히 "매번 새 id를 받는" 자리라 원래 버그가 부분적으로 되살아난다. 새 파일 종류가 붙어도
  `idOf`를 지나기만 하면 저절로 따라온다.
- **완전성은 두 단언으로 잠겨 있다: "채운 트리를 다시 파싱하면 임시 id가 0건"과 "두 모델의 id 집합이
  같다".** 후자가 없으면 **파일에 쓰는 id와 op가 서버로 나르는 id가 갈려도 아무 테스트가 안 잡는다** —
  실제로 그 상태였다(되쓰기를 `r['id'] = newId()`로 바꿔 둘을 완전히 다르게 만들어도 당시 core 459개가
  전부 통과했다. `126e24d`가 잠갔다). 그런 구현이면 다음 push가 파일의 id를 서버에서 못 찾아 원래 버그
  그대로 사본을 만든다.
- **`push`는 `confirmDeletes` 뒤·`model.push` 앞에서만 `reserveIds`를 부른다.** 앞에 두면 삭제 확인에서
  **취소한 사용자의 파일이 바뀌고**, 뒤에 두면 응답 유실 시 id가 안 남아 사이클 전체가 무의미해진다.
  그리고 **`reserveIds`의 호출처가 `push.ts` 하나인 것이 `erdd diff`가 파일을 건드리지 않는다는 보장**
  이다(계획 미리보기가 파일을 쓰지 않는 것은 계약이다) — 두 번째 호출처를 만들 때 이 보장이 먼저 깨진다.
- **`reserveIds`는 `writeTree`를 쓰지 않는다.** 그 함수의 삭제·개명 패스가 돌면 `tableFileName`이
  파일명을 물리명으로 정규화해 **사용자가 만든 파일과 갈리고**, 같은 테이블이 두 파일에 남아 다음
  push가 `idOf`의 id 중복 검사에 걸려 아예 막힌다. 기록은 **사용자가 만든 원래 경로에** 한다 —
  push가 성공하면 `syncDown`이 어차피 정규 파일명으로 재작성하고 옛 파일을 지운다.
- **`filesToModel`은 공유 객체 참조(YAML anchor/alias)를 `WeakSet`으로 감지해 `ok:false`로 세운다.**
  alias는 배열의 두 원소를 **같은 객체 하나**로 파싱하고 `structuredClone`이 그 공유를 보존하므로,
  감지가 없으면 두 엔티티가 한 id를 받아 **조용히 하나로 합쳐진 채 `ok:true`가 나간다**(실측: 컬럼
  2개 → 1개). **이 검사는 `newId` 유무와 무관해야 한다** — 발급 id를 `firstUse`에 등록해 두 번째 방문이
  explicit으로 읽게 하는 판별은 되쓰기가 있는 push 갈래에서만 성립해서, 같은 파일을 `push`는 거절하고
  `validate`는 `ok:true`로 통과시켰다. push의 파일 오류 문구가 "erdd validate로 확인하세요"라고 바로 그
  명령을 가리키므로, **지시를 따른 사용자·에이전트가 "문제 없음"을 받고 막히는** 형태였다(`14b9125`).
  참조 동일성은 id와 무관하게 직접 보이므로 두 갈래가 같은 판정을 낸다. 공유 참조를 끊는 재귀 복사는
  채택하지 않았다 — `yaml.stringify`가 공유를 다시 anchor/alias로 내보내므로, 참조를 끊으면
  `reserveIds`가 사용자의 alias 파일을 전개형으로 덮어써 조용한 데이터 손실이 조용한 파일 파괴로 바뀐다.

### 3.10 일회용 링크 (초대·비밀번호 재설정)

- **공개(세션 없이 닿는) 프로시저는 열거된 목록과 정확히 같아야 한다.** `trpc.ts:16`이 정한 기본은
  `authedProcedure`(fail-closed)이고, 이번 사이클이 그 예외로 **셋**을 더했다 —
  `invitation.peek` · `invitation.accept` · `auth.resetPassword`. 셋 다 **유효한 토큰을 유일한 자격**
  으로 삼고 토큰은 해시로만 조회되어 열거할 수 없다. **전체 공개 표면은 일곱이다** — 위 셋에
  이 사이클 이전부터 공개였던 `health.ping` · `logicalType.parse` · `auth.login` · `auth.logout`이
  더해진다(`admin.test.ts`의 `PUBLIC_PATHS`). 이 목록은 **라우터 전수 비교로 잠겨 있다**: 모든
  프로시저를 빈 입력으로 호출해 401이 아닌 것을 모아 배열과 대조하므로, 새 프로시저를 실수로
  `dbProcedure`로 열면 거기서 깨진다. **여덟 번째를 만들려면 설계 §3.5 표와 이 목록을 함께 고쳐야
  한다.**
- **`peek`도 mutation(POST)이다.** 이 저장소의 tRPC query는 input을 GET URL 쿼리스트링에 싣는다
  (`?input=…`). `peek`은 읽기만 하므로 query가 자연스럽지만, query면 **토큰이 요청 URL에 평문으로
  실려** 역방향 프록시·접근 로그에 남는다. 토큰을 입력으로 받는 프로시저는 전부 mutation이다.
- **`createAccount`는 호출자의 트랜잭션 위에서 돌 수 있다**(`services/accounts.ts`). drizzle의 중첩
  `transaction()`은 SAVEPOINT로 열려 바깥과 함께 커밋·롤백되고, 안에서 난 예외는 SAVEPOINT까지
  되감은 뒤 **그대로 재throw된다** — 그래서 "이미 트랜잭션 안"임을 알리는 플래그가 없고,
  `invitation.accept`가 `createAccount`의 unique 위반을 `catch`해 CONFLICT로 바꾼 뒤 바깥
  트랜잭션을 통째로 되감을 수 있다(초대는 소비되지 않고 남는다). 초대 수락은 **계정·개인조직·
  조직합류·초대소비가 한 트랜잭션**이어야 한다 — 중간에 끊겨 "계정은 생겼는데 조직에 못 들어간"
  상태가 되고 초대까지 소비됐다면 복구 경로가 없다. 이 함수의 존재 이유는 **셋이 갈라지지 않는
  것과 이메일 정규화가 한 곳에서만 일어나는 것**이므로, 호출자가 사용자 insert를 직접 하는 네
  번째 경로를 만들면 그 순간 깨진다.
  - ⚠️ **`accept` 경로에서는 scrypt 해싱이 열린 트랜잭션 안에서 돈다.** `createAccount`는
    `hashPassword`를 자기 `db.transaction` **전에** await하는데, `accept`는 이미 트랜잭션을 열어
    두고 부르므로 수십~수백 ms 동안 트랜잭션과 풀 커넥션을 잡는다. 초대 수락은 드문 경로라 지금
    규모에서는 감당되지만, **같은 패턴을 로그인·재설정처럼 빈번한 경로로 복사하면 커넥션 고갈이다.**
- **만료·1회용 판정은 `assertLive`(`services/one-time-token.ts`) 한 곳에서만 한다.** 초대와 재설정이
  각자 판정하면 한쪽만 고쳐질 수 있고 그 순간 죽은 링크가 살아난다. **판정 순서도 계약이다** —
  `usedAt`을 `expiresAt`보다 먼저 본다(사용된 뒤 만료까지 된 토큰은 "이미 사용"이 더 정확한 안내다).
  접두(`erdd_inv_`/`erdd_rst_`)도 이 파일이 `TokenKind`로부터 정한다 — 호출자가 접두 문자열을 직접
  넘기면 `issueToken`과 `tokenExpiry`의 인자 어휘가 갈린다.
- **재발급은 이전 미사용 토큰을 만료시킨다.** 초대는 같은 (email, org)의 것을, 재설정은 같은 사용자의
  것을 `expiresAt`을 현재로 당겨 죽인 뒤 새로 넣는다. 두 링크가 동시에 살아 있으면 **첫 것이 어디로
  갔는지 아무도 모른다.** 다만 이 무효화는 **순차 재발급에만** 성립한다 — 동시에 두 `create`가 들어오면
  READ COMMITTED에서 서로의 미커밋 INSERT를 못 봐 살아 있는 초대가 둘 남을 수 있다. 감수한 이유는
  피해가 갇혀 있기 때문이다(`accept`의 이메일 재검사 + 유니크 제약이 두 번째 수락을 CONFLICT로 막아
  계정이 둘 생기지는 않는다). **부분 유니크 인덱스로 막으려 하지 마라** — 만료시킨 옛 행도 `usedAt`은
  NULL이라 정상적인 재발급 자체가 막힌다.
- **초대 취소·조회 경로가 둘인 것은 권한 축이 다르기 때문이다.** 조직 초대(`orgId` 있음)는 그 조직의
  매니저가 `invitation.revoke`/`listForOrg`로, 관리자 초대(`orgId`가 null)는 서비스 관리자가
  `admin.invitations.revoke`/`list`로 다룬다. 한 프로시저로 합치면 `orgId` 유무로 권한 판정이 갈라지고,
  그 분기가 "orgId를 빼면 관리자 검사로 넘어간다"가 되어 조직 매니저가 관리자 초대에 닿는 틈이 된다.
  **둘 다 자기 묶음 밖은 UPDATE 조건에서 막는다**(관리자 경로는 `orgId IS NULL`을, 조직 경로는 그
  `orgId`를 함께 넣는다).
- **`routes.tsx`는 `router`가 아니라 라우트 표(`routes` 배열)를 export 하고, `routes.test.tsx`만
  그것을 소비한다.** 비보호 라우트(`/invite/:token`·`/reset/:token`)가 정말 `Protected` 밖에 있는지는
  **실제 표를 렌더해야만** 검증된다 — 페이지 컴포넌트를 `createRoutesStub`에 직접 꽂는 이 저장소의
  기존 패턴은 `routes.tsx`가 그 페이지를 `Protected`로 감싸도 그대로 통과한다(계획이 그 패턴을
  지정했다가 구현 중에 드러났다).
- **링크 화면의 오류 판정 기준은 "오류가 있는가"가 아니라 "다시 제출해도 결과가 같은가"다**
  (`lib/link-error.ts`의 `terminalLinkFailure`). **판정은 서버가 하고 웹은 표식만 본다** — 오류 코드로
  추론하지 않는다. `services/one-time-token.ts`의 `LinkDeadError`로 **명시해 던진 것만** 종료성이고,
  `trpc.ts`의 errorFormatter가 그것을 `data.linkDead`로 모든 응답에 싣는다. **모르는 오류는 자동으로
  비종료성으로 떨어진다.** 오분류의 대가가 한쪽으로만 크기 때문이다 — 일시적 오류를 종료성으로 보면
  **살아 있는 토큰이 죽은 것으로 표시되고** 입력한 이름까지 사라지며, 최악은 `accept`가 커밋된 뒤
  응답만 유실됐을 때 계정은 생겼는데 화면이 "링크가 죽었다"고 말하는 것이다. 반대 방향의 오분류는
  한 번 더 눌러 같은 사유를 보는 것뿐이다.
  - 처음에는 코드(`BAD_REQUEST`·`CONFLICT`)로 판정했는데, **zod 입력 검증 실패가 `BAD_REQUEST`로
    오기 때문에** 7자 비밀번호를 보내면 살아 있는 링크가 죽은 것으로 표시됐다. 코드 기반 판정은
    "종료성 바구니에서 예외를 골라내는" 부정 목록이라 골라내지 못한 것이 종료성으로 남는다.
    표식을 **종료성 쪽에** 다는 양성 목록으로 뒤집어야 기본값이 안전한 쪽이 된다.
- **죽은 링크 안내는 "그래서 무엇을 할 수 있는가"까지 갈라야 한다**(`data.linkReissuable`). 같은
  종료성이라도 **소비된 초대**는 그 이메일에 계정이 이미 있어 관리자가 새 초대를 만들 수 없고(409),
  **만료·없는 초대**는 계정이 없을 수 있어 만들 수 있다. `linkDead`와 같은 비대칭 논증으로 표식은
  "재발급 불가"라는 **더 센 주장 쪽에만** 달고 기본값은 "관리자에게 문의"(늘 참인 안내)로 둔다.
  - **테스트는 표식이 아니라 사실을 잠근다** — `linkReissuable` 값만 단언하면 재발급 정책이 바뀔 때
    테스트가 낡은 채 통과한다. 각 갈래마다 안내가 가리키는 경로를 **실제로 실행해** 확인한다
    (소비된 초대 → `invite`·`invitation.create` 둘 다 409 / 소비된 재설정 → `resetLink` 200 + 그
    링크로 실제 재설정 성공 / 만료된 초대 → 그 이메일로 `invitation.create` 200).
  - 없는 토큰과 만료 토큰은 **같은 문구·같은 갈래**로 거절한다(존재 오라클 차단). 테스트가 그
    동일성을 명시적으로 잠그고 있다.
- **`peek`의 결과는 mutation 객체가 아니라 로컬 상태로 받는다.** `MutationObserver`는
  `onUnsubscribe`에서 실행 중인 mutation에서 자신을 떼어내는데 다시 붙이는 `onSubscribe`가 없다
  (query-core 5.101.4). StrictMode는 마운트 이펙트를 "실행→정리→재실행"으로 돌리므로 그 사이 구독이
  끊기고, **그때 떠 있던 요청의 응답이 관찰자에게 영영 도달하지 않아 화면이 "불러오는 중…"에 멈춘다.**
  `mutateAsync`가 돌려주는 프로미스는 구독과 무관하게 실행에 매여 있어 그 구멍을 타지 않는다.
  중복 POST를 막는 `useRef` 가드는 **별개 방어**다(시도 번호를 담아 재시도만 통과시킨다).

### 3.11 DDL 파서의 마스킹 길이 보존 계약 (`packages/core/src/ddl-parse.ts`)

- **구조 키워드의 *위치* 는 마스킹본에서 찾고, *값* 은 언제나 원본에서 잘라낸다.** 이 파일의
  기존 관례이고(`parseColumnDef`·MySQL 꼬리 `COMMENT`), 그래서 마스킹 함수는 **길이를 반드시
  보존해야 한다** — 마스킹본에서 얻은 인덱스를 원본에 그대로 쓰기 때문이다.
- **⚠️ 이 계약은 한 브랜치 안에서 두 번 깨졌다. 둘 다 "한 글자 짧아져 뒤쪽 제약명이 밀리는" 같은
  증상이었고, 테스트 500여 개가 전부 그린인 채로 통과했다.**
  1. `for…of` 순회 — 서로게이트 페어를 문자 하나로 묶어 자리표시 1글자로 덮었다. **코드 유닛 단위
     (`for (let i = 0; i < text.length; i++)`)로 순회한다.**
  2. 인용 이스케이프 분기 — `''` `""` `` `` `` `]]` 는 **2개를 소비하고 2개를 내야 한다.**
     하나만 내면 `UX_A`가 `UX_`로 잘린다.
  두 경로 모두 회귀 테스트가 있다(`'괄호 안 마스킹이 서로게이트 페어에서도…'`,
  `'인용 이스케이프에서도 마스킹이 길이를 보존한다'`). 마스킹 함수를 고칠 때 이 둘을 먼저 본다.
- **인용 4종(`'` `"` `` ` `` `[`)은 `maskQuoted` 한 번의 좌→우 스캔에서 함께 처리한다.**
  리터럴과 따옴표 식별자를 각각 독립된 스캔으로 돌리면 **어느 쪽을 먼저 돌려도 반대편에 구멍이
  생긴다** — 리터럴이 먼저면 `"o'brien"`의 아포스트로피를 문자열 시작으로 오인해 뒤를 통째로 덮고,
  식별자가 먼저면 `DEFAULT '{"a": 1}'`(PostgreSQL jsonb, 매우 흔하다)이 깨진다. **순서 조정으로는
  못 푼다.** `splitStatements`·`splitTopLevel`·`unquoteIdentifier`가 모두 같은 관례를 따른다.
- 남는 순서 제약은 **하나뿐이다**: `maskParenContents`는 인용 마스킹 **뒤**에 온다(인용 안의 괄호가
  먼저 덮여야 깊이 계산이 맞는다 — `COLLATE "a(b"`가 실증한다). 이 순서를 바꾸지 마라.
- **컬럼 정의의 인라인 제약은 `parseColumnDef`가 함께 내주는 속성 구간(`attrs`)에서만 읽는다.**
  항목 전체를 훑으면 컬럼 **이름**이 구조 키워드와 같을 때(`"unique" boolean not null` — 사용자
  실물 DDL에 있다) 그것을 제약으로 오인한다. 정규식 가드로 막지 말고 이 구조를 유지해라.

### 3.12 DDL 파서의 식별자 정규식은 전부 `IDENT_PART`를 쓴다

- **같은 이름이 경로에 따라 살거나 죽으면 안 된다.** 한때 인라인 경로만 비ASCII 이름을 살리고
  테이블 수준·`ALTER TABLE`·컬럼명 경로는 `[A-Za-z_][\w$]*`(JS의 `\w`는 ASCII 전용)라 죽였다 —
  **비ASCII 컬럼명 하나로 컬럼이 통째로 사라졌다.** 한글 물리명을 쓰는 조직에서 체감이 크다.
  새 식별자 정규식을 만들 때는 `IDENT_PART`(따옴표 4종 + 인용 없는 이름의 **부정 문자 클래스**)를
  조립해 쓴다. 현재 사용처: `COLUMN_NAME_RE`·`NAMED_CONSTRAINT_RE`·`ALTER_ADD_RE`·
  `REFERENCES_TARGET_RE`·`CONSTRAINT_NAME_SRC`.
- **⚠️ 컬럼명 정규식(`COLUMN_NAME_RE`)은 파서의 진입점이다.** 넓히면 컬럼이 아닌 항목까지 컬럼으로
  먹을 수 있다. 그것을 막는 것은 `parseCreateTable`의 **항목 첫머리 라우팅**(`^PRIMARY KEY` /
  `^UNIQUE` / `^FOREIGN KEY` / `^CHECK`, `CONSTRAINT <이름>` 접두사를 뗀 `body` 기준)이고, 이 전제는
  테스트가 잠근다(`'테이블 수준 제약을 컬럼으로 먹지 않는다'` — `toEqual`로 유령 컬럼까지 잡는다).
  진입점을 다시 건드릴 때는 이 테스트부터 확인해라.
- **타입 정규식만 ASCII 전용으로 남아 있다**(`[A-Za-z_][\w$]*`). 의도적이다 — 유령 컬럼이 생기는
  조건이 "타입 자리에 ASCII 단어가 온다"라서, 타입까지 넓히면 테이블 수준 절 9종(6절)이 유령
  컬럼이 되는 문턱이 함께 낮아진다. 그래서 비ASCII **타입**(`회원번호 숫자`)은 아직 컬럼을 버린다.
  넓히려면 라우팅을 먼저 촘촘히 해야 한다.

### 3.13 에디터 선택 상태 (캔버스 다중 선택 사이클)

- **선택은 `selectedTableIds: readonly string[]` 하나다. 단일 선택 필드를 병기하지 않는다.** 같은
  사실에 두 진실 원본이 생기면 `store.seq`가 두 의미를 갖다가 남의 op를 영구 유실시킨 사고(3.6)와
  같은 형태가 된다. 단일 선택을 요구하는 소비자는 셀렉터 **`primaryTableId`**(`store.ts`)를 쓴다 —
  **배열 순서는 "고른 순서"이고 `[0]`이 주 선택**이다.
  - **빈 선택은 공유 인스턴스**(`NO_TABLES`/`NO_COLUMNS`)를 쓰고 타입은 `readonly`다. 매번 새 `[]`를
    만들면 그 값을 구독하는 화면이 남의 편집마다 리렌더된다. 같은 이유로 **델타가 선택을 바꾸지
    않았으면 `selectTables`를 아예 부르지 않는다.**
- **불변식: `selectedTableIds.length !== 1`이면 `selectedColumnIds`는 반드시 빈 배열이다.** 컬럼은 항상
  한 테이블 안에 있으므로 테이블 선택이 바뀌면 컬럼 선택을 비운다. 이 불변식은 **store 액션 안에서**
  지키고 컴포넌트가 각자 판단하지 않는다.
- **사라진 대상을 걷어내는 규칙은 하나다** — `pruneSelection(model)`. `resync`(seq 간극·재접속)와
  실시간 삭제 수신이 **같은 함수**를 부른다. 같은 사건을 어느 경로로 받았느냐에 따라 결과가 달라지면
  안 되기 때문이다. 선택 전체를 비우지 않고 **사라진 것만** 걷어낸다.
- ⚠️ **React Flow의 선택은 별개의 진실 원본이고, store로 흐르는 창구는 `onNodesChange`의 select 델타
  하나뿐이다.** 단일 클릭·Cmd+클릭 토글·박스 선택·팬 클릭 해제가 전부 그 한 갈래로 도착한다.
  `buildNodes`는 **노드 최상위 `selected`도 store 기준으로 세운다**(`nodes.ts`) — 세우지 않으면
  노드 배열 재구성이 React Flow의 선택을 지워 같은 사실이 두 곳에서 어긋난다.
  - ⚠️ **그 재구성은 `keepMeasured`를 거쳐야 한다**(`canvas.tsx`). 선택이 바뀔 때마다 노드 객체가
    통째로 새로 만들어지는데, `measured`를 이어붙이지 않으면 React Flow가 `handleBounds`까지 버려
    **박스 선택이 캔버스 전체를 고르는 진동 루프**가 된다(1절 완료 표의 「캔버스 박스 선택 깜박임」).
  - ⚠️ **`onSelectionChange`를 쓰지 않는다.** 노드를 prop으로 통제하면 `triggerNodeChanges`가 내부
    lookup을 갱신하지 않고 `onNodesChange`만 부르므로, `onSelectionChange`는 사실상 **우리가 넘긴
    nodes prop의 메아리**이고 그것도 렌더 한 틱 뒤에 온다. 늦은 스냅샷을 store에 되쓰면 store→nodes
    푸시와 서로를 덮어 **진동한다**(실측: 메모 클릭 한 번에 선택이 `[]` ↔ `['t1']`을 무한 반복해
    React가 "Maximum update depth exceeded"로 끊었다).
  - ⚠️ **창구를 둘로 두면 이중 토글로 상쇄된다.** React Flow는 노드를 클릭하면 `onNodeClick`보다
    **먼저** 자기 lookup을 직접 변형한다(`handleNodeClick` → `getSelectionChanges(…, mutateItem=true)`).
    그 변형이 델타로 도착하므로 `onNodeClick`에서도 `toggleTable`을 부르면 Cmd+클릭 한 번에 두 번
    토글되어 서로를 되돌린다. **그래서 `onNodeClick`에는 테이블 선택 로직이 없다**(메모·그룹·고스트
    분기만 남는다).
  - **델타에는 메모가 섞여 온다.** 그룹·고스트는 `selectable: false`라 안 오지만 메모는 온다 —
    `model.tables`에 있는 id인지로 걸러야 메모 클릭이 테이블 선택으로 둔갑하지 않는다.
- **단축키는 `document`에 걸되 셋 중 하나면 아무것도 하지 않는다** — 입력란(`input`/`textarea`/
  `contenteditable`) · **다이얼로그 열림** · `canEdit` false(C만 허용). **다이얼로그 조건을 빼면 실제
  버그다**: `project.tsx`가 다이얼로그 8개를 상시 마운트하고 Radix는 임의 keydown을 막지 않아,
  다이얼로그를 열고 Cmd+C 하면 ERDD JSON이 클립보드를 덮어쓰고 Delete가 **모달 뒤 테이블을 지웠다.**
  판정은 `document.querySelector('[role="dialog"], [role="alertdialog"]')`다 — `[data-state="open"]`
  단독은 **트리거 버튼도 그 속성을 달아** 오탐한다.
- React Flow의 `deleteKeyCode`는 **`null`로 끈다.** 두 삭제 경로가 공존하면 컬럼 선택 상태에서 어느
  쪽이 이기는지가 렌더 순서에 달린다.

### 3.14 새 `Warning['kind']`를 추가할 때 (체크리스트)

1. `packages/core/src/warnings.ts` — `Warning['kind']` union
2. 같은 파일 — `computeWarnings`의 검사 로직. **`rules` 게이트 안/밖을 정해야 한다** — 명명 규칙과
   무관한 완결성 경고는 밖에 둔다(`custom-required`·`required-empty`가 그렇다)
3. `apps/web/src/editor/naming-check.tsx` — `KIND_LABEL`. **`Record<Warning['kind'], string>`이라
   타입이 등록을 강제한다**(빠뜨리면 TS2741로 web typecheck가 깨진다). 즉 이 맵은 사실상 **세 번째
   등록처**다 — `model-diff.ts`의 `KIND_ORDER`가 "7번째 엔티티 등록처"인 것과 같은 성격이고, 이쪽은
   타입이 잡아 주므로 조용히 빠지지는 않는다
4. **컴파일러가 못 잡는 것:** 기존 경고를 회피하려고 특정 필드를 비워 두던 **테스트 픽스처**. 전체
   스위트를 돌려야만 드러난다(`required-empty` 추가 때 `naming-check.test.tsx` 3건이 그랬다 —
   `unknown-word`를 피하려고 `logicalName: ''`을 쓰던 픽스처가 새 경고를 낳았다)

배선은 그 이상 필요 없다 — `nodes.ts`와 `warning-badge.tsx`는 kind를 필터하지 않으므로 캔버스 배지·
편집 패널에는 자동 노출된다. `packages/cli`의 `validate.ts`는 `w.message`만 출력해 영향이 없다.

⚠️ **가져오기 계획의 경고(`DdlImportWarning`)는 이 체크리스트를 타지 않는다 — 별개 타입이다.**
`ddl-import.ts` 가 `warnings.ts` 의 `Warning` 과 무관하게 자기 유니온을 따로 선언하고 있어, 위 4항목
중 **1~3 이 전부 해당 없음**이다. 2026-08-19 `group-conflict` 를 더하며 전수 확인한 근거를 적어 둔다
— 다음 사람이 같은 조사를 다시 하지 않게 한다.

| 3.14 항목 | 가져오기 경고에서는 | 근거 |
|---|---|---|
| 1. `warnings.ts` 의 `Warning['kind']` | **해당 없음** | `DdlImportWarning` 은 `ddl-import.ts` 안에 따로 선언된 타입이다. **등록처가 그 유니온 하나뿐이다** |
| 2. `computeWarnings` 의 검사 로직 · `rules` 게이트 | **해당 없음** | 이 경고는 `planDdlImport` 안에서 난다. `rules` 는 논리명 복원에만 쓰이고 그룹 경로는 타지 않아 「게이트 안/밖」이라는 구분 자체가 없다 |
| 3. `naming-check.tsx` 의 `KIND_LABEL` | **해당 없음, 그래서 더 위험하다** | 가져오기 경고를 그리는 곳은 `ddl-import-dialog.tsx` 한 곳인데 **`target`·`message` 만 찍고 `kind` 로 라벨을 찾지 않는다**(그 파일에 `kind` 문자열이 없다). `Record<…kind, string>` 같은 **전수 강제가 없으므로 kind 를 빠뜨려도 타입이 안 잡고 화면이 그냥 뜬다** — core 쪽 `Warning` 과 정반대 성질이다. **문구가 유일한 사용자 접점이므로 문구를 테스트로 못 박아라** |
| 4. 테스트 픽스처 | **해당함** | `group-conflict` 는 「머릿말에 별칭이 있고 + 같은 이름의 기존 그룹이 모델에 있고 + 별칭이 다를 때」만 나 기존 픽스처(대부분 `createEmptyModel()`)에 안 걸렸지만, **조건이 넓은 경고를 더하면 여기서 터진다** |

`packages/cli` 의 `validate.ts` 는 `planDdlImport` 를 아예 부르지 않으므로 CLI 영향도 없다.

### 3.15 그룹 별칭 (`TableGroup.alias`)

- **별칭은 물리 식별자다 — 영문 대문자·숫자·밑줄.** 그룹 이름(`회원관리`)이 한글이라 물리명 조합에
  쓸 수 없어서 두는 값이고, 결국 물리명에 들어가므로 **나중에 규칙을 세우면 이미 입력된 값이 전부
  위반**이 된다(논리명 구분자 사이클에서 겪은 형태).
- **규칙은 타이핑 중에 강제한다.** `onChange` 에서 `value.toUpperCase().replace(/[^A-Z0-9_]/g, '')`.
  커밋 후 검증해 토스트로 거절하는 쪽보다 예측 가능하다. ⚠️ **그러려면 제어 인풋이어야 한다** —
  패널의 다른 세 필드(`defaultValue` + `key`)와 규칙이 다르다. 비제어 인풋에서 `e.target.value` 를
  직접 바꾸면 React 와 어긋난다. 실증: `onChange` 의 `normalizeAlias` 를 벗기면 「한글·특수문자」
  케이스가 `'mbr-회원_1!'` 로 빨개진다.
  - ⚠️ **로컬 state 훅은 `if (!group) return null` 조기 반환보다 앞에 와야 한다** — 그래서 `group` 을
    옵셔널(`group?.alias ?? ''`)로 읽는다.
- **`null` 이 아니라 빈 문자열이다**(3.3 관례와 갈리는 지점 — 1절 완료 표에 근거). DB 컬럼도
  `text NOT NULL DEFAULT ''` 다.
- **등록처는 일곱이다.** ⚠️ 설계·계획서가 **둘을 빠뜨렸고 리뷰가 잡았다** — 새 엔티티 **필드**를 더할
  때 이 목록을 그대로 훑어라.
  1. `model.ts` — 스키마
  2. `group.ts` — `updateGroup` patch 타입 + `createGroup` 리터럴
  3. `db/schema.ts` + 마이그레이션
  4. `model-store.ts` — ⚠️ `loadProjectModel` 이 **10개 컬렉션을 전부 손으로 나열**한다. 설계 3.2 의
     「행 전체를 읽으므로 매핑 배선이 자동으로 따라온다 — 확인만 하고 손대지 않는다」는 **사실이
     아니다**(설계 문서에 정정 표시를 남겼다). `drizzle` 이 행을 통째로 주기는 하지만 `ProjectModel`
     로 옮기는 것은 손으로 적은 매핑이다.
  5. `file-merge.ts` 의 `FILE_FIELDS` — 병합 대상 + **완전성 게이트**(필드를 분류하지 않으면 즉시 red)
  6. `file-format.ts` 의 쓰기·읽기 — 실제 `groups.yaml`. ⚠️ **5번만 넣으면 게이트는 통과하는데 CLI
     왕복이 성립하지 않는다.**
  7. `model-diff.ts` 의 `FIELD_LABEL` — ⚠️ **누락해도 테스트가 통과한다**(3.2 가 명시한 성질이다).
     `IGNORED_FIELDS` 에 없으면 표시용 diff 에는 잡히므로 `?? field` 폴백이 **영문 원문**을 낸다.
     새는 곳 셋: 웹 스냅샷 비교 화면 · 변경분 Excel · CLI `erdd diff`. 잠그려면 라벨 단언 1건이면
     된다(`model-diff.test.ts` 의 「그룹 별칭을 한국어 라벨로 표시한다」).
- **소비처는 테이블 물리명·논리명 형식 템플릿이다**(3.16). `{그룹별칭}`·`{그룹명}` 변수로 조합에 들어간다.
- **소비처가 하나 더 있다 — 덤프 머릿말이다**(3.17, 2026-08-19). 내보낼 때 `erdd:v2` 머릿말의 `g`
  구획에 별칭·색·코멘트가 실리고 되읽을 때 복원된다. **가져오기 계획의 `DdlImportGroup.alias` 는
  필수(`string`)이고 새 그룹은 그 값으로 만들어진다** — 기존 그룹이면 덮어쓰지 않고 갈렸을 때만
  `group-conflict` 경고를 낸다. ⚠️ **별칭에만 경고하는 이유가 위의 「물리명에 들어간다」다** — 색·
  코멘트는 표시용이라 갈려도 이름이 안 바뀐다.

### 3.16 테이블 최종 이름 (`composeTablePhysicalName` · `composeTableLogicalName`)

- **테이블의 최종 물리명은 `composeTablePhysicalName` 한 곳에서 나온다.** 산출물·검사를 새로 만들면
  그 함수를 타야 한다. `table.physicalName` 을 직접 쓰면 템플릿이 걸린 프로젝트에서 조용히 어긋난다.
  예외는 **편집 입력란·클립보드·CLI 파일·역설계**다(설계 D3 — 그쪽은 부분을 쓴다).
  - **템플릿이 비면 `physicalName` 을 그대로 돌려준다.** 소비처가 「템플릿이 있는가」를 몰라도 되게
    하는 계약이다 — 분기가 소비처로 새면 스무 곳이 각자 판단하게 된다.
  - ⚠️ **「그 함수를 타야 하는 자리」에는 정렬 키와 「논리명==물리명이면 생략」 판정도 포함된다.**
    눈에 띄는 것은 이름이 찍히는 자리라 그쪽만 고치기 쉬운데, 정렬을 부분으로 두면 **표시되는 열이
    정렬돼 있지 않은 것처럼 보이고**(실제로 Excel 이 그랬다), 생략 판정을 부분으로 두면 논리명이
    부분과 같은 테이블의 **코멘트가 통째로 사라진다.** 둘 다 리뷰가 「되돌려도 초록」으로 찾아냈다.
  - **검사 중 용어 불일치만 부분 기준이다.** 중복·길이·예약어는 조합 기준. 용어 사전의 표준 물리명은
    사용자가 입력하는 값이라 접두가 없어, 조합 이름과 비교하면 **항상** 불일치가 뜬다.
- **테이블의 최종 논리명은 `composeTableLogicalName` 한 곳에서 나온다. 단, 산출물 전용이다.**
  DDL 코멘트 · DBML note · Excel 논리명 열만 이 함수를 탄다. ⚠️ **`warnings.ts` 나
  `generatePhysicalName` 경로에서 이 함수를 부르면 설계 D1 위반이다** — 사전 조회·미등록 단어 검사·
  논리 구분자 경고·물리명 재생성은 전부 `table.logicalName`(부분)을 본다. 사전을 조합 이름으로 찾게
  하면 사용자가 **조합된 이름**을 등록해야 하고(형식을 바꾸는 순간 사전 전체가 어긋난다), 재생성이
  그룹 약어를 물리명 부분에 넣어 물리명 템플릿과 **이중 적용**된다.
  `warnings.test.ts` 의 `논리명 템플릿과 경고` 4건이 그 무변경을 잠근다 — **「아무것도 안 바뀐다」를
  지키는 테스트라 처음부터 초록이다.** 구분력은 일부러 D1 을 위반해 확인했다
  (`checkNamingEntity` 의 `t.logicalName` 을 조합으로 바꾸면 **4/4 가 빨개진다** — 범위
  `-t '논리명 템플릿과 경고'` 기준 `4 failed | 38 skipped`, 원복 후 `4 passed`).
  - ⚠️ **「아무것도 안 바뀐다」를 지키는 테스트는 픽스처가 검사 경로에 닿아야 구분력이 생긴다.**
    처음 4건 중 2건은 D1 을 위반해도 초록이었고 구현자는 원인을 「훼손할 자리가 프로덕션 코드에
    없다」로 진단했는데 **틀렸다** — 훼손 자리는 있었고 막은 것은 픽스처였다. (1) 용어 검사는
    조합 이름(`회원관리_주문`)으로 등록된 용어가 없어 「매칭 없음 → 경고 없음」이 됐고 단언이
    「경고가 없다」라서 통과했다. (2) 구분자 경고는 템플릿 `{그룹명}_{논리명}` 의 조합 결과에
    밑줄이 있어 그 검사가 **통째로 건너뛰었다.** 조합 이름 용어 한 줄과 밑줄 없는 템플릿
    (`{그룹명}{논리명}`)으로 바꿔 4/4 가 갈렸다. **「부정 단언 + 그 경로에 닿지 않는 픽스처」는
    언제나 공짜 초록이다** — 부정을 단언하는 테스트는 픽스처가 그 경로를 실제로 밟는지 먼저 확인하라.
  - **변수는 언제나 저장된 부분을 돌려준다.** 논리 템플릿의 `{물리명}` 은 `table.physicalName` 이지
    조합 물리명이 아니다 — 두 템플릿이 서로를 참조해도 **재귀가 원리적으로 성립하지 않는다.**
  - ⚠️ **「논리명==물리명이면 코멘트 생략」 판정은 양쪽 다 최종 이름으로 한다**(설계 D5). 한쪽만
    조합하면 최종 산출물에서 같은 이름인데도 코멘트가 한 번 더 나간다. `warningLabel` 의 폴백도 같다.
- **빈 구간 접기는 「밑줄만 지운다」다**(설계 D2, 두 형제가 공유). 빈 변수는 자기 자신과 **바로 뒤
  리터럴 선두의 밑줄들**을 지우고, 뒤에 리터럴이 없으면 **바로 앞 리터럴 말미의 밑줄들**을 지운다.
  - ⚠️ **말미 정리는 빈 조각을 건너뛰며 뒤에서부터 훑어야 한다.** 직전 조각 하나만 보면
    `TB_{A}_{B}` 에서 A·B 가 둘 다 빌 때 A 가 남긴 **빈 조각**에 막혀 `TB_` 가 나온다(→ `TB`).
  - ⚠️ **변수 값 조각을 만나면 멈춘다.** 사용자가 물리명을 `ORD_` 로 넣었으면 그대로 나가야 한다.
    그래서 조각에 「리터럴에서 왔는가」 표시(`Piece.lit`)가 필요하다.
  - ⚠️ **밑줄이 아닌 구분자는 남는다**(`TB_{그룹별칭}-LOG` → `TB_-LOG`). 「글자·숫자가 아닌 문자」로
    넓히지 않는 이유는 **논리명 템플릿의 리터럴이 한글이기 때문이다**(`{그룹명} 소속 {논리명}`).
- **`rules` 를 받는 함수에 `?? DEFAULT_NAMING_RULES` 폴백을 두지 않는다.** 두 사이클 연속으로 그
  폴백이 프로젝트 규칙을 조용히 무시하는 결함이었다(`dict-panel.tsx` · `buildExcelSheets`).
  테스트가 편하려면 **테스트 파일에 import 별칭 심**을 두어라 — 프로덕션 시그니처는 필수로 남긴다.
  ```ts
  // packages/core/src/ddl.test.ts 상단
  import { generateDdl as generateDdlRaw } from './ddl.js'
  const generateDdl = (model, dialect, scope = { kind: 'all' }, rules = DEFAULT_NAMING_RULES) =>
    generateDdlRaw(model, dialect, scope, rules)
  ```
  ⚠️ 객체 opts 를 감쌀 때 `{ rules: DEFAULT_NAMING_RULES, ...opts }` 순서로 쓰지 마라 — `opts.rules`
  가 명시적 `undefined` 면 기본값을 덮어 다시 깨진다. `{ ...opts, rules: opts.rules ?? 기본 }` 이다.
- **`NamingRules` 에 필드를 더하면 두 스키마를 **다르게** 고쳐야 한다.** 읽기(`NamingRulesSchema`)는
  `.default(…)` 로 기존 jsonb 행에 주입하고, 쓰기(`NamingRulesStrictSchema`)는 `.extend` 로 **기본값
  없는 필수**로 다시 적는다. 빠뜨리면 키를 안 보낸 클라이언트의 `project.update` 가 설정값을 조용히
  덮는다 — **부분 페이로드가 전체 덮어쓰기로 둔갑한다.**
  ⚠️ 그 대가로 **`project.update` 를 부르는 기존 테스트 페이로드가 전부 400 이 된다.** 새 키를 더하는
  것이 정상 해소다(옛 클라이언트를 막는 것이 이 스키마의 목적이다).

### 3.17 내보낸 산출물의 첫 줄 주석 (`erdd:v2` 머릿말)

- **내보낸 산출물의 첫 줄 주석(`erdd:v2`)은 가져오기 계약의 일부다.** 지우면 왕복이 옛 동작으로
  돌아간다(조합된 이름이 통째로 부분이 되고 그룹이 사라진다). **새 내보내기 포맷을 추가하면 머릿말도
  함께 실어야 왕복이 닫힌다** — 직렬화·파싱·**빌드**는 `name-meta.ts` 하나가 갖고 있고 포맷마다
  갈리는 것은 주석 접두(`--` / `//`)뿐이다. ⚠️ **빌더를 포맷별로 복제하지 마라** — `ddl.ts`·`dbml.ts`
  가 실제로 복제하고 있었고, 그룹 수집이 붙으며 커져 `buildNameMeta` 한 자리로 합쳤다.
- **v2 는 최상위가 `t`(테이블)·`g`(그룹) 두 구획이다.** 테이블 항목은 `{p: 물리 부분, l: 논리 부분,
  g?: 그룹 이름}` 이고, 그룹 항목은 `{a?: 별칭, c?: 색, n?: 코멘트}` 다(**이름은 JSON 키가 곧 원문
  이름**이라 값에 중복해 싣지 않는다). **빈 값은 키를 생략한다** — 머릿말이 한 줄이라 길이가 곧 비용이다.
  - ⚠️ **직렬화는 이름을 원문 그대로 적고 조회 키만 대문자다.** 파싱이 `k.trim().toUpperCase()` 로
    다시 색인한다. 대문자로 **적어** 두면 lower_snake 프로젝트의 머릿말이 실제 이름과 달라 보이고,
    그룹은 그 키가 곧 만들어질 **그룹 이름**이라 `Sales_Domain` 이 `SALES_DOMAIN` 으로 뭉개진다.
    `ddl-import.test.ts` 의 「그룹 이름의 대소문자가 왕복에서 보존된다」가 양쪽 끝을 함께 잠근다.
- **v1 은 계속 읽는다. `ddl-import.test.ts` 에 `-- erdd:v1` 픽스처가 셋 있고 그것을 v2 로 「정리」하면
  `ddl-import` 의 v1 경로가 무테스트가 된다** — 「메타 키가 실제 이름과 안 맞으면 현행 동작으로
  떨어진다」·「복원된 이름이 기존 테이블과 부딪히면 건너뛴다」·「다른 그룹의 두 테이블이 같은 부분으로
  복원되면 뒤엣것이 빠진다」.
  - ⚠️ **셋 다 v1 픽스처이지만 v1 파싱을 끊었을 때 빨개지는 것은 그중 둘이다**(Task 1 실측, 최종
    게이트 리뷰가 재확인). 「메타 키가 실제 이름과 안 맞으면…」은 **머릿말이 안 먹히는 fallback** 을
    단언하므로(`expect(imported.tables[0]!.physicalName).toBe('TB_MBR_ORDER')`) 파싱을 끊어도 결과가
    같아 **구조상 그 치환으로는 빨개질 수 없다** — 픽스처 문제가 아니다. 그래도 v1 입력이 예외를
    안 낸다는 것은 지키므로 셋 다 그대로 둔다.
  - **파서 단위의 v1 잠금은 `name-meta.test.ts` 의 `parseNameMeta — v1 하위호환` 묶음이 따로 갖고
    있다**(둘 다 있어야 한다 — 파서만 잠그면 `ddl-import` 가 v1 을 어떻게 쓰는지가 안 잠긴다).
    실측: `name-meta.ts` 의 `return toV1(v1)` 을 `return null` 로 끊으면 core 스위트 전체에서
    **4개 파일 8건**이 빨개진다(`name-meta` 4 · `ddl-import` 2 · `ddl-parse` 1 · `dbml-parse` 1).
  - ⚠️ **마커 경계 검사(`erdd:v1` 뒤가 공백이거나 끝)는 옛 v1 파서보다 엄격해진 동작 변경이다.**
    옛 파서는 `-- erdd:v1{...}`(공백 없음)을 읽었고 새 파서는 안 읽는다. ERDD 가 낸 덤프는 늘 공백을
    넣으므로 실사용 영향은 없다. 그 검사가 없으면 `erdd:v11` 이 `erdd:v1` 로 읽힌다.
- ⚠️ **머릿말은 파싱 **전에** 원문에서 읽어야 한다.** 두 파서 모두 파싱 첫 단계에서 주석을
  걷어낸다(`splitStatements` · `stripComments`) — 그 뒤에 읽으면 언제나 없다.
- ⚠️ **파싱은 첫 비주석·비공백 줄에서 멈춘다.** 파일 전체를 훑지 않는다 — 중간에 섞인 마커를 줍지
  않고 스캔 비용이 상수다(실증: 그 `return null` 을 `continue` 로 바꾸면 「첫 문장 뒤의 마커는 줍지
  않는다」가 빨개진다).
- ⚠️ **실을 것이 없으면 줄 자체를 내지 않는다**(설계 D4). 판정은 「템플릿이 비었는가」가 **아니라**
  「**조합 결과가 부분과 다른가 또는 그룹에 속하는가**」다 — 템플릿이 `{물리명}` 이라 결과가 같은
  테이블도 걸러진다. ⚠️ **2026-08-19 에 기준이 넓어졌다** — 처음엔 앞엣것만 봤고 그래서 「템플릿을
  안 쓰는 프로젝트의 산출물이 한 글자도 안 바뀐다」였는데, 그룹은 템플릿과 무관하므로 그 보장을 그대로
  두면 **그룹만 쓰는 프로젝트에 기능이 아예 닿지 않는다.** 보장은 **「그룹도 템플릿도 안 쓰는
  프로젝트」**로 좁아졌다. 그 무변경을 `ddl.test.ts` 의 전체 문자열 `toBe` 비교가 함께 잠근다 —
  ⚠️ **그 픽스처는 그룹이 없어야 한다.** `buildSampleModel()` 은 두 테이블이 `g1` 소속이라 그대로
  두면 머릿말이 나가 빨개진다(그래서 그룹 없는 모델로 갈고 그룹 있는 짝을 새로 세웠다).
- ⚠️ **깨진 메타는 전부 `null` 이다. 예외를 던지지 않는다**(설계 D6). 깨진 JSON · 모르는
  버전(`erdd:v9`) · 형태가 다른 값 · 실제 이름과 안 맞는 키 — 전부 「머릿말이 없는 것」으로 떨어져
  옛 동작이 된다. 가져오기가 실패하면 안 된다. ⚠️ **`v2` 가 아는 버전이 되면서 「모르는 버전」
  픽스처를 `erdd:v9` 로 옮겼다** — 다음 버전을 올릴 때도 같은 자리를 옮겨야 한다.
- ⚠️ **`planDdlImport` 안에서 테이블 이름은 두 종류다. 어느 쪽인지 매번 정하라.**

  | 자리 | 쓰는 이름 | 왜 |
  |---|---|---|
  | `tableByUpper` · `usedIndexNames` · `colMapByTable` 의 **키** | **DDL 원문 이름** | 인덱스·UNIQUE·그룹이 원문 표기로 테이블을 찾는다 |
  | `DdlImportTable.physicalName` · `DdlImportRelationship.child/parentPhysicalName` · 그룹 소속 | **복원된 부분 이름** | 웹의 편집 적용부가 **물리명으로 테이블 id 를 찾는다**(`tableIdByName.get(...)!`) — 어긋나면 `undefined` 를 잡아 관계가 조용히 깨진다 |
  | 이름 충돌 판정(`existing` · 중복) | **(그룹 이름, 복원된 부분 이름)** | 실제로 만들어질 이름이 그것이다. 원문 이름으로 보면 `TB_MBR_ORD`→`ORD` 복원이 모델의 기존 `ORD` 와 부딪히는 것을 놓쳐 같은 물리명이 둘 생긴다. 그룹을 안 보면 반대로 **원본에서 공존하던 두 테이블이 잘못 겹친다**(아래) |
  | 그룹 소속 판정 | **머릿말 → DBML `TableGroup` 블록** | 8번 절의 그룹 수집과 **같은 우선순위(D7)** 를 써야 한다 |

  ⚠️ **`tableByUpper` 를 `tables.map((t) => [upper(t.physicalName), t])` 로 만들면 안 된다** — 복원이
  걸린 순간 키가 부분 이름으로 바뀌어 인덱스·관계·그룹 해소가 통째로 깨진다. 루프 안에서
  `upper(t.name)` 으로 넣어라.
- ⚠️ **「만들어질 이름이 겹친다」의 사유는 둘이고 경고 문구를 갈라야 한다.** 원문 이름까지 같으면
  진짜 중복 `CREATE TABLE` 이고, **원문 이름이 다르면 머릿말이 서로 다른 두 이름을 같은 부분으로
  되돌린 것**이다. ⚠️ **2026-08-19 이후 이 사유는 v1 머릿말에서만 난다** — v2 는 충돌 키가 그룹을
  보므로 그룹이 갈린 두 테이블이 더는 겹치지 않는다(원본에서 공존하던 것이 그대로 공존한다).
  후자에 「DDL에 같은 이름의 테이블이 두 번 있어」라고 적으면 **원문을 열어 본 사용자가 문구가
  틀렸다고 판단해 넘긴다** — 실제로는 테이블이 컬럼째 빠진 상황이다. 판정은 `seenRaw`(원문 이름을
  본 적 있는가)로 하고, 두 문구를 **각각 다른 테스트가 문자열까지 못 박는다**(`kind` 만 보면 두
  갈래가 뒤바뀌어도 초록이다 — 실제로 그랬다).
  - `target` 은 **DDL 원문 이름**이다. 사용자가 입력에서 찾을 수 있는 이름은 그것뿐이고(복원된
    부분 이름은 머릿말 JSON 밖에 안 나온다), `skippedTables`·형제 분기와도 기준이 같다.
  - ⚠️ **형제 분기(`existing.has`)도 같은 이유로 갈라야 한다 — 여기가 훨씬 흔하다.** 자기 덤프를
    같은 프로젝트로 되읽는 가장 흔한 워크플로가 이쪽을 탄다(전부 이미 있는 이름이라 전부 건너뛴다).
    판정은 `restored = upper(made) !== key`(머릿말이 이름을 되돌렸는가)다. ⚠️ **`madeKey` 와
    비교하지 마라** — 충돌 키에 그룹이 섞이면서 그 비교는 늘 참이 됐다(아래). 되돌렸으면 **원문 이름과
    부딪힌 이름이 다르므로** 둘을 함께 적어야 한다 — 원문 이름만 적으면 사용자가 사이드바에서 그
    이름을 못 찾아 **경고를 거짓으로 판단한다.** 2026-08-19 브라우저 스모크에서 실제로 관측됐다
    (`건너뜀 24개 (이미 있는 이름: TB_invitations, …)` — 모델에 있는 것은 `invitations`).
    ⚠️ **이 상황은 머릿말 사이클이 만들었다** — 그 전에는 `TB_invitations` 가 `invitations` 와
    안 부딪혀 새 테이블로 들어왔고 건너뜀 자체가 없었다.
- ⚠️ **이름 충돌 판정 키는 `(그룹 이름, 만들어질 부분 이름)` 이다**(설계 D6, 2026-08-19).
  그룹이 갈린 두 테이블은 원본에서 조합 이름이 달라 공존했으므로 부분 이름이 같아도 부딪히지 않는다.
  들어오는 쪽과 **모델 쪽(`groupId → name`)을 반드시 함께 넓혀라** — 한쪽만 넓히면 「DDL 안에서는
  공존하는데 모델과는 부딪힌다」가 된다.
  - ⚠️ **구분자는 NUL(`\u0000`)이다.** 그룹 이름은 사용자가 자유롭게 쓰는 문자열이라 `.` `_` 같은
    흔한 문자를 쓰면 `(A_B, C)` 와 `(A, B_C)` 가 같은 키가 된다. 잠금 테스트가 **두 실패 방식**
    (구분자를 `_` 로 교체 · 구분자 제거)을 각각 혼자 잡는다. 그리고 **`restored` 판정을 `madeKey` 로
    하지 마라** — 그것은 NUL 을 품는 충돌 키라 `upper(t.name)` 과는 원리적으로 늘 다르다. 뜻대로
    `upper(made) !== key` 여야 「이름을 되돌렸는가」가 된다(그러지 않으면 그룹만 실린 머릿말에서
    「머릿말이 X를 X로 되돌렸는데…」라는 거짓 문구가 나간다).
  - ⚠️ **「머릿말이 없으면 옛 동작 그대로다」는 더 이상 참이 아니다.** 충돌 키의 그룹은 머릿말이
    우선이고 **없으면 DBML `TableGroup` 블록**을 본다. 처음엔 「머릿말에서만」으로 적었다가 회귀를
    냈다 — 블록이 그룹을 말하면 그 테이블은 실제로 그 그룹에 들어가는데 키만 그것을 못 봐서, 모델의
    같은 그룹에 같은 물리명이 하나 더 생겼다.
- ⚠️ **그룹 속성 중 별칭만 경고한다**(설계 D3). 별칭은 `{그룹별칭}` 변수로 **물리명 조합에 들어가
  최종 이름을 바꾸므로** 조용히 갈리면 사용자가 보는 이름이 원본과 달라지는데 이유를 알 길이 없다.
  색·코멘트는 표시용이라 갈려도 이름이 안 바뀐다 — 전부 경고하면 시끄러워 진짜 신호가 묻힌다.
  - **문구가 두 갈래다.** 기존 그룹에 별칭이 있으면 「머릿말의 별칭 A 과 기존 그룹의 별칭 B 가 달라
    기존 값을 유지합니다」, 기존 별칭이 **빈 문자열**이면 「머릿말의 별칭 A 을 적용하지 않습니다 —
    기존 그룹에는 별칭이 없습니다」. `createGroup` 이 새 그룹을 전부 `alias: ''` 로 만들어 **뒤엣것이
    드문 자리가 아니다** — 한 문구로 뭉치면 「기존 그룹의 별칭  가 달라」처럼 공백이 둘 붙는다.
  - **`target` 은 모델에 있는 원문 이름이다.** 조회용 대문자 색인 키를 쓰면 `Sales_Domain` 이
    `SALES_DOMAIN` 으로 나가 사용자가 사이드바에서 그 이름을 못 찾는다.
- **복원되는 것은 테이블의 물리명·논리명 + 그룹 배정 + 그룹의 별칭·색·코멘트다.** 템플릿 자체·컬럼·
  **그룹 좌표**는 복원하지 않는다(설계 D2·D1, 6절 이월). ⚠️ **같은 이름의 그룹이 모델에 있으면 그것을
  쓰고 속성을 덮어쓰지 않는다** — 머릿말은 「그 그룹에 넣어라」까지만 말한다.

### 3.18 로컬 라우터는 서버 라우터의 계약을 따른다 (`packages/cli/src/local/router.ts`)

- **웹은 `AppRouter` 타입으로 클라이언트를 만든다.** 그래서 로컬 라우터의 입출력이 어긋나도
  **컴파일에 안 잡히고 런타임에 깨진다.** `router.test.ts` 의 `inferRouterInputs/Outputs<AppRouter>`
  대조와 **프로시저 이름 집합 대조**를 지우지 마라 — 이 안의 유일한 실질 리스크를 닫는 자리다.
  - **손으로 적은 목록 둘(입력 10개·출력 10개)만으로는 샜다** — 실제로 `project.update` 의 입력과
    `snapshot.delete` 의 양축을 빠뜨렸다. 그래서 로컬이 구현한 프로시저를 **전부 훑는** 세 타입
    (`InputGaps`·`OutputGaps`·`LocalOnly`)을 함께 둔다. 어긋난 것이 있으면 타입이 그 **이름**이 되어
    오류 메시지가 어느 프로시저인지 말해 준다(`toEqualTypeOf<never>()` 로 적으면 이름을 잃는다).
- **서버에 프로시저를 더할 때 로컬에도 더할 필요는 없다** — 로컬 UI 에서 그 화면이 숨겨져 있으면
  된다(로컬은 의도적으로 축소된 라우터다). **반대로 로컬 모드에 보이는 화면이 부르는 프로시저는
  반드시 로컬 라우터에도 있어야 한다.**
  - ⚠️ **숨기는 것은 「다이얼로그를 닫아 두는 것」이 아니라 「렌더하지 않는 것」이다.**
    `ResourcePanel` 은 `enabled` 가드 없이 마운트 즉시 `resource.library.listForProject` 를 부르고,
    `PendingPromotionsBadge`(`AppShell`)는 `promotion.pendingCount` 를 60초마다 폴링한다 — 조건부
    렌더가 아니면 로컬에 없는 이름을 불러 화면에 오류가 뜬다.
  - ⚠️ **`AppShell` 의 `isLocal` 은 필수 prop 이다.** `useIsLocal()` 은 `MeContext`(= `RequireAuth`
    안)를 요구하는데 `AppShell` 은 단독으로도 렌더되므로, 계산은 `routes.tsx` 의 `Protected` 가 하고
    prop 으로 내린다. **옵셔널로 두면 호출부가 빠뜨려도 타입 오류 없이 서버 동작(배지 폴링)으로
    조용히 열린다.**
- ⚠️ **서버 쪽 반환 타입이 좁아지면 계약이 깨진다.** `auth.me` 의 `mode` 를 core 의 `RunMode` 로
  **명시**하지 않으면 tRPC 추론이 리터럴 `'server'` 로 좁혀 로컬의 `'local'` 과 서로를 만족하지
  못한다. 서버가 로컬과 공유하는 값은 **core 의 타입으로 적어라**.

### 3.19 `detectDialect` 는 DDL 전용이다 — DBML 에 태우지 마라

- **`detectDialect`(`packages/core/src/ddl-parse.ts`)의 시그니처 목록에 `/\[[A-Za-z_]/`(mssql 대괄호
  식별자, 가중치 2)가 있다.** DBML 의 **속성 문법**(`[pk, increment, note: '…']`)이 그것을 **항상**
  때리므로, 다른 시그니처가 걸리지 않는 한 **어떤 DBML 이든 mssql 로 판정된다.** 2026-09-03 CLI
  스모크에서 mysql 프로젝트가 낸 DBML 을 되읽자 실제로 `dbml mssql` 이 나왔다.
- **DBML 의 방언은 `Project { database_type }` 이고 `dialectFromDatabaseType` 이 그것을 푼다.** 웹의
  `ddl-import-dialog.tsx` 는 처음부터 그렇게 갈라 쓰고 있었고, CLI 의 `import.ts`(`resolveDialect`)도
  같게 맞췄다. **같은 일을 웹과 CLI 가 다르게 하지 않는다**(3.18 과 같은 정신).
- **방언은 조용히 틀려도 타입이 나온다.** `fromDialectType` 의 매핑이 방언마다 갈리므로 잘못 고르면
  컬럼 타입이 경고 없이 달라진다. 그래서 CLI 는 **무엇을 왜 골랐는지**를 사람용 출력 첫 줄과
  `--json` 의 `dialectSource` 에 함께 싣는다.
- 잠금: `packages/cli/src/commands/import.test.ts` 의 「DBML 의 방언은 database_type 을 따르고,
  없으면 config 로 떨어진다 — mssql 로 새지 않는다」. `resolveDialect` 의 형식 분기를 지우면 빨개진다
  (실측).

## 4. 개발 환경

```bash
# DB (docker) — 이미 떠 있는 경우가 많다
docker ps --filter name=erdd-db      # erdd-db-1, postgres:17, :5432
# dev DB=erdd, test DB=erdd_test (둘 다 0009까지 마이그레이션)
# 관리자 계정: admin@erdd.local / Passw0rd!erdd
# ADMIN_EMAIL/ADMIN_PASSWORD를 export하고 서버를 띄우면 없을 때 자동 생성된다(ensureBootstrapAdmin)

# 서버 프로세스 자체는 .env를 읽지 않는다(dotenv를 쓰지 않는다) — 루트 dev 스크립트가 .env를
# 셸에 로드해 넘긴다. .env가 없으면 아무 말 없이 그대로 뜨는데, 그때는 DATABASE_URL이 없어
# ctx.db=null → 모든 tRPC가 412 → 화면에 "연결에 문제가 있습니다"
pnpm dev                                            # web :5173(127.0.0.1), server :3000
# 워크트리에서는 포트·DB를 트랙별로 바꾼다: 서버 PORT + web ERDD_SERVER_PORT(같은 값) + ERDD_WEB_PORT
# (할당표는 CLAUDE.md "워크트리 규칙". vite 프록시 타깃이 ERDD_SERVER_PORT로 파라미터화돼 있어,
#  안 주면 워크트리의 web이 조용히 최상위 서버 3000에 붙는다. DATABASE_URL은 그 워크트리의 .env로 준다)
PORT=3001 ERDD_SERVER_PORT=3001 ERDD_WEB_PORT=5174 pnpm dev   # 워크트리 A
# .env 의 키가 인라인으로 준 값을 이긴다(스크립트는 .env 를 로드할 뿐 우선순위를 따지지 않는다).
# 위 셋은 기본 .env 에 없으니 인라인이 그대로 먹는다 — .env 에 포트를 적으면 web 이 남의 서버로 프록시한다.

# 테스트
pnpm --filter @erdd/core exec vitest run
pnpm --filter @erdd/web exec vitest run
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm --filter @erdd/server exec vitest run
pnpm -r typecheck

# 마이그레이션 (스키마 변경 시) — 루트 스크립트가 dev 와 같은 관용구로 .env 를 셸에 로드한다
pnpm db:generate                                    # 스키마 → 새 마이그레이션 파일(.env 없어도 그냥 돈다)
pnpm db:migrate                                     # .env 의 DATABASE_URL(= dev DB)에 적용
pnpm db studio                                      # 임의 drizzle-kit 서브커맨드도 같은 .env 로딩으로 통과한다
# .env 가 아닌 DB(test DB·격리 DB)를 가리킬 때는 인라인 + 원시 호출을 쓴다 — pnpm db 계열은 .env 를
# 로드하고 그 값이 인라인을 이기므로, 인라인을 줘도 조용히 .env 의 dev DB로 간다.
DATABASE_URL='postgres://postgres:erdd@localhost:5432/erdd_test' pnpm -C apps/server exec drizzle-kit migrate
```

브라우저 스모크: 브라우저는 항상 **`127.0.0.1`로 접속**한다(`localhost`는 IPv6로 풀릴 수 있다).
**SPA 라우트는 `/p/<projectId>`(프로젝트 에디터)와 `/org/<orgId>`다** — `/projects/<id>`로 가면 "페이지를 찾을 수 없습니다"가 뜬다. 배선 확인은 `/trpc/auth.me?batch=1&input=%7B%7D`로 프로브한다(**401 = DB 정상 + 로그아웃 상태, 412 = DB 미배선**). 서버 `/`와 맨 `/trpc`는 설계상 404다.

스모크에서 매번 물리는 것들:
- **vite의 IPv6 `[::1]` 바인딩은 설정으로 닫혔다.** `apps/web/vite.config.ts`의 `server.host`가 `127.0.0.1`로 고정돼 있다 — 예전에는 `[::1]`에만 붙어 Chrome이 접속을 못 했고, curl은 `localhost`를 `::1`로 풀어 200이라 서버 문제로 오인하기 쉬웠다. 바꿔야 하면 CLI 인자 말고 **환경 변수**를 쓴다: `ERDD_WEB_HOST`(바인딩 주소), `ERDD_WEB_PORT`(포트, `strictPort`라 물려 있으면 옆 포트로 도망가지 않고 죽는다). **`pnpm ... dev -- --host 127.0.0.1`은 여전히 인자가 전달되지 않는다** — 그래서 예전에는 `./node_modules/.bin/vite`를 직접 실행해야 했다.
- **좀비 dev 프로세스가 구 코드를 조용히 서빙한다.** `tsx watch` 부모는 세션을 넘어 살아남고, 반대로 `pkill -f "tsx src/main.ts"` / `pkill -f vite`는 **부모만** 죽여 `node` 자식이 포트를 쥔 채 남는다. 어느 쪽이든 새로 띄운 서버가 `EADDRINUSE`로 죽고(vite는 `--strictPort`) 몇 시간 전 코드와 계속 대화하게 된다 — 증상은 API의 "No procedure found on path …"와 최신 변경이 빠진 UI다(실시간 스모크에서 이틀 전 코드를 물고 있었다). **띄우기 전에 항상 `lsof -nP -iTCP:3000 -iTCP:5173 -sTCP:LISTEN`으로 확인해 나온 PID를 `kill -9`** 하고, 새 서버가 최신인지 `/trpc/<이번에 추가한 프로시저>`가 404가 아니라 401을 주는 것으로 확증한다. vite는 `rm -rf apps/web/node_modules/.vite` 후 캐시버스팅 쿼리를 붙여 로드한다. 스모크 중에는 watch 없이 `./node_modules/.bin/tsx src/main.ts`로 띄우는 편이 안정적이다.
- **테스트가 DB를 TRUNCATE한다**(`testing/db.ts`의 `resetDb`). 서버 스위트뿐 아니라 **루트 `pnpm verify`도 dev DB `erdd`를 비운다** — `.env`의 `DATABASE_URL`이 dev DB를 가리키기 때문이다. 테스트를 돌린 뒤 스모크하려면 계정·조직·프로젝트를 다시 시드해야 한다. 부트스트랩 관리자는 `ADMIN_EMAIL`/`ADMIN_PASSWORD`를 export하고 서버를 띄우면 `ensureBootstrapAdmin`이 자동 생성하고, 나머지는 node 스크립트에서 `fetch`로 tRPC를 때리는 게 빠르다: `auth.login` → `org.create` → `admin.users.create` → `org.members.add`(`memberId`를 반환한다) → `project.create`(`dialects` 필요) → Viewer용 `project.members.add`. **호출 사이에 `getSetCookie()`의 `erdd_session` 쿠키를 이어서 넘겨야 한다.**
- **React 제어 인풋에 브라우저 도구로 타이핑하지 마라.** `computer:type`은 느리고 한글에서 불안정하다. `javascript_tool`로 네이티브 setter를 쓴다 — `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(ta, text)` 후 `ta.dispatchEvent(new Event('input',{bubbles:true}))`. 미리보기가 갱신되면 React가 받은 것이다. 다이얼로그를 먼저 열어 엘리먼트 존재를 확인한다 — `navigate` 후 stale 해진 엘리먼트 참조는 클릭이 조용히 no-op이 된다.
- `psql`이 PATH에 없다. DB를 직접 봐야 하면 `apps/server`에서 `node` 스크립트로 `pg`를 import한다(pnpm 엄격 모드라 리포 루트에서는 `pg`·`ws`가 해석되지 않는다).

**다중 사용자 스모크(실시간 등)**: 브라우저 2개를 띄우는 것보다 **연결된 Chrome 1개(A) + 헤드리스 WS 클라이언트(B)** 조합이 낫다. Claude 확장은 프로필 하나에만 있어서 새 프로필 창은 조작할 수 없고, 무엇보다 **경합 조건은 손으로 재현이 안 된다.** 실시간 사이클의 Critical 회귀 검증은 `SELECT ... FOR UPDATE`로 프로젝트 행 락을 12초 잡아 "B 먼저 커밋 / A는 대기 중" 순서를 강제해서 결정적으로 재현했다. 헤드리스 B는 `ws`를 pnpm 스토어 경로(`node_modules/.pnpm/ws@*/node_modules/ws`)에서 직접 import하면 된다.

### 4.1 릴리스 — 사내 레지스트리에 CLI 패키지를 게시한다

게시 대상은 **사내 GitLab(`gitlab.develma.com`) 패키지 레지스트리의 프로젝트 엔드포인트**다. 공개
npm 에는 올리지 않는다. 배포 형태는 **원본 TypeScript 그대로**이고(빌드 산출물이 아니다 — 소비처에
`tsx` 가 필요하다), `apps/web` 의 빌드 산출물을 `packages/cli/web/` 로 복사해 **tarball 에 동봉**한다.
그래야 설치본에서도 `erdd serve` 가 화면을 낸다. **문서도 함께 동봉된다** — 패키지 루트의
`README.md` 와 `docs/manual/*.md` 네 편이다(아래 ⚠️). 두 패키지 모두 `engines.node: ">=22"` 를 선언한다.

**절차.**

```bash
# 1) 버전을 올린다
#    packages/cli/package.json  의 "version"  — 항상
#    packages/core/package.json 의 "version"  — packages/core 를 고쳤으면 반드시(아래 가드가 죽인다)

# 2) 커밋하고 태그를 push 한다. 파이프라인은 이 태그에서만 돈다
git tag cli-v0.1.0 && git push origin cli-v0.1.0
```

`.gitlab-ci.yml` 의 `workflow.rules` 가 `^cli-v\d+\.\d+\.\d+(-…)?$` 태그에만 파이프라인을 만든다 —
브랜치 push·MR 로는 아무것도 돌지 않는다(이 저장소의 유일한 CI 다). `verify` → `publish` 두 단계이고,
`verify` 가 `pnpm install --frozen-lockfile` · `pnpm -r typecheck` · **core·cli·web 테스트** ·
`apps/web build` · `pnpm -C packages/cli run bundle:web` 을 돌려 `packages/cli/web/` 를 artifact 로
넘긴다. `publish` 는 그것을 그대로 받아 게시한다 — **재빌드하지 않는다**(검증한 것과 게시하는 것이
같아야 한다).

⚠️ **`pnpm -C apps/web test` 는 빼지 마라.** 그 빌드 산출물 101개가 그대로 tarball 의 `web/` 이 되어
소비처에서 서빙된다 — **게시물의 대부분이 web 이다.** 그 줄이 없으면 어떤 테스트도 거치지 않은 것이
게시되는 경로가 열린다. `build` 앞에 둔 것도 의도다(깨졌으면 빌드에 시간을 쓰기 전에 죽는다).

**게시를 막는 가드 5개.**

| 가드 | 어디서 | 무엇을 막나 |
|---|---|---|
| 태그 버전 == `packages/cli/package.json` 의 `version` | CI publish | 태그만 올리고 매니페스트를 잊는 것. 그대로 나가면 레지스트리에 태그와 다른 버전이 올라간다 |
| 패키지 이름이 `@erdd/` 스코프 | CI publish | `.npmrc` 는 `@erdd:` 에만 레지스트리·토큰을 매단다. 스코프를 벗어나면 그 설정이 통째로 안 먹어 **공개 npm 으로 나갈 수 있다** |
| `packages/cli/web/index.html` 존재 | CI publish | 번들 없는 게시. 설치한 쪽에서 서버는 뜨는데 `/p/<id>` 만 404 를 내는, 원인을 짚기 어려운 상태가 된다 |
| **core 버전 누락** | CI publish | **직전 `cli-v*` 태그와 core `version` 이 같은데** `packages/core` 가 바뀌었으면 **잡이 죽는다.** 「새 cli + 옛 core」가 조용히 나가는 것을 막는다. version 비교가 조건에 들어가는 것이 핵심이다(아래 ⚠️) |
| **`prepack`**(`packages/cli/scripts/check-web-bundle.mjs` → `bundle-docs.mjs`) | pack·publish 어디서나 | 웹 번들 없이 팩하는 것. CI 가드와 겹치지만 **CI 밖의 손 게시까지** 덮는다. CI 가 `--ignore-scripts` 를 쓰지 않는 것이 이 훅을 거기서도 돌게 하려는 것이다. **가드를 지난 뒤 이어서 매뉴얼을 복사한다**(아래 ⚠️) — 매뉴얼 원본이 하나라도 없으면 여기서 종료 코드 `1` 이다 |

⚠️ **core 를 고쳤으면 `packages/core/package.json` 의 `version` 을 반드시 올려라.** publish 잡은
`npm view "@erdd/core@<버전>"` 으로 「이미 있으면 건너뛴다」를 하는데(cli 만 고친 릴리스에서 409 로
죽지 않게 하려는 의도된 동작이다), **건너뛰기 직전에 직전 `cli-v*` 태그와 이번 태그를 비교한다.**
조건은 **둘이 모두** 참일 때다.

```bash
[ "$PREV_CORE_VERSION" = "$CORE_VERSION" ] && ! git diff --quiet "$PREV_TAG" "$CI_COMMIT_TAG" -- packages/core
```

즉 **직전 태그의 core `version` 이 지금과 같은데 `packages/core` 파일이 바뀐 경우**만 잡는다.
그때는 이렇게 죽는다.

```
packages/core 가 cli-v0.1.1 이후 바뀌었는데 version(0.1.0)이 그대로입니다.
packages/core/package.json 의 version 을 올리고 태그를 다시 미세요.
```

⚠️ **version 비교가 조건에 들어가는 이유 — 없으면 릴리스가 영구히 막힌다.** 「파일이 바뀌었나」만
보면 core 를 고치고 **version 도 올바로 올린** 릴리스에서 오탐한다. 실제로 걸리는 상황은
**publish 잡 재시도**다 — 첫 실행이 `@erdd/core@0.2.0` 게시까지 성공하고 그다음 cli 게시에서
죽으면(레지스트리 순간 오류·네트워크), 재시도에서는 core 가 이미 레지스트리에 있으므로 건너뛰기
분기로 들어가고, 거기서 파일 변경만 보는 가드가 발동해 **그 태그로는 다시는 성공할 수 없게 된다.**
재리뷰가 격리 저장소로 재현했고 그래서 조건을 좁혔다.

이 판정에는 **알고 쓰는 실패 모드**가 있다.

| 상황 | 어느 쪽으로 기우나 |
|---|---|
| 직전 태그를 못 찾는다(첫 태그·얕은 클론) | **통과.** 첫 태그에서는 core 도 미게시라 애초에 게시 분기로 가서 이 검사에 닿지 않고, 얕은 클론은 publish 잡의 `GIT_DEPTH: "0"` 으로 없앴다 |
| 직전 태그의 `packages/core/package.json` 을 못 읽는다(그 시점에 파일이 없거나 JSON 이 깨졌다) | **통과.** `PREV_CORE_VERSION` 이 빈 문자열이 되어 version 비교가 어긋난다 — 못 읽는 것은 「버전을 안 올렸다」의 증거가 전혀 아니라, 거짓 실패로 릴리스를 막는 쪽이 더 나쁘다고 보고 고른 방향이다 |
| `git diff` 자체가 실패한다(객체 없음 등) | **실패.** 다만 version 비교를 먼저 통과해야 하므로 **버전이 그대로일 때만** 그렇다 |

건너뛸 때의 로그는 세 갈래로 갈라진다 — 직전 태그를 못 찾았을 때, **버전이 올랐고 그 버전이 이미
게시돼 있을 때**(위의 재시도 경로다), `packages/core` 변경이 없을 때.

⚠️ **손 게시(CI 밖의 `pnpm pack`·`pnpm publish`)에는 선행 조건이 있다.** 번들이 없으면 `prepack` 이
종료 코드 `1` 로 막는다. 먼저 이 둘을 돌려라.

```bash
pnpm -C apps/web build && pnpm -C packages/cli run bundle:web
```

⚠️ **`apps/server` 테스트는 이 파이프라인이 돌리지 않는다** — `DATABASE_URL`(실제 PostgreSQL)이
필요한데 CI 에 DB 서비스가 없다. 게시 대상도 아니다. 서버까지 검증하려면 `services:` 로 postgres 를
띄우고 마이그레이션을 적용해야 한다.

⚠️ **파이프라인은 아직 한 번도 돌지 않았다(2026-08-29).** 첫 태그에서 깨질 수 있는 지점.

- `corepack` 활성화 — 사내 러너의 네트워크 정책을 탄다. 막히면 `COREPACK_NPM_REGISTRY` 로 사내 미러를
  가리킨다(`npm i -g pnpm@10.4.1` 은 **같은 네트워크를 타므로 대안이 아니다**). 프롬프트 때문에 막히는
  것은 아님이 확인됐다.
- verify → publish 의 실제 artifact 전달, `CI_JOB_TOKEN` 으로의 실제 게시.
- `npm view` 가 「없음」을 404 로 돌려주는지 — 401/403 이면 「없음」으로 오판해 게시를 시도하고 409 로
  죽는다.
- **`GIT_DEPTH: "0"` 이 러너에서 실제로 전체 히스토리를 받는지** — 로컬 `git clone` 으로 대신 확인했다.
- **`git describe --match 'cli-v*'` 가 러너의 detached HEAD 태그 체크아웃에서 같게 도는지.**
- **verify 의 `pnpm -C apps/web test` 가 러너에서 jsdom·타임아웃 없이 끝나는지**(로컬 14.7초).

**소비처 설치**(사용자 매뉴얼과 같은 내용) — 머신마다 한 번
`pnpm config set "//gitlab.develma.com/:_authToken" "<토큰>"`, 프로젝트 `.npmrc` 에
`@erdd:registry=https://gitlab.develma.com/api/v4/projects/45/packages/npm/`(45 = ERDD 의 Project ID), 그다음
`pnpm add -D @erdd/cli tsx`. **토큰은 프로젝트 `.npmrc` 에 적지 않는다.**
⚠️ **`tsx` 를 함께 적는 것을 빼지 마라 — 패키지 관리자가 무엇이든 소비처가 직접 선언해야 한다.**
`@erdd/cli` 는 `tsx` 를 끌어오지 않는다. **`dependencies` 에 넣어 대신 해결하려는 시도는 하지 마라** —
한 번 해 봤고 **pnpm 소비처를 회귀시켜 되돌렸다**(선언이 `npx` 에게 「이미 설치됨」으로 오판을 시키는데
pnpm 은 그 bin 을 어떤 `.bin` 에도 링크하지 않아, 되던 것이 `sh: tsx: command not found`(127)가 된다).
근본 해결은 셰방을 바꾸는 것이다 → [4.1b](#41b-게시-관련-이월-항목-일부러-고치지-않은-것).

⚠️ **`packages/cli/web/` 는 커밋하지 않는다**(gitignore). 로컬에서 저장소 배치로 `erdd serve` 를 쓰던
사람은 지금까지처럼 `pnpm -C apps/web build` 만 하면 된다. **후보 순서는 저장소 우선이다** —
`webDistCandidates` 가 `apps/web/dist` 를 먼저 보고 없을 때만 `<패키지 루트>/web` 으로 떨어진다.
게시 준비로 `bundle:web` 을 돌려 복사본이 남아 있어도 **로컬 `serve` 는 계속 최신 빌드를 본다**
(`packages/cli/web/` 은 gitignore 라 `git clean -fd` 로도 안 지워져서, 반대 순서였을 때 그 잔재가 최신
빌드를 가리는 함정이 실제로 재현됐다 — 뒤집어서 없앴다). 설치본에서 저장소 후보가 잡히는 일은 없다:
`<소비처>/node_modules/apps/web/dist` 로 풀려 `node_modules` 안이라 구조적으로 성립하지 않는다.

⚠️ **패키지에 README 와 매뉴얼 4개가 동봉되고, 그 복사는 `prepack` 이 한다.** `packages/cli/README.md`
는 저장소에 커밋돼 있고 npm 이 `files` 와 무관하게 자동 동봉한다(GitLab 패키지 레지스트리 페이지도
그것을 렌더한다). 매뉴얼은 다르다 — **npm 은 패키지 디렉터리 밖의 파일을 팩하지 않아서**
`files` 에 `../../docs/manual/*.md` 를 적어도 들어가지 않는다. 그래서
`packages/cli/scripts/bundle-docs.mjs` 가 `docs/manual/` 의 **네 편 전부**
(`local-guide` · `cli-guide` · `user-guide` · `install`)를 `packages/cli/docs/` 로 복사하고,
`prepack` 이 `check-web-bundle.mjs` 다음에 그것을 돌린다.

- **`packages/cli/docs/` 는 커밋하지 않는다**(gitignore, `packages/cli/web/` 바로 아래에 있다).
  빌드 산출물이다 — 거기 있는 파일을 고쳐도 다음 팩에서 덮어써지므로 **원본인 `docs/manual/` 을 고친다.**
- **넷을 다 넣는 것이 요점이다.** 문서끼리 상대 링크로 엮여 있어(`local-guide.md` 하나가 나머지 셋을
  30번 넘게 가리킨다) 일부만 넣으면 설치본에서 깨진 링크가 된다. 같은 디렉터리에 나란히 두면 원본
  링크가 그대로 살아서 **링크를 고쳐 쓸 필요가 없다** — `bundle-docs.mjs` 는 내용을 손대지 않고 복사만 한다.
- **`web` 과 달리 CI artifact 로 넘기지 않는다.** 빌드가 필요 없는 단순 복사라 `prepack` 에서 하면
  CI 든 손으로 `pnpm pack` 하든 항상 최신 매뉴얼이 들어간다. 그래서 `.gitlab-ci.yml` 에는 문서 관련
  단계가 없다 — **넣지 마라.** prepack 이 어느 경로에서도 도는 것이 이 설계의 요점이다.
- 동봉 문서를 가리키는 상대 링크(`./docs/local-guide.md`)가 `README.md` 에 있다. **저장소에서는 그
  경로가 비어 있는 것이 정상이다**(팩할 때 생긴다).
- ⚠️ **살아나는 것은 「매뉴얼 넷 사이」의 링크다. `docs/manual/` 밖을 가리키는 링크는 동봉본에서
  열리지 않는다.** 팩된 tarball 을 검사하면 파일을 가리키는 상대 링크 71건 중 69건이 살고 2건이
  깨지는데, 둘 다 `install.md` 가 manual 디렉터리 밖을 가리키는 것이다
  (`../superpowers/HANDOFF.md` — 이 문서 · `../18-account.md`). **알고 그대로 두었다** — 기여자용·
  저장소 내부 문서라 패키지를 설치한 사람이 볼 일이 없고, 절대 URL 로 바꾸면 저장소 안에서 매일
  쓰는 클릭 이동을 잃는 데다 사내 GitLab 주소가 바뀌면 그때 깨진다. **매뉴얼 넷에 manual 밖을
  가리키는 링크를 새로 넣으면 동봉본에서 같은 방식으로 깨진다** — 넣을 거면 알고 넣어라.

⚠️ **`publishConfig.registry` 를 매니페스트에 두지 않는다.** 그룹 엔드포인트는 읽기 전용이라 게시가
거절된다(형제 저장소가 그 사고를 겪었다). 레지스트리는 잡 안에서 만드는 `.npmrc` 로만 지정한다.

#### 4.1b 게시 관련 이월 항목 (일부러 고치지 않은 것)

리뷰·수정 라운드에서 **알고 남긴 것들**이다. 다시 발견하느라 시간을 쓰지 마라.

| # | 내용 |
|---|---|
| **소비처의 `tsx` 직접 설치**(셰방 런처) | `bin` 셰방을 `#!/usr/bin/env node` + 얇은 `.mjs` 런처로 바꾸고 런타임에서 tsx 를 로드하면 소비처가 `tsx` 를 직접 넣을 필요가 없어진다. **방법은 실증됐다** — `createRequire(realpathSync(런처 경로))` 로 pnpm 심볼릭을 실경로로 풀면 `tsx` 가 해석된다. ⚠️ **이것이 유일한 근본 해결책이다** — `dependencies` 선언만으로는 **pnpm 에서 오히려 회귀한다**(실측해서 되돌렸다). 셰방을 바꿔야 비로소 값을 한다. 비용은 진입점 교체와 두 배치(pnpm 격리·npm 평면)·전역 설치·`npx @erdd/cli` 재검증, 그리고 `tsx/esm/api` 라는 프로그램적 API 에 묶이는 것. **회귀 위험 때문에 별도 라운드로 미뤘다.** |
| **루트 `.npmrc` 가 없다** | 저장소에 `@erdd:registry` 가 없어 로컬 `pnpm publish` 는 **기본값인 공개 npm 을 향한다**(dry-run 로그에 그대로 찍힌다). `@erdd` 스코프 소유가 아니라 실제로 나가지는 않지만, **GitLab 프로젝트 ID 가 정해지면 루트 `.npmrc` 에 넣기로 했다.** |
| **`npm view` 의 401/403** | core 게시 판정이 401/403·네트워크 오류를 「없음」으로 읽어 게시를 시도한다. 그때는 409 로 시끄럽게 죽으므로 조용히 잘못되지는 않는다. 로그를 보고 GitLab Packages API 조회로 바꾸는 편이 낫다. |
| **게시본의 죽은 항목** | tarball 의 `package.json` 에 `scripts.bundle:web`·`scripts.bundle:docs` 가 남는데 `scripts/` 는 동봉되지 않는다. `devDependencies` 의 `@erdd/server: ^0.0.0` 도 어느 레지스트리에도 없는 버전이다. 둘 다 소비처에 실질 피해는 없다(`prepack` 은 팩할 때 떨어져 나가 남지 않는다). |
| **`image: node:22` 가 떠 있는 태그** | 재현 가능한 파이프라인을 원하면 digest 나 `node:22.x.y` 로 고정한다. |
| **태그 정규식과 빌드 메타데이터** | `cli-v0.1.0+build.1` 형태는 잡히지 않는다. 의도라면 그대로 둬도 된다. |
| **`erdd --version` 이 없다** | 게시되는 CLI 인데 버전을 물을 방법이 없다(`--version` 은 `알 수 없는 명령` 이다). |
| **Linux 에서 `serve` 의 파일 감시가 조용히 죽는다** | `fs.watch(dir, { recursive: true })` 는 Linux 에서 퍼미션 `0o000` 인 디렉터리에도 **던지지 않고 `'error'` 이벤트도 내지 않는다** — 같은 디렉터리에 **비재귀** watch 는 EACCES 로 던지고 `readdirSync` 도 EACCES 다(재귀만 다르다). `watchProject` 는 항상 재귀부터 걸므로 catch 분기에 닿지 못해 **경고조차 남지 않고**, 권한을 되돌려도 그 감시는 되살아나지 않는다. 즉 Linux 에서 `erdd serve` 의 자동 새로고침이 죽어도 사용자는 단서를 받지 못한다(새로고침하면 보이므로 치명적이지는 않다). `node:22` 컨테이너 최소 재현으로 확인했다. 이 때문에 `packages/cli/src/local/watch.test.ts` 의 「감시 등록이 그 밖의 이유로 실패해도 던지지 않는다」는 **macOS 에서만 검증력이 있어** `skipIf` 에 플랫폼을 함께 뒀다(CI 를 비-root 로 돌리자 드러났다 — root 일 때는 그 `skipIf` 에 걸려 보이지 않았다). **제품 코드(`watch.ts`)는 일부러 고치지 않았다** — 감지하려면 등록 뒤 접근 가능 여부를 따로 확인해야 해서 CI 수정의 범위를 넘는다. |

---

## 5. 작업 방식 (이 프로젝트에서 굳어진 흐름)

sub-project 하나마다:

1. **brainstorming 스킬** — 기획 문서(`docs/*.md`) 읽고 설계 결정을 사용자와 확정(특히 load-bearing 결정 1~2개는 반드시 질문)
2. **spec 작성** → `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` 커밋
3. **writing-plans 스킬** → `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` 커밋 (태스크별 완결 코드·테스트·커밋 명령 포함).
   계획서는 그 사이클을 도는 동안의 작업 문서다. **사이클이 끝나 main 에 병합되면 지운다** — 결정의 근거는
   `specs/` 가, 결과는 코드와 `git log` 가 들고 있어 계획서만 남으면 순수 부채다
   - ⚠️ **계획에 쓴 테스트 기대값은 계획의 가장 약한 고리다.** diff sub-project에서만 3건이 틀렸다: 설계가 정한 라벨 방향과 반대로 쓴 단언, 라이브러리 실제 동작(exceljs가 왕복 후 `autoFilter`를 범위 문자열로 역직렬화)과 어긋난 단언, 설계의 테스트 목록에서 3건 누락. **계획을 커밋하기 전에 (a) 설계 문서의 규칙·테스트 목록과 기계적으로 대조하고 (b) 픽스처의 실제 값을 열어 확인하라**(픽스처 값 오류도 1건 있었다).
   - **N:M 사이클에서 이 대조가 결함 4건을 착수 전에 잡았다** — 그중 하나는 **설계 자체의 결함**이었다(픽스처 `fullModel()`의 `r2`가 `identifying:false`인데 FK `c5`가 자식의 유일 PK라, 설계가 정한 "삭제 전 PK 개수" 판정으로는 부분 상태가 통과한다). 나머지 셋은 기대값 2건(`buildSampleModel`은 `words`·`terms`가 비어 있어 물리명이 `TABLE_n` fallback으로 떨어진다)과 타입 필드 1건(`Term`에 `abbreviation`·`comment`가 없다 — `z.strictObject`라 그대로 뒀으면 타입 에러). **픽스처를 열지 않았으면 넷 다 구현 중에 터졌을 것이다.**
   - 구현자에게는 "브리프 기대값이 실제와 어긋나면 이전 태스크 산출물을 고치지 말고 단언만 정정한 뒤 근거를 보고하라"고 명시하면 이 결함이 조기에 잡힌다.
4. 브랜치 생성(`feat/<topic>`), **subagent-driven-development**로 태스크별 구현 → 태스크별 리뷰 → 필요 시 수정 → 재리뷰
   - ⚠️ **워크트리에서 시작하는 작업이므로 워커는 Orca 터미널로 띄운다.** Orca 환경이면 구현자·리뷰어를 Agent 도구가 아니라 Orca 터미널 워커로 띄우는 것이 규칙이다 — **병렬 여부는 따지지 않는다**(`CLAUDE.md` "워크트리 작업은 Orca 세션으로 한다 (병렬 여부 무관)"). SDD의 루프(구현 → 리뷰 → 수정 → 재리뷰)는 그대로 두고 워커를 띄우는 수단만 바꾸는 것이다.
   - ⚠️ **워커 하나를 띄우는 단계는 5개다 — "제출 확인"을 빼먹지 마라.** ① `terminal create` → ② `terminal wait --for tui-idle` → ③ 그 핸들로 브리프 주입(`worker-start --terminal <handle>`) → ④ **`terminal read` 로 제출 확인**(입력창에 브리프가 텍스트로 남아 있으면 `terminal send --text "" --enter` 후 다시 read) → ⑤ `check --wait`. 주입 API의 성공 응답은 **전송까지만** 보증하고 제출은 보증하지 않으며, 미제출은 `check --wait` 가 15분 `timedOut` 을 낼 때까지 드러나지 않는다. **④ 없이 ⑤로 넘어가지 않는다** — 태스크마다 워커를 새로 띄우는 SDD에서는 이 누락이 사이클당 여러 번 발생할 수 있다(명령·근거는 `CLAUDE.md` 같은 절).
     - **실측(CLI push 멱등성 사이클): 긴 한국어 멀티라인 브리프는 ①②를 분리하지 않으면 사실상 항상 미제출이다.** `worker-start` 를 `--terminal` 없이 불러 터미널 생성과 주입을 한 번에 시킨 워커는 **4개 중 4개가 미제출**이었고, 터미널을 먼저 만들어 `tui-idle` 까지 기다린 뒤 주입한 워커는 **4개 중 4개가 자동 제출**됐다. `CLAUDE.md` 는 "타이밍에 달려 있어 될 때도 있고 안 될 때도 있다"고 적었지만, 브리프가 길면 확률 문제가 아니다.
     - ⚠️ **셸 변수는 `orca` 호출 사이에 살아남지 않는다**(작업 디렉터리는 유지된다). 워크트리 id 같은 긴 값을 변수에 담아 다음 호출에서 쓰면 **빈 문자열이 들어가 `worker-start` 가 조용히 실패한다**(응답의 `stage` 가 `null` 로 온다 — 오류가 아니라 빈 성공처럼 보인다). 파일에 적어 두고 `$(cat …)` 로 읽어라.
     - ⚠️ **브리프를 heredoc 으로 쓸 때 delimiter 에 따옴표를 붙여라 — `<<'SPEC'`.** 따옴표가 없는
       `<<SPEC` 은 본문을 셸이 해석한다. `$변수` 가 비어서 사라지는 것은 물론이고, **`!` 가 히스토리
       확장으로 먹혀** 브리프 안의 코드 조각이 통째로 사라진다. **오류가 나지 않고 조용히 짧아진다.**
       (초대·재설정 링크 사이클 실측: 최종 리뷰 수정 브리프의 M-2 항목에 넣은 코드가 전부 날아가,
       워커가 "무엇이 도달 불가인지"가 빠진 지시를 받았다.) 경로도 변수로 만들지 말고 하드코딩하고,
       **보낸 뒤 그 파일을 열어 온전한지 확인한다** — 브리프는 워커가 보는 유일한 사양이라 여기서
       빠진 것은 워커가 물어볼 수도 없다.
     - 🔥 **heredoc 만의 문제가 아니다 — 워커에게 보내는 모든 문자열이 같다.** 2026-08-20 병렬
       사이클에서 `task-create --spec "…"` 의 **백틱이 명령 치환으로 실행**돼 파일 경로 셋이 빈칸이
       된 채 워커에게 갔다. 하필 사라진 것이 **「이 파일은 건드리지 마라」의 파일 이름 둘**이라,
       그대로 뒀으면 다른 트랙과 같은 파일을 고쳐 병합 충돌이 났을 것이다. zsh 는 **큰따옴표 안에서도**
       백틱을 실행한다. `--spec`·`--body`·`--text` 전부 해당한다.
       - **쓰는 법:** 본문을 파이썬 등으로 **파일에 먼저 쓰고** `"$(cat /tmp/brief.txt)"` 로 넘겨라.
         셸이 본문을 한 번도 해석하지 않는다.
       - **검증(생략 금지):** 보낸 뒤 **`orca orchestration task-list --json` 으로 실제로 간 문장을
         되읽어** 핵심 문자열이 살아 있는지 grep 해라. 브리프 파일을 확인하는 것과 같은 이유이고,
         `--spec` 은 파일이 아니라 눈에 안 보이므로 이 확인이 더 중요하다.
     - ⚠️ **`${VAR:+--flag "$VAR"}` 같은 조건부 확장은 두 인자가 아니라 한 인자로 붙는다.**
       같은 세션에서 `check ${D:+--ack "$D"} --wait` 가 `Unknown flag --ack delivery_…` 로 즉시
       죽었다. 분기해서 명령 두 줄로 쓰는 편이 안전하다.
5. 전체 스위트 체크포인트 → 최종 whole-branch 리뷰 → 수정 → **스모크**(실 앱+실 DB) → main 머지, 브랜치 삭제
   - **스모크 주체:** CLI처럼 터미널로 끝나는 것은 **워커에게 시킨다**(격리 포트·격리 DB를 브리프에 준다). 브라우저 스모크는 컨트롤러가 해 왔다 — Claude 확장이 붙은 Chrome 프로필이 하나뿐이라 워커가 조작할 수 없다는 이유였다. **2026-08-09에 그 전제가 깨졌다: Playwright MCP(`mcp__plugin_playwright_playwright__*`)는 독립 브라우저를 띄우므로 프로필 제약이 없고 워커도 쓸 수 있다.** 다음 사이클에서 워커에게 넘겨 보고 되면 이 항목을 정리해라.
     - ⚠️ **같은 사이클에서 claude-in-chrome 확장이 중간에 먹통이 됐다** — 클릭·타이핑이 페이지에 닿지 않고(입력란이 계속 빈 채였다) 스크린샷은 `Cannot access a chrome-extension:// URL of different extension`을 냈다. 로그인 한 번은 됐다가 그 뒤로 안 됐으니 **되던 것이 계속 된다는 보장이 없다.** `read_page`로 입력란 값이 실제로 들어갔는지 확인하고, 두세 번 실패하면 붙들지 말고 Playwright로 갈아타라.
     - Playwright MCP는 `.playwright-mcp/`를 **현재 작업 디렉터리에 만든다** — 저장소 안에서 쓰면 스냅샷·콘솔 로그가 쌓인다. 스모크가 끝나면 지워라(`CLAUDE.md`: 임시 파일을 저장소에 흘리지 않는다).
   - ⚠️ **브라우저 스모크는 "확인 절차"가 아니라 결함을 잡는 게이트다.** 초대·재설정 링크 사이클에서 태스크별 리뷰 5라운드와 최종 whole-branch 리뷰를 **모두 통과한 뒤** 스모크가 Important급 1건을 잡았다 — 소비된 초대 링크를 다시 열면 "관리자에게 문의해 **새 링크**를 받으세요"라고 안내하는데, 관리자는 그 이메일에 새 초대를 만들 수 없다(409). 최종 리뷰가 잡은 같은 결함군(I-2: `accept`의 409)의 **더 흔한 형제**였는데, 리뷰가 코드에서 출발해 그 경로를 밟지 않았다. **가입을 마친 사용자가 링크를 다시 여는 것은 화면을 실제로 써 봐야 떠오르는 동선이다.**
   - **스모크는 "동작한다"가 아니라 "고친 것이 실제로 고쳐졌다"를 봐야 한다. 대조군을 함께 돌려라.** CLI push 멱등성 사이클의 형태가 좋은 예다 — ① 신규 항목을 push해 파일에 id가 박히는지 보고 ② `.erdd/base.json`에서 그 항목을 지워 "서버엔 있는데 base는 모르는" 상태(= 응답 유실)를 만든 뒤 다시 push해 `ops:0`으로 수렴하는지 보고 ③ **대조군으로 파일의 id를 지우고 같은 push를 돌려** 서버에 사본이 실제로 생기는 것(`['MBR','ORD','ORD']`)을 확인했다. ③이 없으면 ②의 통과가 "원래 그랬던 것"인지 "고쳐서 그런 것"인지 구별되지 않는다.
   - ⚠️ **태스크별 리뷰가 전부 clean이어도 최종 리뷰는 반드시 하라.** 실시간 sub-project에서 7태스크가 모두 Critical/Important 0건이었는데 최종 리뷰가 Critical 1건 + Important 2건을 잡았다. 셋 다 **태스크 경계를 가로지르는** 결함이라 스코프가 좁은 게이트로는 구조적으로 볼 수 없다.
   - 최종 리뷰 프롬프트에 이 한 줄을 넣으면 그런 결함이 바로 드러난다: **"이번 브랜치에서 두 번째 호출자가 생긴 기존 함수를 전부 나열하고, 양쪽 호출자 기준으로 그 함수의 불변식을 재유도하라."** 실제로 Critical(`setSeq`가 두 가지 의미를 갖게 된 것)이 이 질문 하나로 잡힌다. **CLI push 멱등성 사이클에서도 또 값을 했다** — 해당 함수 둘(`canonical`·`filesToModel`)에서 각각 실제 불변식 충돌이 나왔고, 그중 하나(`validate`와 `push`의 판정이 갈려 push가 가리키는 명령이 "문제 없음"을 주던 것 — 3.9절)는 **태스크별 리뷰 3라운드가 전부 놓친 것**이다.
   - ⚠️ **설계 문서 안에 이미 모순의 재료가 다 있어도 태스크 단위로는 아무도 그 둘을 나란히 놓지 않는다.** N:M 사이클의 Critical 이 그랬다 — 설계 3.3 은 식별 관계를 막는 근거를 "FK 가 자식 PK 라 하위 관계가 연쇄로 깨진다"로 적었고, 3.4 는 "`identifying` 과 FK 의 `isPk` 는 모델이 묶지 않아 어긋날 수 있다"를 **스스로 인정**했다. 두 문장을 나란히 놓으면 가드가 뚫린다는 게 바로 보이는데, 태스크별 리뷰 2라운드가 전부 통과시켰다. 최종 리뷰의 값이 여기 있다.
   - ⚠️ **이중 방어를 넣으면 각 방어의 단독 구분력이 사라진다**(이 저장소에서 두 번 실측). "dedup + 비교 완화" 처럼 각각이 단독으로 충분한 가드 둘을 함께 넣으면, 요구한 테스트는 **쌍만 잠그고** 한쪽 회귀는 통과시킨다(둘 다 되돌려야 FAIL). 나중에 한쪽이 지워져도 아무도 모른다. 둘 다 두려면 **각각을 단독으로 잡는 테스트**를 요구하거나, 원리상 관찰 불가능한 쪽은 그 사실을 주석으로 남기게 하라. 컨트롤러가 "이중 방어, 비용 0"이라고 판정한 것이 틀렸고 워커가 실측으로 바로잡은 사례다.
   - **수정의 구분력은 워커가 실증하고 컨트롤러는 보고로 받는다.** 각 수정에 대해 프로덕션 변경을 되돌려 새 테스트가 *실제로 실패*하는지 확인하고 복구하게 한다(`git checkout -- <path>` → 마지막에 `git status` 로 clean 확인).
     - 🔥 **실증은 반드시 커밋 뒤에 한다. 브리프에 이 한 줄을 박아라.** 실증은 프로덕션 코드를 일부러
       훼손했다가 `git checkout -- <path>` 로 되돌리는 절차인데, **커밋 전에 그것을 하면 `checkout` 이
       그 Task 의 구현을 통째로 HEAD 로 날린다.** 훼손분만 사라지는 것이 아니라 그 파일에 쓴 것이 전부
       사라진다. 2026-08-19 그룹 왕복 사이클의 Task 1 에서 실제로 일어나 구현을 재작성해야 했다.
       순서는 **구현 → 테스트 초록 → 커밋 → 실증 → 되돌리기 → `git status` clean** 이다. 덤으로
       실증이 「커밋된 것」을 재는 게 되어 보고의 커밋 해시와 측정 대상이 정확히 일치한다.
     - ⚠️ **`git checkout -- <path>` 는 아직 커밋되지 않은 신규 파일에는 통하지 않는다.** 그 태스크가
       만든 파일은 untracked 라 index 에 복구할 원본이 없고, `checkout` 은 "pathspec 이 어떤 파일과도
       일치하지 않는다"로 실패한다. 그런 파일은 **편집으로 되돌려야 하고, 그래서 복구가 원본과 같은지를
       따로 확인해야 한다**(변조 전 내용을 스크래치에 복사해 두고 diff 하는 것이 확실하다).
       `git status` 의 clean 확인도 여기서는 통하지 않는다 — untracked 파일은 변조해도 `??` 로 똑같이
       보이므로 **어떻게 보이든 판별이 안 된다.** 이번 사이클의 워커가 실제로 물렸다. 브리프에
       "복구하고 clean 을 확인하라"만 적으면 이 갈래가 비어 있다. **구현자와 리뷰어가 각각 독립적으로 실증하므로 두 소스가 교차 검증된다** — 둘이 갈리거나 한쪽이 "실패하지 않았다"고 보고할 때만 제3의 워커를 띄워 재현시킨다. 컨트롤러가 직접 파일을 고쳐 재실증하지 않는다(`CLAUDE.md` "워크트리 작업은 Orca 세션으로 한다").
     - 이 규칙은 2026-08-06에 뒤집혔다. 원래는 "컨트롤러가 직접 실증하라"였고 근거는 실시간 사이클에서 **리뷰 에이전트가 되돌린 파일을 남긴 채 스톨**한 사고였다. CLI push 멱등성 사이클이 그 전제를 반증했다 — **브리프에 복구를 명시하면 서브에이전트도 오염시키지 않는다**(워커들이 11회·6회씩 변조·복구했고 컨트롤러가 확인할 때마다 워킹트리가 clean이었다). 같은 사이클에서 **컨트롤러의 재실증 7회가 워커·리뷰어 보고를 뒤집은 것은 0건**이었다. 반대로 컨트롤러가 워크트리에 쓰는 것 자체가 사고 경로였다(cwd 착각).
     - **브리프에는 "구분력이 있다/없다"가 아니라 진단을 요구하라.** 무엇이 어떤 값으로 관찰됐고 원인이 무엇인지까지 적게 한다. 같은 사이클에서 리뷰어가 alias 회귀를 "조용히 합쳐진다"까지만 보고해 컨트롤러가 직접 원인(되쓰기가 `firstUse` 등록을 건너뛰어 중복 검사까지 무력화된다)을 파악해야 했다 — 그 원인이 수정 방향을 결정했으므로, 요구했더라면 보고에 실려 왔을 것이다.

**커밋·git·워크트리 규칙은 `CLAUDE.md`(저장소 루트)에 있다** — `git add -A` 금지(경로 명시 스테이징),
최상위 체크아웃 규칙, 커밋 메시지 형식, 워크트리 위치·포트·격리 DB, 메모리 기능 금지, 응답 한국어.
규칙이 바뀌면 **그 파일 한 곳만** 고친다(여기에 사본을 두지 않는다).

**서브에이전트 프롬프트에 반드시 넣을 세 문장.** ERDD의 지배적 결함군은 틀린 코드가 아니라 **아무것도
붙잡아 두지 않는 맞는 코드**다 — CLI 트랙 B 사이클에서 Important 지적의 절반가량이 "방어 대상 코드를
지우거나 뒤집어도 통과하는 테스트"였고, CLI push 멱등성 사이클에서는 **그 사이클의 존재 이유인 계약
자체가 무테스트**였다(되쓰기를 "파일에 적는 id ≠ op가 나르는 id"로 바꿔도 core 459개 전부 통과 —
3.9절). 다음 세 지시가 그것을 드러낸다:

1. **구현자에게:** "브리프의 기대값이 실제와 어긋나면 프로덕션 코드를 기대값에 맞추지 말고, 이전 태스크
   산출물도 고치지 마라 — **단언을 정정하고 관찰한 것을 명령 출력과 함께 보고하라. 판단은 컨트롤러가
   한다.**" (사이클당 계획 결함 ~10건이 이걸로 드러났고, 그중 몇은 통과하면서 아무것도 검증하지 않던
   테스트였다)
2. **구현자에게, 수정 건마다:** "그 수정이 구분력이 있는지 확인하라 — 프로덕션 변경을 되돌려 테스트가
   실패하는지 보고 복구하라. **실패하지 않으면 덮지 말고 그렇다고 보고하라.**" 부정적 결과를 보고해도
   된다는 명시적 허용이 정직한 보고를 만든다.
3. **수정 워커에게:** "**리뷰 보고서의 제안도 검증되지 않은 주장이다** — 그대로 통과한다고 가정하지
   말고 실측한 뒤, 어긋나면 다른 방법을 쓰고 근거를 보고하라." CLI push 멱등성 사이클에서 리뷰어가
   "raw 비교로 바꾸면 그 테스트가 실효를 갖는다"고 제안했는데 실측상 거짓이었고(`assignedTree`는 신규
   0건이어도 항상 존재하고 재작성 결과가 바이트까지 같다), 수정 워커가 그것을 발견해 다른 방법으로
   구분력을 만들었다. 이 문장이 없으면 리뷰어의 잘못된 처방이 그대로 커밋된다.

리뷰어에게는 "품질을 봐라"가 아니라 **그 태스크의 구체적 load-bearing 리스크**를 지목해 주고, 구현자의
보고는 **미검증 주장**임을 알린다.

**"기존 동작을 없애는" 사이클은 착수 시점에 그 동작을 서술하는 주석·문서를 grep해 목록을 만들어라.**
CLI push 멱등성 사이클의 결함은 거의 전부 두 종류였다 — (i) 위의 "아무것도 붙잡아 두지 않는 맞는
코드", (ii) **변경이 기존 서술을 거짓으로 만드는 것**(주석 5곳, 그 사이클 설계 §2.4·§3.3의 자기모순,
이 문서의 낡은 이월 항목). 이 사이클은 없애는 대상이 바로 그 서술들이 설명하던 동작("push는 매번
새 id를 발급한다")이었으므로 (ii)는 성격상 필연이었다. 리뷰가 하나씩 주워 담는 것보다 착수 시점에
목록을 만들어 태스크에 배분하는 편이 싸다.

**서브에이전트 한도:** 한 세션에서 200개까지. 명명 체계 세션은 Task 6에서 한도에 도달해 이후는 컨트롤러가 직접 구현+자기리뷰로 마쳤다. 커스텀 항목 세션(7태스크+최종리뷰+수정)은 한도 안에서 전 과정을 서브에이전트 구현+리뷰로 마쳤다(약 17개 서브에이전트 사용). 서브에이전트 리뷰를 계속 쓰려면 `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`을 올린다.

### 병렬 트랙(worktree 2개)으로 돌릴 때

공용 리소스 fork·Excel 산출물/업로드를 worktree 2개로 동시에 진행했다. 잘 돌아갔고, 다음이 필수였다.

> 워크트리 **생성·위치·포트·정리** 규칙과 Orca 오케스트레이션 우선 규칙은 `CLAUDE.md`에 있다. 여기에는
> 그 위에서 실제로 든 비용과 트랙 운영 노하우만 남긴다.

- **트랙별 격리 DB**를 미리 만들어 준다(`erdd_dev_a`/`erdd_test_a`, `erdd_dev_b`/`erdd_test_b`). 공유 `erdd_test`를 두 트랙이 함께 쓰면 서로의 데이터를 지운다.
- **base는 반드시 로컬 `main`으로 명시**한다(`git worktree add -b feat/<작업명> .worktrees/feat-<작업명> main`). 생략하면 진행 중인 주 트랙 위에 얹히고, `origin/main`을 쓰면 뒤처진 옛 커밋을 잡는다(실제로 42커밋 뒤처진 상태였다 — 당시 Orca 기본값이 `origin/main`이었다).
- 각 워커에게 **`main` 체크아웃·머지 금지**를 명시한다(같은 저장소의 다른 워크트리가 `main`을 잡고 있으면 git이 거부한다). 워커는 구현+테스트+최종 리뷰까지, 병합·문서 갱신은 컨트롤러가 한다.
- **브라우저 스모크는 컨트롤러가 병합 후 최상위에서 한다.** 워크트리에서도 격리 포트(`PORT`+`ERDD_SERVER_PORT`+`ERDD_WEB_PORT`)로 띄울 수는 있지만, 확인해야 할 것은 병합된 결과이고 Claude 확장이 붙은 Chrome 프로필도 하나뿐이다.
- **`HANDOFF.md`·`91-checklist.md`는 어느 트랙도 건드리지 않게 한다** — 양쪽이 고치면 병합 충돌이 확정이다. 컨트롤러가 병합 후 일괄 갱신한다.
- **마이그레이션 번호는 반드시 충돌한다**(둘 다 0007을 만든다). 워커에겐 신경 쓰지 말고 각자 격리 DB에 적용하라고 하고, 병합 시 컨트롤러가 나중 트랙의 파일을 버리고 **병합된 스키마에서 `drizzle-kit generate`로 새 번호를 뽑는다**(스냅샷 손수정보다 안전).
- 병합 시 실제로 든 비용: 파일 충돌 11개 + 교차 타입/테스트 오류 20여 곳. 대부분 "두 트랙이 같은 엔티티에 각각 새 필드를 추가"해서 생긴 기계적 충돌이라, 양쪽 필드를 모두 살리면 된다. 다만 **의미 판단이 필요한 곳이 섞인다**(예: Excel 가져오기의 `draft`는 신규 생성용이라 `origin: null`이 맞지만, 부분 갱신용 `patch`에는 넣으면 안 된다 — 넣으면 업로드가 기존 항목의 fork 출처를 지운다).
- 새 런타임 의존성이 붙은 트랙을 병합하면 **`pnpm install`을 먼저** 해야 타입이 풀린다(안 하면 그 파일이 implicit any로 깨진다).

#### ⚠️ 트랙이 셋 이상이면 "같은 상태를 각자 바꾸는" 충돌이 난다 (2026-08-10 실측)

포트·DB만 갈라 놓는 것으로는 부족하다. 2026-08-10에 **다른 세션이 띄운 세 번째 트랙**
(`feat/sidebar-multiselect`)과 `feat/canvas-clipboard`가 **같은 `store.selectedTableIds`를 서로 다른
규약으로** 만들었다. 기계적 충돌이 아니라 **의미 충돌**이라 병합기가 잡지 못한다.

| | `feat/canvas-clipboard` | `feat/sidebar-multiselect` |
|---|---|---|
| 주 선택 | `selectedTableIds[0]` | `selectedTableIds.at(-1)` |
| `selectedColumnIds` | 추가함 | 모름 |
| presence 프로토콜 | 안 건드림(설계 D-C5) | `selections` 배열로 확장(core+server+web) |

양쪽 컨트롤러가 서로의 존재는 알았지만(사이드바 쪽이 포트를 C 슬롯으로 비켰다) **어떤 상태를
건드리는지는 몰랐다.** 포트 표는 공유됐는데 **"내가 소유할 파일·상태" 목록은 공유되지 않았다.**

**How to apply — 트랙을 띄우기 전에:**
1. `git worktree list`로 **다른 세션이 띄운 워크트리가 있는지 먼저 본다.** 자기 세션이 만든 것만
   있다고 가정하지 마라.
2. 있으면 그 브랜치의 `git log --oneline main..<브랜치>`와 `docs/superpowers/plans/`의 최신 계획을
   읽어 **소유 파일·상태가 겹치는지** 확인한다.
3. 겹치면 **먼저 끝나는 쪽을 병합하고 나중 트랙이 조정**한다. 진행도가 앞선 쪽을 먼저 병합하는 것이
   되짚는 양이 적다.
4. 각 트랙의 스펙에 **"내가 소유하는 파일·상태"**를 적어 두면 다음 트랙이 그것을 읽고 비켜 갈 수 있다.

**나중 트랙이 조정할 때의 실측 비용(사이드바 트랙, 2026-08-11):** 충돌 10파일(전부
`apps/web/src/editor/`), 병합 워커 1명이 처리. 기계적 충돌은 거의 없고 **규약 판정이 일이다** —
컨트롤러가 넷을 미리 정해 브리프에 넣었더니 워커가 물어 온 것은 하나뿐이었다(⑤). ①주 선택은 먼저
병합된 쪽(`[0]`) ②presence 다중 발신은 사용자 결정(D4)이라 이쪽 ③`selectedColumnIds` 불변식은 먼저
병합된 쪽 ④`readonly`·공유 빈 배열은 이쪽 ⑤**같은 조작에 대한 확인 다이얼로그 유무**(내 설계 §7 vs
main 의 즉시 삭제) — 이건 양쪽 다 사용자 결정이라 컨트롤러가 판정했다(확인을 유지하고 단축키 경로도
같은 다이얼로그를 태웠다). **판정을 브리프에 미리 넣지 않으면 워커가 매번 멈춘다.**
그리고 **병합으로 사라지는 테스트를 세어라** — 자동 병합이 main 쪽 테스트 13건을 지웠고 그중 하나가
"고스트는 선택할 수 없다"를 덮던 유일한 그물이었다(고스트 id 가 원본 테이블 id 와 같아 선택 창구의
`Object.hasOwn(model.tables, id)` 필터로는 안 걸러진다). 병합 워커가 세어 보고 다시 잠갔다.

#### ⚠️ Orca 런타임이 재시작되면 세션의 Run 바인딩이 **다른 세션의 Run 으로** 넘어간다 (2026-08-11 실측)

사이드바 트랙에서 실제로 일어났다. 내가 만든 Run 은 `run_b6a88f2150dd` 였는데, 런타임 재시작 뒤
`check` 가 **다른 세션의 Run**(`run_4684b5a9befe`, objective 가 "DDL 역설계…")을 반환했고 그 시점
이후 만든 태스크 2개가 **그 세션의 인박스로 들어갔다.** 사용자가 다른 창에서 내 워커의 heartbeat 를
보고 알려 줬다.

증상 셋: (a) `check --wait` 가 `waiter_exists` 로 거부된다(**남의 세션이 그 Run 에 waiter 를 걸어
둔 것**) (b) 내 워커의 `worker_done` 이 안 온다 (c) 반대로 **남의 배치가 내 `check` 에 재생된다**.

- **감지**: 태스크를 만들기 전에 `orca orchestration check --peek --json` 의 `runId` 가 내 Run 인지
  본다. `worker-show --dispatch <id>` 의 `run_id` 로도 확인된다.
- **복구**: `orca orchestration run-use --id <내 Run>`. 단 **이미 디스패치된 워커의 `worker_done` 은
  그 dispatch 가 속한 Run 으로 간다** — 진행 중인 워커가 있으면 그 워커가 끝난 뒤에 되돌려라.
- **끊긴 대기의 대안**: `waiter_exists` 로 막히면 터미널을 직접 읽거나(`terminal read`) 결과물
  (git 커밋 등)을 폴링한다. 워커는 멀쩡히 돌고 있다.

#### ✅ 브라우저 스모크를 워커에게 넘길 수 있다 — Playwright MCP 로 실증 (2026-08-11)

5절이 "2026-08-09 에 전제가 깨졌으니 다음 사이클에서 워커에게 넘겨 보라"고 남긴 항목의 결론이다.
**넘길 수 있다.** 사이드바 트랙의 스모크 워커가 13항목을 전부 실행했다.

- 앱은 워커가 격리 슬롯(`PORT`/`ERDD_SERVER_PORT`/`ERDD_WEB_PORT` + 격리 DB)으로 직접 띄운다.
- **2번째 클라이언트도 된다** — Playwright 의 별도 브라우저 컨텍스트 + 별도 계정으로 presence·
  실시간 수신을 검증했다(Claude 확장의 "프로필 하나" 제약이 없다).
- **픽셀 단위 조작이 오히려 낫다** — `browser_run_code_unsafe` 로 드래그 궤적을 설계해 "고스트 잔상
  안으로 커서를 12회 떨어뜨려 히트 0회", "타깃 위 팬 0px / 밖 +816px" 같은 **수치 단언**을 만들었다.
  사람이 손으로 흔드는 것보다 재현성이 높다.
- **여전히 결함을 잡는다** — 단위 테스트 717건과 리뷰 9라운드를 통과한 브랜치에서 Important 1건
  (재배치가 그룹 밖 테이블 위에 정확히 포개짐)이 나왔다.
- ⚠️ `.playwright-mcp/` 를 **저장소에 남기지 않게** 브리프에 명시해라(cwd 에 생긴다).

⚠️ **코디네이터가 Claude 확장으로 직접 하려 들지 마라 — 렌더 결함은 원리적으로 계측이 안 된다.**
(2026-08-12 실측, 깜박임 사이클에서 시간을 버렸다.) 확장의 MCP 탭은 **활성 탭이 아니라서**
`document.visibilityState === 'hidden'` 이고 `document.hasFocus() === false` 다. 그러면
`requestAnimationFrame` 이 아예 돌지 않아(rAF 대기가 45초 CDP 타임아웃으로 끝난다 — 렌더러가 멈춘
것으로 오인하기 쉽다) **ResizeObserver 도 돌지 않는다.** 그 결과 캔버스 노드 26개 중 25개가
`visibility: hidden` 인 채로 남는데, 이것은 **고치려는 버그의 증상과 구분되지 않는다.** 탭을 앞으로
가져오려는 우회는 전부 막혔다 — `open -a`·System Events 로 창을 띄워도 MCP 탭은 그 창의 활성 탭이
아니고, Chrome 자동화 권한이 없으면 AppleScript 는 `-1712` 로 타임아웃한다. **워커 + Playwright MCP
가 답이다**(위 항목). Playwright 브라우저는 headless 여도 `visible` 이라 rAF·ResizeObserver 가 정상이다.

---

## 6. 이월 항목 (모두 non-blocking)

**DDL 왕복의 `UNSIGNED`·테이블 옵션 유실 (소비처 피드백 1·2번 — 별도 설계 사이클)**

- **무엇:** MySQL DDL 을 가져왔다가 다시 내보내면 컬럼의 **부호 없음**(`INT UNSIGNED`·
  `SMALLINT UNSIGNED`)과 **테이블 옵션**(`ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)이 사라진다.
  실측(2026-09-03): `int unsigned` → 논리 타입 `INT`, `ENGINE`·`CHARSET` 은 파서의 `skipped` 에도
  안 남는다. **유실을 알리는 경고가 한 줄도 없다** — `planDdlImport` 의 `warnings` 에는 사전
  미등록(`unknown-word`)만 실린다. `unknown-type`·`ambiguous-type` 도 안 뜬다.
- **왜 이번에 안 고쳤나:** 「컬럼 타입은 방언 중립 논리 타입 17종」이라는 설계와 정면으로 맞물린다.
  부호 없음은 타입 축에, 테이블 옵션은 모델(`Table`)에 담을 자리 자체가 없다. 담을 자리를 만드는
  것은 모델 스키마·마이그레이션·DDL 생성·파서·왕복 테스트를 함께 여는 일이라 별도 사이클이다.
- **어느 테스트가 이 사실을 잠그고 있나:**
  `packages/cli/src/commands/roundtrip.test.ts` 의
  **「MySQL INT UNSIGNED·ENGINE·CHARSET 은 현재 왕복에서 유실된다 (피드백 1·2번)」**.
  ⚠️ **그 테스트는 「고쳐진 동작」이 아니라 「현재 유실된다」를 단언한다.** 고치면 그 테스트가
  빨개지면서 사람을 이 이월 항목으로 데려온다 — 그때 단언을 뒤집어라(유실 → 보존).
  사용자용 서술은 `docs/manual/cli-guide.md` 6.10 절 끝의 ⚠️ 문단에 있다.

**`erdd export --format dbml` 은 `Project` 블록을 내지 않는다**

- `generateDbml` 의 `projectName` 을 주지 않아 `Project { database_type }` 이 없다. 그래서 그 산출물을
  되읽으면 방언이 `config.dialects[0]` 로 떨어진다 — 같은 프로젝트로 왕복하는 한 값이 같아 문제가
  없지만, **다른 프로젝트로 옮기면 방언 정보가 따라가지 않는다.** 프로젝트 이름을 무엇으로 쓸지가
  먼저 정해져야 한다(로컬 모드에는 프로젝트 이름이 없다 — `erdd.config.yaml` 에 `projectId` 만 있다).

> **패키지 게시(`@erdd/cli`·`@erdd/core`) 관련 이월은 [4.1b](#41b-게시-관련-이월-항목-일부러-고치지-않은-것)에
> 따로 모아 두었다** — 소비처의 `tsx` 직접 설치(셰방 런처), 루트 `.npmrc` 부재, `npm view` 의 401/403,
> 게시본의 죽은 항목, `image: node:22` 태그 고정, 태그 정규식의 빌드 메타데이터, `erdd --version` 부재.

**테이블 물리명 형식 템플릿 (구현 완료, 잔여 — 설계 6절)**

- ~~**논리명 템플릿**~~ — **해소됐다**(2026-08-18 사이클). 선행 결정이던 「조합된 논리명이 용어
  매칭에 쓰이는가」는 **아니다**로 확정했다(설계 D1 — 산출물 전용). 그래서 `warnings.ts` 가 한 줄도
  안 바뀌었다.
- ~~**역설계 역분해**~~ — **해소됐다**(2026-08-18 머릿말 메타 사이클). 역분해를 넣은 것이 **아니라**
  내보낼 때 부분을 머릿말에 적어 두고 되읽을 때 그대로 쓴다. `ddl-import.test.ts` 의 D2 고정
  케이스는 「머릿말이 있으면 부분이 복원된다」·「머릿말이 없으면 조합된 이름이 통째로 부분이 된다」
  두 짝으로 갈렸다. 남은 한계는 아래 세 줄이다.
- **머릿말 없는 조각 붙여넣기** — 설계 D1 이 수용한 대가다. 첫 줄 주석을 지우거나 `CREATE TABLE` 한
  문장만 잘라 붙이면 표가 없어 **옛 동작**(조합된 이름이 통째로 부분)이 된다. 남이 준 DDL 도 같다.
  ⚠️ **그룹도 같이 못 살린다**(2026-08-19 이후) — 머릿말이 없으면 그룹 배정과 별칭·색·코멘트가 함께
  사라진다. DBML 만 예외로, `TableGroup` 블록을 같이 붙여넣으면 **그 블록이 말하는 그룹 배정·색·
  코멘트는 살아나고 별칭만 사라진다**(블록에 별칭 자리가 없다 — `dbml.ts` 는 그룹의 코멘트를 `note:`
  로 내보내고 `dbml-parse.ts` 가 그것을 `comment` 로 되읽는다).
  ⚠️ 사용자 매뉴얼에 그 두 예외를 적어 뒀다 — 동작을 바꾸면 그쪽도 함께 고쳐야 한다.
- **템플릿·그룹 별칭 복원** — **절반 해소됐다**(2026-08-19 그룹·별칭 왕복 사이클). **그룹 배정과
  그룹의 별칭·색·코멘트는 이제 복원된다**(머릿말 `erdd:v2` 의 `g` 구획). **템플릿은 그대로 남는다** —
  머릿말은 여전히 「어떤 최종 이름이 어떤 부분에서 나왔는가」만 싣고 **어떤 템플릿이었는지는 안
  싣는다.** 그래서 가져온 프로젝트에 형식을 직접 걸기 전까지 테이블은 부분 이름 그대로 보인다.
  넣으려면 머릿말에 프로젝트 수준 구획을 하나 더 두어야 하는데(`t`·`g` 와 나란한 셋째 구획),
  **템플릿은 프로젝트 설정이라 가져오기가 그것을 덮어써도 되는지가 먼저 결정돼야 한다** — 지금은
  가져오기가 모델만 건드리고 설정은 손대지 않는다.
- ~~**머릿말 복원 충돌로 건너뛴 테이블이 미리보기 요약의 「건너뜀 N개」에 안 잡힌다**~~ — **해소됐다**
  (2026-08-19 「세는 범위 + 부분 이름 잠금」 사이클). `ddl-import.ts` 의 `claimed` 갈래가
  `skippedTables` 에 담게 했다. **이월 문구보다 범위가 넓었다** — 그 갈래의 사유는 둘인데(머릿말이
  서로 다른 두 원문 이름을 같은 부분으로 되돌림 · DDL 에 같은 `CREATE TABLE` 이 두 번) **뒤엣것은
  이 트랙 이전부터 안 세고 있었다.** 한쪽만 넣으면 같은 자리에서 어떤 건너뜀은 세고 어떤 건너뜀은
  안 세는 더 나쁜 모양이 되므로 둘 다 담는다. 담는 값은 **DDL 원문 이름** 그대로이고 요약 문구도
  그대로다. 대안(요약 줄이 `table-conflict` 경고를 함께 세게 하기)은 쓰지 않았다 — `skippedTables`
  라는 이름이 이미 「건너뛴 테이블」을 약속하므로 세는 자리와 담는 자리를 하나로 뒀다.
  - ⚠️ **`ddl-import.test.ts` 의 「다른 그룹의 두 테이블이 같은 부분으로 복원되면 뒤엣것이 빠진다」
    테스트의 `skippedTables` 단언이 「머릿말 되돌림 충돌도 담긴다」의 유일한 잠금이다.** 그 왕복
    테스트를 재편하면서 부수적인 단언으로 보고 빼면 계약이 조용히 풀린다(그 자리 주석에 적어 뒀다).
    형제 사유(진짜 중복 `CREATE TABLE`)는 별도 테스트가 따로 잠근다.
  - ⚠️ **그 케이스가 서술하는 「뒤엣것이 빠진다」는 2026-08-19 이후 v1 머릿말에서만 참이다.**
    충돌 키가 (그룹, 부분 이름) 으로 넓어져 **v2 머릿말에서는 둘이 더 이상 겹치지 않고 둘 다
    들어온다.** 그 테스트가 `-- erdd:v1` 픽스처인 것은 그래서다 — v1 에는 그룹 자리가 없어 충돌 키의
    그룹이 빈 문자열로 들어간다. **옛 덤프에 대해서는 이것이 맞는 동작이다**(원문에 그룹이 안 적혀
    있으므로 복원할 근거가 없다). 픽스처를 v2 로 「정리」하면 이 계약이 통째로 사라진다.
- **`skippedTables` 에 같은 이름이 중복으로 쌓인다** — 같은 `CREATE TABLE` 이 세 번 이상이면
  요약이 `건너뜀 2개 (이름이 겹침: MBR, MBR)` 로 같은 이름을 두 번 적는다. **개수는 맞다**(문장
  2개를 실제로 건너뛴다) — 표시만 유일하게 만들면 개수와 목록이 어긋나 더 나빠지므로 그대로 뒀다.
  독립 리뷰가 프로브로 확인한 대로 **`existing` 갈래에도 변경 전부터 있던 성질**이고, 서로 다른 두
  원문 이름이 같은 부분으로 되돌려지는 경로에서는 이름이 달라 중복이 생기지 않는다. 「이름을 유일하게
  세는가」를 다룰 때 함께 보면 된다.
- ~~**컬럼 물리명 템플릿**~~ — **의도적으로 두지 않기로 정했다**(2026-08-20). 근거와 「그래도
  만든다면」의 설계까지 [결정 문서](specs/2026-08-20-column-name-template-decision.md)에 있다.
  결론을 짊어지는 근거는 둘 — **용어가 컬럼 논리명과 1:1** 이라(`docs/13-naming.md`) 컬럼 최종
  물리명에 접두가 붙으면 정의상 항상 표준 물리명과 어긋나는데 용어 검사는 부분 기준이라 경고조차
  안 뜨고, 테이블 템플릿을 정당화한 **「중복은 최종 기준」의 대응물이 컬럼에는 0** 이다(컬럼 중복은
  같은 테이블 안에서만 보고 접두는 그 안에서 상수라 판정이 한 건도 안 바뀐다).
  - **재검토 조건 셋**: 사용자 요청 발생 · `Table.alias` 신설 · 용어 1:1 정책 폐기.
  - ⚠️ 그 문서가 **테이블 사이클의 「역분해는 원리적으로 모호하다」에 경계를 긋는다** — 템플릿이
    `{물리명}` 을 정확히 한 번 포함하고 나머지 변수가 테이블 스코프면 조합 결과가 `A+부분+B` 꼴이라
    **결정론적 역분해가 성립한다.** 컬럼 템플릿을 만들든 안 만들든 값이 있는 관찰이다.
- **CLI 파일에 최종 이름 노출** — 부분만 싣는다(설계 D3). 파일 형식은 **그대로 유지하기로 했다**
  (2026-08-20). 같은 마찰을 **출력 쪽에서** 없앴다 — `erdd validate` 의 경고가 이제 좌표
  (`erdd/tables/MBR.yaml  MBR.MBR_NO`)를 함께 내므로, 최종 이름을 말하는 경고에서도 한 줄에 부분
  이름과 최종 이름이 같이 보인다. `--json` 의 경고 객체에도 `path`·`label` 이 실린다.
  - ⚠️ **최종 이름을 문구에 쓰는 경고는 셋뿐이다** — `too-long` · `reserved` ·
    `duplicate-physical-table`. 나머지는 이미 부분 이름으로 말한다(`checkNamingEntity` 가 용어
    비교에 `physicalName` 을 쓴다). 범위를 넓혀 잡지 마라.
  - ⚠️ **관계 경고에는 `tableId` 가 없다** — `relationships[entityId].childTableId` 로 푼다.
    관계는 **자식 테이블 파일**에 실리므로 부모로 풀면 틀린 파일을 가리킨다.
- ~~**`validate` 의 좌표가 정규 경로 재조립이다**~~ — **해소됐다**(2026-08-20).
  `filesToModel` 이 **읽어 온 실제 경로**를 `tableFiles`(tableId → 경로)로 함께 돌려주고 `validate`
  가 그것을 쓴다. 가산 필드 하나였다.
  - ⚠️ **「값이 낮다」던 판단이 틀렸다.** 나는 「손으로 파일명을 바꾸는 일탈이고 다음 `pull` 이
    정규화하니 창이 일시적」이라고 봤는데 셋이 뒤집었다 — (1) `packages/cli/skill/SKILL.md` 가
    **「파일 이름을 바꾸지 말고 파일 안의 `name` 을 고쳐라」**라고 **시키므로** 어긋남이 정규
    동선에서 난다, (2) 수렴은 `pull` 에서 일어나는데 **`validate` 는 push 전 검사**라 거짓 좌표가
    나오는 창이 주 사용 구간과 겹친다, (3) 두 테이블이 이름을 맞바꾸면 좌표가 **실제로 있는 다른
    테이블 파일**을 가리킨다 — 없는 경로는 사람이 알아채지만 있는 남의 경로는 조용히 엉뚱한 파일을
    고치게 한다.
  - ⚠️ **형제 경로도 함께 닫았다** — `file-merge.ts` 의 `pathOf` 가 같은 재조립을 해서 `push`·`diff`
    의 **충돌 리포트 헤더**도 같은 거짓말을 했다. 3-way 병합 로직은 안 건드리고 선택 인자 하나로
    붙였다.
  - ⚠️ **폴백의 성질이 두 자리에서 다르다.** `validate` 쪽은 **도달 불가**(모든 테이블이 파일에서
    온다)라 주석으로만 남겼고, `file-merge` 쪽은 **실제로 도달한다** — 로컬이 파일을 지웠고 서버가
    그 테이블을 고친 `local-delete` 충돌에서는 `tableFiles` 에 항목이 없다. 그때 재조립은
    「`pull` 하면 생길 경로」라 리포트 안내와 앞뒤가 맞으므로 남기고 전용 테스트로 잠갔다.
- ~~**core 가 `too-long`·`reserved` 경고 문구를 안 잠근다**~~ — **해소됐다**(2026-08-20).
  ⚠️ **조사해 보니 진단이 절반만 맞았다** — `too-long` 문구는 **cli 가 이미 잠그고 있었고**,
  `duplicate-physical-table` 은 **core 가 이미 잠그고 있었다**(그래서 새 테스트를 안 만들었다).
  어디에도 없던 진짜 구멍은 **`reserved` 하나**였다. 새 테스트 둘은 **템플릿이 걸린 픽스처**라야
  구분력이 생긴다 — 템플릿이 없으면 부분 = 최종이라 아무것도 안 잠근다.
- ~~**접기 규칙이 변수 뒤 리터럴을 통째로 지우는 것이 의도인지 재검토**~~ — **해소됐다**
  (2026-08-18 사이클). 「밑줄만 지운다」로 바꿨다(설계 D2). `TB_{그룹별칭}_LOG` 는 별칭이 비면
  `TB_` 가 아니라 `TB_LOG` 다.

**머릿말이 그룹·별칭까지 왕복 복원 (구현 완료, 잔여 — 이 사이클이 새로 남긴 것)**

- **이름이 같은 서로 다른 그룹은 하나로 뭉개진다.** 머릿말이 그룹을 **이름으로** 다루기로 한 귀결이다
  (설계 D3·D7). 모델에는 그룹 이름에 유일성 제약이 없으므로 같은 이름의 그룹이 둘 있을 수 있는데,
  내보낼 때 머릿말의 `g` 구획은 **앞엣것만 싣고 뒤엣것의 별칭·색·코멘트는 조용히 사라진다.** 되읽을
  때도 이름으로 합쳐져 두 그룹의 테이블이 한 그룹에 들어간다. 고치려면 머릿말이 그룹 **id** 를
  실어야 하는데, 그러면 다른 프로젝트로 가져갈 때 id 가 아무 의미도 없어진다 — 「같은 이름이면 같은
  그룹」이 그 이식성의 값이다. 먼저 정해야 할 것은 **그룹 이름에 유일성 제약을 걸 것인가**다.
  - ⚠️ **「앞엣것만 싣는다」는 이름이 완전히 같을 때다. 대소문자만 다르면(`Sales` vs `SALES`)
    살아남는 쪽이 반대다.** 빌드는 `g` 구획의 키를 **원문 대소문자**로 쓰므로 **둘 다 실리고**, 파싱이
    `k.trim().toUpperCase()` 로 색인하면서(`name-meta.ts`) **뒤엣것이 앞엣것을 덮는다.** 프로브로
    관측한 실제 동작 — 머릿말은 `"g":{"Sales":{"a":"AAA",…},"SALES":{"a":"BBB",…}}` 로 둘 다 나가는데,
    되읽은 계획은 `{name:"SALES", alias:"BBB", color:"#222222", comment:"뒤",
    tablePhysicalNames:["AAA_T","BBB_T"]}` **하나뿐**이다(이름·속성은 **뒤엣것**, 멤버는 둘의 합집합).
    같은 입력을 이름만 완전히 같게(`회원`/`회원`) 바꾸면 `{name:"회원", alias:"AAA", …}`(**앞엣것**)가
    나온다. **뭉개진다는 것은 같고 어느 쪽이 살아남는지가 갈린다** — 유일성 제약을 정할 때 두 경우를
    함께 봐라.
  - ✅ **2026-08-20: 뭉개지는 방식만 통일했다** — 빌드가 `g` 구획을 **대문자 키로** 모아
    **먼저 나온 것이 이긴다**. 대소문자만 다르면 뒤엣것이, 완전 동명이면 앞엣것이 이기던
    모순이 사라졌고, 머릿말이 같은 그룹을 두 번 싣는 자기모순 산출물도 없어졌다.
    **뭉개진다는 사실 자체와 유일성 제약 여부는 그대로 이월이다.**
  - ⚠️ **뿌리는 머릿말이 아니다.** 파일 형식은 **이미 그룹 이름의 유일성을 요구하고**
    (`filesToModel` 이 「그룹 이름 X이 중복됩니다」를 낸다) `erdd validate` 가 파싱 오류로,
    `push` 가 「파일 오류 N건」으로 막는다. 그런데 **웹의 그룹 이름 변경(`group-panel.tsx` 의
    `onBlur`)에 중복 검사가 없어** 기존 이름으로 바꾸면 그만이다 — 모델이 파일 형식이 금지한
    상태를 갖게 되는 자리가 거기다.
- **웹의 그룹 이름 변경에 중복 검사가 없다**(`group-panel.tsx`). 생성은 미사용 번호(`그룹N`)라
  안 겹치지만 이름 변경은 아무것도 안 막는다. 고치려면 **경고로 알릴지**(그러면
  `Warning['scope']` 에 `'group'` 을 더해야 하고 `naming-check.tsx` 의 라벨·선택 배선과
  HANDOFF 3.14 체크리스트가 따라온다) **입력을 막을지**를 먼저 정해야 한다.
- ~~**D7 이 머릿말이 이긴 그룹의 DBML 블록을 통째로 버린다**~~ — **해소됐다**(2026-08-20).
  8번 절의 소속 판정을 **충돌 키와 같은 `groupOf` 하나로 통일**했다. 멤버는 블록에만 있는 것도
  합류하고, 속성은 **머릿말 우선 · 블록 폴백**이다.
  - ⚠️ **문서에 적힌 것보다 나빴다 — 이것은 회귀였다.** 직전 사이클의 `35a1684` 가 충돌 키의
    `groupOf` 에 「머릿말 → 블록」 폴백을 넣으면서 8번 절의 D7 폐기 로직은 그대로 뒀다. 그래서
    **충돌 판정은 「ORD 가 회원관리에 들어간다」고 보는데 8번 절이 블록을 버려 ORD 는 그룹 없이
    만들어졌다** — 그룹 없는 `ORD` 가 이미 있는 모델에 넣으면 건너뛰지 않고 들어와 **같은
    물리명이 둘** 생겼다. 설계 3.3 이 금지한 비대칭이 정확히 반대 방향으로 남아 있었다.
  - ⚠️ **D7 은 약해지지 않았다.** 머릿말이 말하는 자리에서는 여전히 머릿말이 이긴다 — 속성도,
    어느 그룹에 넣을지도. 바뀐 것은 **머릿말이 침묵한 테이블**뿐이고 침묵은 부정이 아니다.
  - ⚠️ **함께 찾은 손해 하나** — 머릿말과 블록이 **같은 테이블을 다른 그룹으로** 말하면 그
    테이블이 두 그룹에 실려 나가고 웹의 `groupIdByTable.set` 이 나중 것을 이겨 **블록이 머릿말을
    이기는 정반대 결과**가 됐다(web 까지 돌려 확인). 같은 수정으로 닫혔다.
  - ⚠️ **같은 이름의 블록 둘도 「먼저 나온 것이 이긴다」로 맞췄다.** 원래 `last-wins` 였는데
    `Map` 생성자의 기본 동작일 뿐 근거가 없었고, 이름 폴백 사슬이 갈래마다 다른 이름을 내게 했다.
  - **구조적 보장이 이 수정의 진짜 값이다** — 두 자리가 같은 우선순위를 쓴다는 것이 손으로 지키던
    규약에서 **갈릴 수 없는 구조**가 됐다.
- **도달 불가 방어 분기 둘이 안 잠겨 있다**(`ddl-import.ts` 8번 절의 머릿말 그룹 수집).
  `if (gn === undefined || gn.trim() === '') continue` 의 `trim() === ''` 갈래와
  `name: attrs?.name ?? e.name` 의 `?? e.name` 폴백 — 둘 다 되돌려도 core 전체가 초록이다.
  **커버리지 구멍이 아니다:** `buildNameMeta` 는 테이블에 `g` 를 실을 때 **반드시** `groups[이름]` 도
  함께 채우고, `toV2` 는 값이 `{}` 여도 `{name: k}` 를 만들므로 **우리가 쓴 머릿말에서는 `attrs` 가
  늘 있어 폴백이 안 탄다.** `g: ""` 도 모델 그룹 이름이 빈 문자열일 때만 생긴다. **남이 손으로 쓴 v2
  머릿말**에서만 의미가 있는 분기라 그대로 두었다 — 잠그려면 머릿말 문자열을 손으로 지어 넣는
  픽스처가 필요하다.
- **그룹의 화면 좌표는 복원하지 않는다 — 2026-08-20 에 「하지 않는다」로 판정했다.**
  머릿말에 좌표를 싣지 않고 적용부도 `groupPosition` 을 `null` 로 둔다. 그래서 같은 모델을 내보냈다
  되읽으면 그룹 뷰의 배치가 원본과 다르다.
  - **판정 근거(코드에서 나온 것):** `file-merge.ts` 의 `FILE_INVISIBLE_FIELDS.table` 이
    `['position','groupPosition']` 으로 **정본 텍스트 형식인 CLI 파일이 두 좌표를 아예 안 담고**
    `push` 가 건드리지도 않는다. `model-diff.ts` 의 `IGNORED_FIELDS` 도 둘을 뺀다 — 좌표는 모델
    비교의 대상조차 아니다. **머릿말에 실으면 손실 있는 교환 형식(DDL·DBML)이 정본보다 충실해지는
    역전**이 된다.
  - 게다가 가져오기는 `computeAutoLayout` + (기존 최대 y + 200) 으로 새로 배치한다 — 절대 좌표를
    복원하면 기존 것과 겹친다. 그룹 뷰도 같다.

**테이블 논리명 형식 템플릿 + 접기 규칙 변경 (구현 완료, 잔여 — 이 사이클이 새로 남긴 것)**

- ~~**설계 D3 의 「사이드바 트리·캔버스는 부분을 유지한다」는 테스트로 잠기지 않는다**~~ — **해소됐다**
  (2026-08-19 사이클). `table-tree.test.tsx` · `canvas.test.tsx` 에 1건씩 걸었다. **프로덕션은 한 줄도
  안 바꿨다.**
  - **구분력은 전적으로 픽스처가 진다.** 단언이 「`MBR` 이 보이고 `TB_SLS_MBR` 이 없다」인데, 템플릿이
    빈 픽스처에서는 조합 = 부분이라 **그냥 통과한다.** 그래서 픽스처에 템플릿
    `TB_{그룹별칭}_{물리명}` · 별칭 `SLS` · 부분 `MBR` 이 들어 있어야 한다. 독립 리뷰가 조합으로 치환한
    상태에서 **템플릿만 비우면 초록으로 돌아오는 것**을 확인해 이 성질을 실증했다. 픽스처를 손대는
    사람은 이 짝을 깨지 마라.
  - 캔버스 쪽은 실제 `Canvas` 를 그리므로 store → `buildNodes` → `TableNode` **어느 다리에 조합을
    끼워도** 잡힌다(리뷰가 `nodes.ts` 와 `table-node.tsx` 두 자리로 각각 확인했다).
- **접기 규칙 변경이 기존 프로젝트의 산출물을 바꾼다.** `TB_{그룹별칭}_LOG` 형식을 쓰던 프로젝트는
  별칭이 빈 테이블의 이름이 `TB_` 에서 `TB_LOG` 로 달라진다. 사실상 버그 수정이지만 **이미 내보낸
  DDL 과 새로 내보낸 DDL 이 갈린다.** 사용자 매뉴얼에 안내를 적었다.
- ~~**`project-settings.tsx` 의 논리 미리보기 가드도 잠기지 않는다**~~ — **해소됐다**(수정 라운드
  F-2). `두 템플릿이 다 비면 미리보기가 없다` 한 케이스가 물리·논리 양쪽 가드를 함께 잠근다
  (`TemplatePreview` 는 `kind` 로만 갈리므로 두 미리보기가 같은 가드 한 줄을 공유한다).
- **논리 템플릿은 `erdd validate`(CLI)에 영향이 없다.** 논리명 조합은 산출물 전용이고 CLI 는
  `computeWarnings` 만 부른다 — CLI 는 `tableLogicalTemplate` 을 config 에서 **읽기만** 한다.

**잠기지 않은 채로 남은 자리 (독립 리뷰가 두 사이클에 걸쳐 하나씩 되돌려 확인한 전수)**

물리명 사이클의 리뷰가 찾은 다섯 자리 중 넷(`ddl.ts` 의 코멘트 생략 판정 2 · `warningLabel` ·
타입경고 접두)은 그 사이클의 수정 라운드에서, 남은 하나(`project-settings.tsx` 의
`template === '' → null` 가드)는 **논리명 사이클의 수정 라운드 F-2 에서 닫았다.**

- ⚠️ **`TemplatePreview` 의 `kind` 분기는 「미잠금」이 아니라 「관측 불가능한 죽은 분기」다.**
  다음 리뷰가 같은 시간을 쓰지 않도록 성질을 적어 둔다 — `if (template === '') return null` 을 이미
  지났으므로 `kind === 'physical'` 갈래와 `'logical'` 갈래는 각각
  `compose(template, target, sample)` 로 **완전히 같은 계산**이 된다(두 형제가 몸통을 공유하고,
  각 갈래가 자기 템플릿 자리에 같은 `template` 를 넣는다). **도달 가능한 어떤 입력으로도 두 갈래가
  구분되지 않으므로** 분기를 지우고 항상 물리 조합을 써도 web 이 전부 초록이다 — 커버리지 구멍이
  아니라 **테스트로 잠글 수 없는 죽은 분기**다. **그래도 지우지 않는다**: 지우면 「물리 함수가 논리
  미리보기를 계산하는」 더 나쁜 모양이 되고, 두 형제가 언젠가 갈라지면 조용히 틀린다. 의도 표현으로
  남긴다. 정작 중요한 배선(`template={logicalTemplate}` — 논리 미리보기가 **논리 draft** 를 본다)은
  잘 잠겨 있다(그 자리를 `template` 로 바꾸면 5건이 빨개진다).
- 그 밖에 **브라우저 스모크 8항목**(확장 1개 제약 — 사용자 몫)과 **`{커스텀:항목이름}` 의 UI 경로**
  (core 단위 테스트 4건으로 해석은 잠겼지만 web 미리보기에서 커스텀 변수를 쓰는 케이스는 없다)가
  화면 기준으로 미검증이다.

**그룹 별칭 (구현 완료, 잔여)**

- ~~**테이블명 형식 템플릿**~~ — **해소됐다**(이 사이클). 별칭은 `{그룹별칭}` 변수로 조합에 들어간다.
- **중복 별칭 경고** — 별칭 자체의 중복은 여전히 안 막는다. 다만 템플릿이 걸리면 **테이블 물리명 중복
  경고가 최종 이름 기준**이라 실제로 충돌하는 경우는 그쪽으로 잡힌다 — 별칭 전용 경고를 따로 만들
  근거는 아직 없다(만들면 3.14 등록처가 따라온다).
- **별칭의 DBML·Excel·DDL 직접 노출** — 별칭 자체를 열로 내보내는 것은 여전히 범위 밖이다(조합 이름에
  녹아 들어갈 뿐이다).
- ⚠️ **(B) 컬럼 행 배지 레이아웃이 테스트로 잠기지 않는다**(설계 3.5). jsdom 이 레이아웃을 계산하지
  않아 「경고가 있는 컬럼과 없는 컬럼의 입력란 폭이 같다」를 관측할 수 없다. 클래스 문자열을 단언하는
  것은 스타일 복사일 뿐 동작을 보지 않아 억지 테스트를 만들지 않았다 — **브라우저 스모크에서만 본다.**
- ⚠️ **「마이그레이션 전에 만들어진 그룹 행을 읽으면 `''` 가 나온다」를 테스트로 관측할 수 없다.**
  컬럼이 `NOT NULL DEFAULT ''` 라 SQL 로 `NULL` 을 넣을 수 없고, 테스트 DB 는 항상 마이그레이션이
  적용된 상태에서 시작한다. 실질적으로 확인할 수 있는 것은 **생성된 0013 SQL 이 `DEFAULT ''` 를 담고
  있는가**뿐이고 그것은 눈으로 확인했다(`ADD COLUMN "alias" text DEFAULT '' NOT NULL`).

**실사용에서 드러난 마찰** (기능 결함이 아니라 "쓰다 보면 걸리는 것" — 실제로 모델을 만들어 봐야 나온다)

> 여기 있던 **「새 테이블에 논리명을 입력해도 물리명이 자동 생성되지 않는다」는 해소됐다**(물리명 우선
> 명명 사이클). `addTable`이 물리명을 비우고, 빈 물리명 테이블은 DDL 에서 제외 + 경고로 처리한다.

- **교차 테이블 물리명이 사전 없이는 `TABLE_n`으로 떨어진다**(N:M 스모크에서 관찰). 논리명은
  `회원상품`으로 제대로 나오는데 물리명만 의미를 잃는다. 사전을 채우면 해소된다
  (`generatePhysicalName`이 `MBR_PRD`를 만든다). **위 항목이 해소된 뒤에도 남았다** — `edges.ts:134`가
  `nextTablePhysicalName`을 폴백으로 그대로 쓰기 때문이고, 물리명 우선 명명 사이클은 그 호출처를
  범위 밖으로 두고 `export`를 유지했다. 이제 DDL 이 빈 물리명을 안전하게 제외하므로 **"폴백이 꼭
  필요하다"는 전제는 사라졌다** — 교차 테이블도 물리명을 비우는 선택지가 열려 있다.

**스키마 스냅샷 드리프트 (db 스크립트 사이클에서 관찰) — 그룹 별칭 사이클에서 해소됨**
- ~~스키마를 하나도 안 고쳤는데 `pnpm db:generate` 가 마이그레이션을 하나 만든다.~~ `naming_rules`
  컬럼의 DB DEFAULT 에 `logicalSeparator` 가 빠져 있던 드리프트는 **마이그레이션 0013 이 함께 담아
  정리했다** — 예고한 대로 「다음에 스키마를 건드리는 사이클」이 그것이었다. ⚠️ **0013 이 그룹 별칭
  컬럼 하나만 담지 않는 이유가 이것이다**(`ALTER TABLE "projects" ALTER COLUMN "naming_rules" SET
  DEFAULT …` 한 줄이 함께 들어 있다). 런타임 영향은 여전히 확인하지 않았다 — DEFAULT 만의 차이이고
  실제 삽입 경로는 값을 넘긴다.

**논리명 구분자 + 상대 필드 적용 (구현 완료, 잔여)**
- **기존 논리명 일괄 변환 도구가 없다.** 설계 D3 이 배제했다 — 경고만 띄우고 사용자가 고친다.
  나중에 붙인다면 자리는 사전 화면의 「미등록 항목」 옆이고, 분해 실패 이름은 건너뛰어야 하므로
  미리보기가 필요하다.
- **명명 규칙 나머지 3개(`case`·`separator`·`maxLengthBytes`)의 설정 UI 가 없다.** 각자 기존 모델에
  미치는 영향이 다르다(특히 `separator` 를 바꾸면 물리명 전체가 재생성 대상이다).
- **`↻` 가 하던 「같은 칸에서 자기 필드 재생성」이 사라졌다.** D5 의 수용된 한계 — 이제 반대편 칸의
  화살표를 눌러야 한다. 결과는 같고 누르는 자리만 바뀐다.
- **구분자 규칙에서 옛 형식 논리명의 단어 자동완성이 좁아진다.** 밑줄 없이 이어 친 이름은 입력
  전체가 한 토큰이라 후보가 줄어든다(밑줄을 한 번 찍으면 돌아온다). 그리디로 되돌리면 설계 3.4 의
  「경계가 흔들리지 않는다」가 깨지므로 수용했고, core 케이스가 그 동작을 명시적으로 잠근다.
- **저장된 논리명의 밑줄이 토글을 꺼도 남는다는 것은 「잠그지 않는다」.** 데이터 무변경이라 UI
  테스트로 관측되지 않고, **그 명제를 직접 확인하는 테스트도 없다**(가장 가까운 것은 `strip`/`with`
  의 「구분자 없는 규칙에서 원본을 그대로 낸다」 2건인데 그것은 다른 명제다). 설계 §4 가 "core
  수준에서 확인한다"고 적었던 것을 실제에 맞게 고쳤다 — 규칙이 값을 바꾸는 코드 경로가 아예 없다는
  것이 근거이지, 테스트가 그것을 지키는 것은 아니다.

**DBML 가져오기·내보내기 (구현 완료, 리뷰가 이월로 판정한 4건)**

리뷰가 짚었고 코디네이터가 **이번 브랜치 범위 밖으로 판정**한 것들이다. 전부 non-blocking.

- **인덱스 이름이 빈 문자열이면 `name: ''` 를 낸다**(`dbml.ts` 의 `indexLines`). **현행 유지가
  판정 결과다** — 되읽으면 `''` 로 그대로 돌아와 **왕복이 성립**하기 때문이다. 설정을 아예 빼는
  편이 dbdocs 에는 자연스러워 보이지만, 그러면 가져오기가 `IX_<테이블>_<n>` 자동 이름을 붙여
  **왕복이 깨진다.** 바꾸려면 그 트레이드오프를 먼저 정해야 한다.
- **`name: fk.oneToOne === undefined ? null : fk.name`(`ddl-import.ts`)은 암묵 채널이다.**
  "이 fk 가 DBML 파서에서 왔는가"를 *다른 목적의 옵셔널 필드가 존재하는지*로 판정한다. DDL 파서가
  언젠가 `oneToOne` 을 채우면(예: UNIQUE 동반 FK 를 1:1 로 읽는 개선) **조용히 뒤집힌다.**
  명시 필드(`source: 'dbml' | 'ddl'`)나 `planDdlImport` 옵션이 안전하지만, 그 도입은 DDL 경로까지
  건드리므로 이 브랜치 범위를 넘는다. 코드 주석이 위험을 설명하고 있다.
- **dangling 인덱스 컬럼 처리가 DDL 과 DBML 에서 갈린다(선재 결함).** 같은 모델에서 DDL 은
  `CREATE INDEX IX1 ON A (NM ASC, GONE ASC)` 로 **columnId 를 이름처럼 출력**하고, DBML 은 그 컬럼을
  빼고 낸다. **DBML 쪽이 옳고 DDL 쪽이 선재 결함이다.** 모델 정합성상 dangling 은 없어야 하므로
  실사용 영향은 없다고 본다.
- **인라인 `[pk]` 와 `indexes { [pk] }` 가 공존하며 서로 다른 컬럼을 가리키면 뒤에 오는 쪽이
  `isPk` 를 잃는다.** `planDdlImport` 의 `pkOf` 가 **먼저 나온 pk 제약**만 쓰기 때문이다(DDL 파서와
  같은 규칙이고, 인라인 `[pk]` 를 pk 제약으로 정규화하면서 DBML 에도 그대로 적용됐다). **우리
  내보내기는 그 형태를 내지 않으므로 왕복에는 영향이 없고**(단일 PK 는 인라인, 복합 PK 는 indexes
  블록 — 둘이 겹치지 않는다), 애초에 두 선언이 어긋난 **모순된 입력**이다. 다만 **남의 파일에서는
  일어날 수 있고 그때 경고 없이 조용히 갈린다** — 사용자는 자기가 적은 PK 중 하나가 사라진 것을
  가져오기 미리보기에서 알 수 없다. 나중에 경고를 붙인다면 "한 테이블에 pk 제약이 둘 이상"이
  판정 조건이다.
- **Enum 타입 컬럼의 `rawType` 에 큰따옴표가 남는다** — `"ID" "status" [pk]` → `rawType: '"status"'`.
  설계 §5 의 "타입 원문으로 그대로 둔다"에는 부합하지만 따옴표째 남는다. `unknown-type` 경고가
  뜨므로 조용하지는 않다.

**물리명 우선 명명 + 필수값 표시 (구현 완료, 잔여)**
- **인덱스명에 필수 표시가 없다.** 라벨을 화면에 그리지 않는 압축 레이아웃이라 별표가 붙을 자리가
  없고, 필수임을 알리는 유일한 신호는 `required-empty` 경고 배지다. **컬럼 행 쪽은 명명 입력 UI
  개편에서 해소됐다**(세로 배치가 되어 라벨 자리가 생겼고 `FieldLabel required`가 붙는다) — 남은 것은
  인덱스명뿐이다. 설계 §5.2 의 `aria-required`는 **의도적으로 구현하지 않았다**(라벨의 sr-only
  「(필수)」와 중복 안내가 된다).
- **`ddl.ts`의 타입 변환 경고 줄이 이름 폴백을 안 거친다.** 물리명이 빈 테이블에 타입 경고가 겹치면
  `.컬럼명: …`처럼 이름 없이 뜬다. 0컬럼·빈 물리명 경고 둘만 고쳤다.
> 여기 있던 **`dict-panel.tsx`의 두 미등록 섹션 55줄 구조 중복**과 **`DEFAULT_NAMING_RULES` 하드코딩**은
> 명명 입력 UI 개편에서 **해소됐다**(`direction` prop 하나로 통합 + store 규칙 사용).

- **「재생성」 버튼이 blur 커밋 전의 값을 읽을 수 있다 — 남은 곳은 사전의 단어 편집·용어 편집
  다이얼로그 둘이다.** 편집 패널의 테이블·컬럼 두 곳은 명명 입력 UI 개편에서 닫혔다(제어 인풋의 draft 를
  컨테이너가 쥐므로 버튼이 방금 친 값을 본다). 남은 둘은 다이얼로그라 저장 버튼이 커밋을 확정하는
  동선이어서 체감이 덜하다 — 그래서 그 사이클의 범위에서 뺐다(설계 D1).

**캔버스 다중 선택 + 클립보드 (구현 완료, 잔여)**
> 여기 있던 **`selectionImpact`의 `[0]` 한정은 해소됐다**(사이드바 트랙). 이제 `tableIds` 배열을 받고,
> 삭제 수신은 `pruneSelection`으로 **사라진 것만** 걷어내며 토스트도 사라진 개수에 따라 문구가 갈린다.
> `resync`와 같은 함수를 공유해 어느 경로로 받든 결과가 같다(3.13).

- **다중 선택 바운딩 박스 드래그가 저장되지 않는다.** `onSelectionDragStart/Drag/Stop`이 배선돼 있지
  않아 화면에서는 움직이지만 재구성에서 원위치로 튄다. 선행 문제지만 다중 선택이 정식 상태가 되어
  밟힐 확률이 크게 올랐다(노드 하나를 잡아 끄는 다중 이동은 `onNodeDragStop`이 정상 저장한다).
- `planPasteColumnIds`의 **id 발급 위치 계약은 어떤 테스트로도 잡히지 않는다.** producer 안으로 옮겨도
  깨지지 않는다 — `use-model.ts`가 producer 를 정확히 한 번만 부르고 seq 불일치 시 resync 만 하기
  때문이다. 테이블 쪽은 타입이 막지만 **컬럼 쪽만 조용히 회귀할 수 있다.** 억지 테스트는 만들지 않았다.
- 컬럼 잘라내기가 테이블 선택까지 비워 곧바로 Cmd+V 가 안 된다(테이블 잘라내기와 비대칭).
- `table-node.tsx`의 `role="button"` + `aria-selected`는 ARIA 가 지원하지 않는 조합이라 보조기술이
  무시한다(선택이 시각으로만 전달).
- 메모/관계/그룹이 선택된 상태에서 빈 영역을 박스 드래그하면 `ids === []`라 조기 반환에 걸려 그 선택이
  풀리지 않는다. ⚠️ **메모·관계선 단축키가 붙으면서 그 상태에 머무는 시간이 길어졌다** — 전에는 메모를
  고를 이유가 패널 편집뿐이었는데 이제 지우고 복사하러 고른다. 원인은 그대로 `ids === []` 조기 반환이다.
- 잘라내기의 `writeText`는 fire-and-forget 이다(쓰기가 거절돼도 삭제는 진행 — undo 로 복구된다).
  **메모 잘라내기도 같은 형태를 그대로 따른다**(수용된 기존 한계).

**메모·관계선 단축키 (구현 완료, 설계가 의도적으로 배제한 셋)**

셋 다 "못 한 것"이 아니라 **설계에서 사용자와 확정해 뺀 것**이다. 다시 후보로 올릴 때는 아래 근거부터 본다.

- **관계는 복사하지 않는다**(설계 D3). 관계는 부모·자식 두 테이블과 컬럼 매핑에 의존해 **붙여넣을 때
  어느 테이블에 이어 붙일지가 정해지지 않는다.** 캔버스 클립보드 사이클이 *"관계는 복사하지 않고
  인덱스만 따라간다"* 를 정한 것과 같은 근거다. 그래서 관계선은 `Delete` 만 있고 `C`·`X`·`V` 가 없다.
- **그룹 단축키는 없다**(D4). `selectedGroupId` 가 선택된 채 `Delete` 를 눌러도 지금처럼 아무 일도
  일어나지 않는다. 요청에 없었고, 그룹 삭제는 **소속 테이블의 `groupId` 를 함께 정리**해야 해서
  메모·관계와 성질이 다르다.
- **메모 다중 선택은 없다**(D5). `selectedNoteId` 는 단일 필드로 뒀다 — 다중으로 넓히면 store · 캔버스
  선택 델타 · presence 프로토콜까지 번진다(3.13 이 테이블만 배열로 만든 것도 그 비용 때문이다).
  ⚠️ **다만 클립보드 타입은 이미 배열이다**(`notes: ClipboardNote[]`, 실제로 담기는 것은 늘 1건) —
  나중에 넓힐 때 **클립보드 포맷을 다시 바꾸지 않기 위해서다.**
- 위 D5 때문에 **「메모가 선택된 채 Delete 를 눌렀을 때 테이블이 지워지지 않는다」는 테스트로 구분되지
  않는다** — `CLEARED_SELECTION` 때문에 「테이블과 메모가 동시에 선택된」 상태에 **애초에 도달할 수
  없어서**다. 코드 주석이 그 근거를 남긴다(설계 3.1).

**메모·관계선 단축키 — 잠기지 않은 채 남은 것**

- **`planPasteNoteIds` 의 id 발급 위치 계약은 어떤 테스트로도 잡히지 않는다.** producer 안으로 옮겨도
  깨지지 않는다 — 위 클립보드 사이클의 `planPasteColumnIds` 와 **완전히 같은 성질**이고 근거도 같다
  (`use-model.ts` 가 producer 를 정확히 한 번만 부르고 seq 불일치 시 resync 만 한다). 억지 테스트는
  만들지 않았다.
- **`selectNote(null)`/`selectRelationship(null)` 의 「선택을 먼저 비우고 mutate」 순서는 잠그지
  않는다 — 잠글 수 없어서다.** 그 줄을 지워도 동작이 같다: 삭제가 반영되면 `pruneSelection`
  (→ `keptSelection`)이 모델에서 사라진 id 를 어차피 걷어낸다(3.13). 패널 버튼과의 **대칭으로**
  남기고 코드 주석이 그 근거를 적는다. ⚠️ **관측 불가능한 것을 행위 테스트로 잠그려 하지 마라** —
  이 저장소가 반복해 물린 실패 유형이고, 리뷰에서도 같은 판정이 나왔다.
  - **읽기 전용 가드 3곳은 이와 다르다. 관측 가능해서 잠갔다** — 가드가 없으면 `useSubmit` 이
    데이터는 막아 주지만 **선택이 풀리고 토스트 에러가 뜨는 UX 퇴행**이 남는다. 그래서 단언 대상은
    모델이 아니라 **선택 유지**(`selectedNoteId`/`selectedRelationshipId`)이고, Cmd+X 는
    **`writeText` 미호출**이다(mutate 보다 먼저 불려 `useSubmit` 가드가 닿지 않는 유일한 부작용).
    ⚠️ **`countModelMutate` 0 은 이 가드를 잠그지 못한다** — `useSubmit` 이 canEdit false 면 fetch
    자체를 내지 않아 가드가 있든 없든 0 이다. 회귀 방어로 함께 두되 그 단언에 기대지 마라.

**관계선 컬럼 앵커 (구현 완료, 잔여 — 리뷰 Nit 2건을 코디네이터가 이월 판정)**
- **그룹 뷰에서 좌/우 판정 근거와 노드 배치 좌표가 다르다.** `edges.ts:28` 은
  `child.position.x >= parent.position.x` 로 좌우를 정하는데 `nodes.ts:39` 는 그룹 뷰에서 노드를
  `groupPosition ?? position` 에 놓는다. `groupPosition` 이 전체 뷰와 좌우 순서가 뒤집힌 배치라면
  **그룹 뷰에서만 선이 반대편 핸들로 나간다.** **이 트랙이 만든 것이 아니다** — 기존 결함이고 설계
  3.7 이 "좌/우 판정은 바꾸지 않는다"를 못 박아 범위 밖으로 뒀다. 다만 **컬럼 앵커가 붙으면서 그
  어긋남이 눈에 더 띈다**(전에는 어느 쪽이든 노드 세로 중앙이라 티가 덜 났다). 고친다면 자리는
  `buildEdges` 가 좌우를 정하는 한 줄이고, 뷰에 맞는 좌표를 받도록 인자를 하나 더 받으면 된다 —
  다만 그 순간 `buildEdges` 가 뷰를 알아야 해서 설계 3.7 의 "위치 판정은 한 규칙" 이 흔들린다.
  **브라우저 스모크에서 그룹 뷰를 볼 때 먼저 확인하라.**
- **그룹 뷰에서 `buildGhostNodes` 가 렌더마다 두 번 돈다** — `canvas.tsx` 의 `derived` memo 와
  `edges` memo 가 각자 부른다. 기존에도 그랬지만 이제 `anchors` 까지 함께 넘기며 두 번 돈다.
  정리한다면 `useMemo` 로 한 번 계산해 둘이 나눠 쓰는 쪽이 "앵커는 한 번만 계산해 셋이 나눠 쓴다"는
  설계 3.3 의 취지와 맞는다. 성능 문제로 관측된 적은 없다.

**선택 테이블로 새 그룹 (구현 완료, 잔여)**
- **흩어진 선택으로 만든 그룹은 영역이 크고 남의 테이블을 품는다**(설계 D2의 수용된 한계). 사용자가
  보고 직접 끌어 정리한다. 걸리면 선택지는 둘 — 만들기 전에 모으거나, "선택 밖 테이블이 영역에
  들어올 때만 모아 붙이는" 배치 규칙을 새로 두거나.
- **만든 직후 그룹 이름에 자동 포커스하지 않는다.** 좌측 「그룹 추가」와 대칭을 지킨 결과다. 둘을
  함께 바꾼다면 `GroupPanel`의 이름 input에 `autoFocus`를 주는 한 곳이다.
- **서버가 뮤테이션을 거절하면 테이블 선택을 통째로 잃는다.** `selectGroup`이 낙관적 반영 시점에 이미
  선택을 비운 뒤라, 거절로 그룹이 롤백되면 그룹 선택도 `keep`으로 정리되어 **아무것도 선택되지 않은
  상태**가 남는다. 같은 패널의 드롭다운(`applyGroupMove`)은 선택을 건드리지 않아 거절 후에도 선택이
  유지되므로 **두 컨트롤이 실패 경로에서 갈린다**(리뷰가 프로브로 실측: 버튼은 `[]`, 드롭다운은
  `['t1','t2']`). **이월 판정 근거:** 거절은 드문 경로(권한 회수·op 상한·서버 오류)이고 회복 비용이
  "다시 고른다"뿐인데, 맞추려면 mutate 결과를 보고 선택을 되돌리는 경로가 생겨 **선택 상태의 진실
  원본이 둘이 된다**(3.13이 금지하는 형태). 고친다면 방향은 반대다 — 낙관적 `selectGroup`을 유지한 채
  **거절 복구에서 선택을 되살리는 규칙을 `pruneSelection` 쪽 한 곳에** 두는 것.
- **테이블 1개만 고른 상태에서는 새 그룹을 만들 길이 없다.** `BulkPanel`이 2개 이상에서만 뜨고, 1개면
  테이블 편집 패널의 「소속 그룹」 드롭다운(기존 그룹 이동)만 있다. `createGroupWith`는 1개도 그대로
  처리하므로 **막힌 것은 UI 진입점뿐이다.** **이월 판정 근거:** 이 사이클의 요청이 「여러 개를 고른
  경우」였고, 1개는 좌측 「그룹 추가」 + 드롭다운 2단계로 갈 수 있다. 붙인다면 자리는 `edit-panel.tsx`의
  단일 테이블 화면, 「소속 그룹」 바로 아래이고 같은 `createGroupWith(mutate, [tableId])`를 부르면 된다.

**N:M 교차 테이블 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-09-many-to-many-junction-design.md) 7절)**
- 교차 테이블의 **추가 속성 컬럼**(수량·단가 등)을 만들어 주지 않는다 — 만든 뒤 편집 패널에서 넣는다
- **되돌리기(교차 테이블 → 1:N)가 없다** — `cmd+Z`로 되돌리거나 교차 테이블을 지우고 다시 긋는다
- **대리키 방식을 고를 수 없다**(설계 D2가 복합 PK로 확정). 조직 표준이 대리키면 만든 뒤 대리키
  컬럼을 추가하고 두 FK의 `isPk`를 해제한 다음 UNIQUE 인덱스를 직접 만들어야 한다
- **연쇄가 깨지는 관계는 풀 수 없다**(설계 3.3). 식별 관계 또는 하위 관계가 참조하는 FK면 버튼이
  잠긴다. 사용자가 먼저 그 관계를 정리해야 하는데, 그 정리 자체가 같은 연쇄 문제를 그때 드러낸다 —
  "PK 구성 변경이 하위 관계에 미치는 영향"을 일반적으로 처리하는 것은 이 기능보다 큰 주제다
- **매핑 중복을 UI가 막지 않는다** — 관계 패널의 매핑 `<select>`가 이미 매핑된 컬럼을 후보에서 빼지
  않아 같은 컬럼을 두 행에 고를 수 있다. core·web 모두 dedup으로 방어하지만 중복 매핑 자체는 남는다
- **패널 DOM 테스트가 잠그는 것은 결과이지 호출 순서가 아니다**(설계 6.2 ⚠️). 핸들러를 `async`로 바꿔
  선택 이동을 `await mutate` 뒤로 옮겨도 최종 상태가 같아 테스트가 통과한다 — 중간 렌더에서 패널이
  한 번 비는 것은 이 스위트가 잡지 못한다
- **무결성 위반 모델에서 `resolveManyToMany`가 no-op 대신 throw** 하는 입력이 있다(매핑이 부모 테이블
  PK를 가리키는 경우). `remapRelationshipChildColumn`이 그런 모델을 거부하므로 공개 경로로는 도달 불가
- **mutation 실패 시 선택이 존재하지 않는 교차 테이블 id에 남는다** — 크래시는 없고 빈 패널이 뜬다
  (mutate 실패 처리 전반의 문제라 이 기능 밖이다)

**사이드바 다중 선택·드래그 그룹 이동 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-10-sidebar-multiselect-dnd-design.md) §11)**
- **캔버스 Backspace 가 모델을 건드리지 않는다**(선재). `onNodesDelete` 가 배선돼 있지 않아 ReactFlow
  내부 노드만 지우고 다음 store 쓰기에 되살아난다. **이 사이클은 그것을 고치지 않았다** — 고치면
  다중 선택 상태에서 **확인 없는 일괄 삭제 경로**가 생겨 설계 §7 결정(파괴적 동작은 확인을 거친다)이
  무력화된다. 고치려면 그 다이얼로그를 함께 태워야 한다
- **툴바 단일 선택 삭제에는 op 상한 가드가 없다**(설계 §7 이 의도적으로 즉시 삭제로 둔 경로). 한
  테이블에 5001개 하위 엔티티가 필요해 도달성이 낮다
- **남이 그룹을 지우면 `selectedGroupId` 가 정리되지 않는다**(선재) — `selectionImpact` 가 그룹을
  추적하지 않아 op 경로에서 `pruneSelection` 이 안 돈다. resync 경로는 정리한다 → **같은 사건이
  도착 경로에 따라 다르다.** 고치면 그룹 삭제에도 토스트가 새로 뜨기 시작해 동작 범위가 넓어진다
- **토스트 안내는 여전히 경로마다 다르다** — op 경로는 띄우고 resync 경로는 안내가 없다(선재).
  이 사이클이 맞춘 것은 *선택 상태*의 일관이다
- **`MAX_PEER_SELECTIONS`(50) 절단이 조용하다** — 51개 이상 고르면 남에게 50개까지만 보이고 안내가 없다
- **규모 비용**: `buildNodes`·`buildGroupNodes` 가 선택이 바뀔 때마다 전량을 다시 돈다(실측: 테이블
  1,000·컬럼 10,000 에서 각각 957ms·845ms, 2,000·30,000 에서 7.9s·8.2s). **박스 선택이 그 비용을
  곱한다** — xyflow 가 매 pointermove 마다 바뀐 노드마다 select 델타를 쏘기 때문이다. 루프 가드는
  "선택을 바꾸지 않는 델타"만 막아 이건 못 막는다. `tableBounds` 의 O(테이블×컬럼)도 드롭 1회당
  두 번 실린다(2,000/30,000 에서 229ms)
- **삭제 확인 다이얼로그에서 Enter 가 취소로 동작한다**(Radix 기본 포커스). 파괴적 확인의 안전한
  기본값이라 그대로 뒀다
- **드래그 중 사이드바 자동 스크롤이 없다** — 트리가 길면 화면 밖 그룹에 놓을 수 없다
- **캔버스에서 노드를 몇 픽셀만 옮겨도 사이드바가 펼쳐졌다 접힌다**(설계 5.5 의도와 일치하는 부작용).
  스모크에서 "5px 이동으로 1블록→4블록"을 관찰했다
- **터치 드래그 미검증** — `dragPoint` 의 `changedTouches` 갈래는 단위 테스트로만 잠겨 있다
- **컬럼 행 `aria-selected` 가 `role="button"` 위에 있다**(main 기존 코드). 사이드바 테이블 행은
  이 사이클에서 접근 가능하게 노출했다

**초기 MVP 잔여**
- 측정 bbox 기반 그룹 영역 크기 산정(현재는 추정치 EST_W/estHeight)
- 자동 정렬 방향 토글(TB/LR) — 현재 TB 고정
- `toolbar.tsx` `visibleTables`가 raw `activeGroupView` truthy만 판정(그룹 삭제 중 스테일 뷰에서 자동정렬 버튼 비활성) → canvas의 유효-뷰 계산과 통일
- C급 코스메틱

**도메인**
- `resolveColumn` 빈-오버라이드/dangling domainId 명시 테스트
- 도메인 삭제 summary 카피, `usageOf` 스냅샷 타이밍(단일 사용자 범위 밖)

**명명 체계**
- `duplicate-physical-table`이 `rules` 게이트 안에 있음(컬럼 중복은 항상 계산 — 스키마 정확성 경고라 항상 계산이 더 일관적)
- `reserved` 경고가 `rules` truthiness에 결합(`dialects`만 줘도 무효)
- `apps/server/src/testing/db.ts` `TEST_TABLES`에 `model_domains/model_words/model_terms/snapshots` 명시(현재는 TRUNCATE CASCADE로 무해)
- `dict-panel.tsx`의 `wordUsage` 렌더마다 재계산 → memo

**명명 입력 UI 개편 (구현 완료, 잔여)**
- **컬럼이 많은 모델에서 사이드바가 길어진다.** 세로 배치 + 라벨 2줄 + 칩 줄로 컬럼 하나당 대략
  +60px 다. 칩 줄은 미등록이 있을 때만 그리므로 사전이 채워질수록 줄어든다. 접기·가상 스크롤은
  별개 주제라 넣지 않았다(접으면 칩과 자동완성이 다시 안 보여 이 사이클의 목적과 어긋난다).
- **자동완성이 접두일치뿐이다.** 중간 일치·초성 검색은 넣지 않았다.
- **물리명 칩의 역방향 등록은 약어가 이미 정해진 채 논리명만 받는다.** 약어 자체를 고치려면 사전
  화면으로 가야 한다.
- **자동완성 목록의 시각적 위치와 칩 줄이 늘어난 뒤의 스크롤 길이는 테스트가 잡지 못한다** — jsdom 이
  레이아웃을 계산하지 않는다. 브라우저 스모크에서 본다.
- **컬럼 도메인 자동 지정을 「물리명이 빌 때만」에서 「항상」으로 넓힐지.** 리뷰 M3 에서 **옛 가드로
  되돌렸다** — 초판 구현이 `NamePair` 이관 중 가드를 빠뜨려 조용히 넓어져 있었고 테스트가 0건이라
  아무것도 빨개지지 않았다. 넓히는 쪽이 더 자연스러워 보이는 것은 사실이다(물리명을 먼저 채운 뒤
  논리명을 용어 이름으로 고치는 동선에서 도메인이 안 붙는다). 다만 **제품 동작 변경이라 사용자와
  정해야 한다** — 착수하면 설계 §3.3 과 `docs/13-naming.md`·`user-guide.md` 5절을 함께 고친다.
  지금은 「물리명이 이미 있으면 도메인을 채우지 않는다」가 가드를 잠그고 있다.
- **미등록 칩을 누르면 펼친 약어 입력으로 포커스를 옮기는 개선**(리뷰 m12 제안). 지금은 칩·「단어 등록」
  둘 다 `preventDefault` 로 **포커스가 이름 입력란에 남고**, 그것이 의도임을 테스트가 잠그고 있다.
  옮기는 편이 타이핑 흐름에 낫다는 제안이 있었으나 이 사이클 범위 밖이다 — 바꾸려면 그 두 테스트의
  기대를 함께 뒤집어야 한다.

**용어 전파 (용어 수정 시 사용처 일괄 반영 — 구현 완료, 잔여 한계)**
- **저장 클릭과 반영 클릭 사이에 남이 같은 대상을 고치면 그 변경은 건너뛴다**(`applyTermPropagation`이 `c.before` 일치를 확인). 건너뛴 항목을 사용자에게 알리지 않아, 확인 다이얼로그가 "N곳에 반영"이라 했는데 실제로는 N보다 적게 반영될 수 있다
- 저장~반영 사이에 **용어 자체가 원격 삭제**되면 `updateTerm`은 no-op인데 사용처 반영은 그대로 진행된다(존재하지 않는 용어의 물리명으로 개명됨). 확률은 낮고 undo 1회로 복구된다
- **논리명만 바꾸면 기존 `term-mismatch` 경고가 남는다** — "실제로 바뀐 필드만 전파"가 설계 결정이라 사양대로 맞는 동작이지만, 확인 다이얼로그 문구는 "일괄 반영"으로 읽혀 경고가 다 사라질 것처럼 보인다
- 물리명이 아직 생성되지 않은(빈 문자열) 엔티티는 확인 목록에서 `MBR.`처럼 어색하게 보인다(정상적인 전파 대상은 맞다 — 표시만의 문제)
- 사용처가 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 서버가 raw zod 메시지로 거절한다(사전 업로드 경로에는 있는 클라 가드가 여기엔 없음). 단일 용어로는 현실적으로 도달 불가
- 용어 **추가** 시 기존 동명 엔티티로의 전파 미지원, 모델 검사 화면에서 `term-mismatch` 일괄 해소 진입점 없음, 전파 대상 개별 선택(체크박스) 없음(현재는 전체 반영/전체 유지 2택)
- `apps/server`에 `@types/ws`가 없어 `ws.ts`의 핸들러 인자를 `unknown`/`number`로 손수 주석했다. `@types/ws`를 devDependency로 넣으면 `RawData`로 추론된다(현재 깨진 것은 없음)

**DDL/기타**
- 방언별 예약어 목록은 큐레이션 세트(전수 아님)
- 0컬럼 테이블은 DDL에서 제외 + 경고(정책 확정됨)

**DDL 역설계 파서 (인라인 제약 사이클 — 구현 완료, 잔여 한계)**
- **인용 없는 비식별자 문자로 된 컬럼명이 경고 없이 통과한다.** `IDENT_PART`의 부정 문자 클래스가
  제외하는 것은 SQL 구분자·인용 문자(`공백 ( ) , ; . " ` [ ]`)뿐이라, 그 밖의 문자로만 이뤄진 첫
  토큰은 무엇이든 컬럼 이름이 된다 — `@x`·`a-b`·`a+b`·`a*b`·`#t`·`1A`가 전부 통과한다. 의도한
  대상(`회원번호`·`🙂`)과 같은 문턱을 공유한다. **실질 영향은 경고 신호의 상실**이다(전에는
  `skipped-statement` 경고가 떠서 "이 줄을 못 읽었다"를 알 수 있었다). 정규식을 되돌리면 비ASCII
  이름이 다시 죽으므로, 고친다면 "컬럼은 만들되 이름이 비식별자 문자를 포함하면 경고를 남긴다"
  쪽이다. 사용자 실물 DDL 영향 0건.
- **테이블 수준 절 9종이 유령 컬럼이 된다**(선재 결함, 이 사이클과 무관하며 악화도 없다).
  MySQL `KEY`/`INDEX`/`FULLTEXT KEY`/`SPATIAL INDEX`, PostgreSQL `EXCLUDE USING`/`LIKE … INCLUDING`,
  Oracle `SUPPLEMENTAL LOG DATA`, MSSQL `INDEX … NONCLUSTERED`/`PERIOD FOR SYSTEM_TIME`이
  `parseCreateTable`의 항목 라우팅에 걸리지 않아 `parseColumnDef`로 떨어지고, 첫 토큰이 컬럼명·
  둘째 토큰이 타입으로 읽힌다(`KEY:IX1 (A)` 같은 컬럼이 생긴다). 라우팅에 이 접두사들을 추가해
  `skipped`로 보내는 것이 정답이다.
- **DDL에 적힌 이름이 기존 인덱스 이름과 겹치면 동명 인덱스가 2개 만들어진다**(`ddl-import.ts`
  231–239, 선재 결함). 무명 UNIQUE의 자동 이름(`UX_<table>_<n>`)은 충돌을 정확히 피하는데 DDL에
  적힌 이름은 `used` 확인 없이 그대로 쓴다. `alter table t add constraint ux1 unique (a)` +
  `create unique index ux1 on t (a)`로 재현된다. 사용자 실물 DDL은 이름이 전부 달라 무영향.
- **`detectDialect`가 사용자 실물 DDL에서 `null`을 낸다.** 컬럼 **이름** `model_columns.auto_increment`
  가 mysql 시그니처 `/\bAUTO_INCREMENT\b/i`(weight 3)에 걸려 postgresql과 3:3 동점이 되고, 동점이면
  `null`이다. 화면에서 방언을 직접 고르면 되므로 동작은 한다. 고치려면 시그니처 스캔을 컬럼 이름
  구간 밖에서만 돌리거나, 동점 시 `jsonb`·`uuid` 같은 2차 신호로 가르는 방향이다.
- **`alter table … owner to postgres`가 테이블마다 `skipped-statement` 경고를 낸다**(실물 DDL에서
  23건). 정상 동작이지만 사용자 눈에는 경고 23건으로 보인다. `OWNER TO`·`GRANT`처럼 모델과 무관한
  것이 확실한 문장은 조용히 버리는 화이트리스트를 두면 노이즈가 준다.
- **MySQL 테이블 수준 `UNIQUE KEY <이름> (컬럼들)`의 제약명이 유실된다**(`uq(-)`가 된다).
  `CONSTRAINT` 접두사가 없는 MySQL 고유 형태라 `NAMED_CONSTRAINT_RE`를 안 타고, 항목 첫머리
  `^UNIQUE` 라우팅이 이름을 읽지 않는다.
- **인용 없는 무효 제약명이 따옴표째 이름이 된다** — `CONSTRAINT 'x' UNIQUE (A)` → `uq('x')`.
  `unquoteIdentifier`가 작은따옴표를 벗기지 않는다. 4개 방언 어디서도 무효인 SQL이라 조치 불필요.
- **인라인 제약 스캔이 같은 문자열을 두 번 마스킹한다**(`parseInlineColumnConstraints`가
  `maskForKeywordScan(attrs)`를 만든 뒤 `parseReferencesClause`가 자기 입력을 또 마스킹).
  성능 문제는 없고(700KB DDL 25ms), `parseReferencesClause`가 **자기 입력을 스스로 마스킹해야
  세 호출처가 같은 계약으로 묶이므로** 현재 형태가 낫다고 판정했다. 기록만 남긴다.

**커스텀 항목**
- 조직 표준 템플릿(→ 프로젝트로 가져오기)은 범위 밖(다음 fork sub-project에서 사전·도메인과 통합 설계)
- 커스텀 항목이 있는 상태에서 그 이전 스냅샷(값 없음)을 복원하는 회귀 테스트가 없음(관대 정책상 정의는 삭제되고 값은 dangling으로 남는 것이 의도된 동작 — 고정 테스트 추가 권장)
- 테이블 scope 값 커밋 경로(`setCustomValue(m,'table',...)`) 전용 통합 테스트 없음
- '필수' 배지가 섹션 단위라 여러 필수 항목이 있을 때 어떤 항목이 비었는지 안 보임
- boolean 필드에는 required 표식(*)이 없음(현재 UI로는 required:true인 boolean을 생성할 수 없어 도달 불가 — fork/임포트로 우회 생성되면 문제)
- `custom-fields-section.tsx`의 text 입력(blur 커밋)이 `edit-panel.tsx`의 `CommitInput`과 의미상 중복(공용 파일 추출 여지 — edit-panel에서 import하면 순환이라 별도 파일 필요)
- 자동 저장 금지 가드(정의 기본값 표시 중 blur해도 저장 안 됨) 고정 테스트 없음
- CLI `custom` 필드는 CLI 트랙으로 이월(Excel 정의서 컬럼은 Excel 산출물/업로드 사이클에서 구현됨)

**공용 리소스 fork**
- **프로젝트 → 조직 리소스 승격(반대 방향)** 미구현 — 기획(`01-concepts.md` 4항)에 있으나 이번 범위에서 제외
- **행안부 표준 사전 실데이터 미확보** — 현재는 전역 라이브러리가 비어 있을 때 부팅 시 "표준 사전(예시)" 소량(도메인 3·단어 6·용어 3·커스텀 항목 2)만 시드. `91-checklist`의 "표준 사전 데이터 소싱" 미결과 연결
- `resource-sync`: 같은 배치 내 동명 added 2건은 서로에 대해 `nameClash=false`(UI 자문용, 무결성 무관)
- `resource-sync`의 `as unknown as` 캐스트 4곳, `items.update/remove`가 권한검사 전 NOT_FOUND(존재 오라클 — uuidv7이라 열거 불가, snapshot.ts 관례와 동일)
- `library.update`가 서버에만 있고 UI 경로 없음. 라이브러리 remove 테스트 없음
- 충돌 라디오 `aria-label`에 종류 수식어 없음(동명 이종 항목이면 모호), 적용 성공 토스트 없음(선택이 전부 no-op이면 무반응)
- 패널 재오픈 시 라이브러리 목록 stale(`onOpenChange`에서 refetch 권장), `plan` 참조 변경 시 `useEffect`가 진행 중 선택을 리셋할 수 있음
- `ensureStarterGlobalLibrary`의 동시 부팅 경합(단일 인스턴스면 무해), `changedFields`에 `domainId`가 허위로 낄 수 있음(표시 전용)
- customField 로컬 순서변경·origin 왕복 회귀 테스트 없음(구조적으로 성립하나 미고정)

**공용 리소스 승격 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-04-resource-promotion-design.md) §9)**
- ~~요청·승인 큐 없음~~ → **해소됨**(승격 요청 큐 사이클, 마이그 0011). 아래 "승격 요청 큐" 항목 참조
- **전역 fork 항목을 조직으로 승격하면 전역 재동기화 목록에 그 원본이 `added`로 다시 뜬다**(`nameClash`가 붙어 기본 미선택이라 중복 생성은 막히지만 매번 남는다). "무시" 상태를 기록할 자리가 모델에 없다
- **undo는 `origin`만 되돌린다** — 라이브러리에 쓴 항목은 남는다(관리 화면에서 삭제해야 한다)
- `FOR UPDATE`는 **기존 행만** 잠근다 — 서로 다른 프로젝트가 동시에 승격하면 같은 이름의 항목이 2개 생길 수 있다(`resource_items`에 `(library_id, kind, name)` 유니크 제약 없음). 데드락 경로도 이론상 존재한다(승격은 항목→라이브러리 순, `library.remove`는 반대)
- 동명 판정이 **표시 이름 완전일치**다(공백·대소문자 정규화, 동의어 매칭 없음). 대상에 동명이 여럿이면 `createdAt` 첫 항목을 고르고 사용자가 지목할 수 없다
- 프로젝트에서 지운 항목이 원본에서 사라지지는 않는다(반대 방향의 보수적 정책과 대칭)
- `parsePayload` 실패가 400으로 매핑된다(서버측 결함인데 클라 입력 오류로 보인다), `entries`에 같은 `entityId`가 중복되면 조용히 흡수된다
- 승격 진행 중에도 체크박스·일괄 버튼이 활성(제출 버튼만 비활성), 탭을 전환하면 재동기화 탭의 진행 중 선택이 초기화된다
- `EntryLabel`이 재동기화 탭과 승격 탭에 거의 동일하게 중복, `resource-panel.tsx`의 `as LibraryRow[]` 캐스트가 서버/클라 shape 드리프트를 컴파일에서 놓친다
- `planResync`는 아직 정렬 없는 순회를 쓴다(라이브러리 항목 순서에 의존해 현재는 무해하나 `planPromote`와 같은 부류의 잠재 발산)

**승격 요청 큐 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-04-promotion-request-queue-design.md) §9)**
- **알림이 폴링 배지뿐이다.** 승인자가 로그인해 있지 않으면 모른다. 메일 발송은 인프라 선택이 선행 결정이라 별도 사이클이다 — 초대·재설정이 링크로 해소된 뒤 남은 **메일 발송 인프라**(1절 "다음 작업" 1번)에 함께 얹힌다
- **배지는 `bare` 라우트(에디터)에는 뜨지 않는다.** 실제 도달 범위는 "`AppShell`을 쓰는 화면"이라 **프로젝트 오너가 에디터에 오래 머무는 동안에는 대기 요청을 못 본다.** 승인 동선이 홈·조직 화면이라 치명적이진 않으나 설계 §1.1의 "어느 화면에 있든 보인다"와 실제가 다르다
- **요청자는 자기 요청의 반려 사유를 볼 수 없다.** 조직 승인 화면에는 상태 필터(대기/승인/반려/취소)가 있어 `resolutionNote`를 읽을 수 있지만, 프로젝트 승격 탭의 요청 목록은 `pending` 고정이다. 서버 `listForProject`는 `status`를 지원하므로 막힌 것은 UI뿐이다
- **동시성은 결정적으로 테스트할 수 있다 — 다만 경합의 종류마다 기법이 다르다.** 두 `resolve`를 `Promise.all`로 쏘면 `runMutation`의 프로젝트 행 `FOR UPDATE`가 직렬화해 단언이 대칭이 된다(statusCode 정렬 `[200,409]`, 항목 1건 — flaky하지 않다). **그러나 `cancel` vs `resolve`에는 그 방법이 통하지 않았다** — 경합 창이 좁아 `Promise.all`로는 조건부 `where`를 지워도 통과했다. 그래서 그쪽 테스트(`promotion.test.ts`)는 요청 행을 밖에서 `FOR UPDATE`로 잠가 한쪽 UPDATE를 붙들어 두는 형태이고(4절의 실시간 사이클 기법과 같다), `5c81dd1`이 여기에 **`pg_locks`로 실제 대기를 확인하는 헬퍼**(`waitForLockWaiter` — `locktype='transactionid' AND NOT granted`)를 넣어 "락을 실제로 기다렸다"를 단언한다. 고정 `sleep`이면 경합이 성립하지 않은 채 조용히 통과할 수 있다 — **경합 테스트는 경합이 일어났다는 것 자체를 관측해야 한다**
- `cancel`의 read-then-write(라이브러리에는 항목이 올라갔는데 요청은 "취소됨"으로 남던 것)는 `feb54df`가 조건부 UPDATE(`and(eq(id), eq(status,'pending'))` + `rowCount === 0` → CONFLICT)로 **해소했다**
- **원자성은 `promotion` 전용 테스트가 아니라 `mutate-publish.test.ts`가 잠근다.** 보장의 소재가 `promotion`이 아니라 `mutateAndPublish`의 `prepare` 훅이고, `apps/server/src/services/mutate-publish.test.ts`의 "prepare가 쓴 행은 모델 변경과 한 트랜잭션이다"가 일반적으로 잠근다 — `resolve`의 라이브러리 쓰기와 요청 행 종결은 같은 훅 한 몸이라 그 보장을 상속한다. **`promotion` 전용 원자성 테스트는 불필요하고, `promotion_requests`가 프로젝트·라이브러리 양쪽 cascade라 만들면 오히려 가짜 통과가 되기 쉽다**(실패를 주입하려 지우면 요청 행도 함께 사라진다)
- **`loadLibraryItems`의 `orderBy(asc(createdAt))`가 어떤 서버 테스트로도 잠겨 있지 않다** — 이 정렬은 `planPromote`의 동명 선점 순서를 정하므로 조용히 바뀌면 승격 대상이 달라진다. core의 순서 결정성 테스트는 `planPromote` 함수의 성질만 보고 서버가 먹이는 순서는 검증하지 않는다. **검증 불가능한 것이 아니라 이번 범위 밖이었다** — 동명 항목 둘을 `createdAt` 명시로 직접 insert한 뒤 `promotion.get`의 `entries[0].targetItemId`가 오래된 쪽인지 보면 `asc`→`desc` 뒤집기를 확실히 잡는다. 자리는 `resource-promote.test.ts`이고 이 사이클 이전부터 있던 공백이다
- **`pendingCount`의 다중 조직 집계가 미검증이다** — `byOrg`가 2원소 이상인 경로가 한 번도 실행되지 않는다. 덮으려면 오너가 소유한 세 번째 조직 + 정렬 안정화(`orgId` 정렬 또는 `expect.arrayContaining`)가 필요하다
- **생성 후 요청을 편집할 수 없다**(항목을 더하거나 빼려면 취소하고 다시 만든다), **pending 요청이 만료되지 않는다**, **요청 시점의 상태를 저장하지 않아** 승인 화면이 "요청 당시 이랬는데 지금 이렇다"를 보여줄 수 없다, **요청자에게 결과가 푸시되지 않는다**(프로젝트 승격 탭을 열어야 안다)
- **`resolve`가 0건 승격을 포함해 `resolved`로 남긴다** — 승인자가 골랐으나 전부 `skipped`된 경우도 `resolved`이고 `approvedEntityIds`가 빈 배열인 것으로만 구분된다
- **`summary`에 실제 승격 건수를 넣을 수 없다** — `summary`는 string이라 `mutateAndPublish` 호출 시점에 확정되는데 `outcome`은 `prepare` 훅이 돈 뒤에야 채워진다. 현재는 호출 시점에 아는 값("요청 N건 중 M건 승인")을 쓴다
- 코드 정리 여지: `mutateAndPublish` 스캐폴딩이 `routers/resource.ts`와 `promotion.ts`에 축자 중복(배선이라 값이 갈리지는 않는다), `resolve`가 88줄 단일 함수, 승인 권한 규칙이 `requireScopeWrite`와 `pendingCount`의 `inArray`에 따로 표현(`ORG_WRITE_ROLES` 공유 상수 권장), `promotion.get`이 요청 행을 통째로 스프레드, `org-detail.tsx`의 `canManage` 식 중복, 요청 경로의 op 상한 가드·요청 메모(`note`)·대기 목록의 `libraryId` 필터·목록의 `isError` 알림·`resolve`의 `onError` 토스트가 미검증

**Excel 산출물/업로드**
- **"변경분 정의서" 시트 미구현** — 스냅샷 diff 기반이라 diff 화면과 함께 설계(의도적으로 남긴 유일한 시트)
- **테이블·컬럼 커스텀 항목 "값"의 Excel 업로드 미지원**(내보내기만) — 테이블·컬럼 식별 규칙(물리명? id?)이 따로 필요해 별도 사이클
- **선택 테이블 범위 내보내기** — `ExportScope`의 `{kind:'tables'}`는 타입만 있고 UI 없음
- 도메인 허용값의 쉼표 왕복 한계(값 자체에 쉼표가 있으면 분리됨)
- 대량 업로드는 `MAX_OPS_PER_MUTATION`(5000)이 천장 — 초과 시 UI가 막고 파일 분할 안내(청크 적용 미구현)

**스냅샷 diff**
- 라벨 2차 정렬(같은 종류 안 `localeCompare`)·`labelOf`의 relationship/index/tableGroup/customField/term/note 분기 미테스트
- 키 누락의 역방향(base에만 있고 target 엔티티엔 없는 필드) 미테스트
- 비교 화면의 `normalize()`를 실증하는 테스트 없음(core가 컬렉션 기본값을 자체적으로 채워 크래시는 안 남)
- select 상호작용·다운로드 버튼 호출·relationship 클릭 분기 미테스트
- `useMemo`가 실효 없음 — `normalize`가 매 렌더 새 객체를 만들어 의존성 identity가 매번 바뀐다(소규모 모델이라 체감 없음)
- `type Side = 'current' | string`이 사실상 `string`(타입 안전성 없음, 실 id가 UUIDv7이라 충돌 불가)
- `snapshot-diff.tsx`가 `in` 연산자를 쓰는데 core는 `Object.hasOwn` 관례
- 참조 대상 이름이 우연히 같으면 `이전값 = 이후값`인 변경 행이 나온다(판정은 id 기준이라 의도된 동작이나 감리 문서에선 혼동 소지)
- **Revision 단위 diff 미지원**(현재는 스냅샷·현재 시점 단위). 이력 화면 확장은 별도
- diff에서 선택 항목만 되돌리는 "선택 복원" 미지원(스냅샷 전체 복원만)
- 배치 좌표 변경 이력 보기 없음(좌표는 diff에서 의도적으로 제외)

**실시간 동시편집**
- **다중 인스턴스 미지원** — 허브가 인메모리 단일 인스턴스 전제. 스케일아웃 시 Redis pub/sub 브리지 필요하고, 그때 `publishOps`/`peers`를 async로 바꿔야 한다(현재 동기 API라 `mutateAndPublish`가 fire-and-forget으로 부른다)
- **`actorUserId`/`actorName`이 브로드캐스트되지만 클라가 안 쓴다** — 같은 사용자의 다른 탭에서 온 변경에도 "다른 사용자가…" 토스트가 뜬다. `msg.actorUserId !== me.id`로 게이트하거나 `${actorName}님이…`로 카피에 쓰면 둘 다 해소된다
- **peer 이름 라벨이 테이블에만 있다** — 설계·계획 산문은 관계·메모에도 이름 라벨을 약속했으나 구현은 테이블만(관계는 `EdgeLabelRenderer`가 필요해 까다롭다). 계획 산문을 고치든 라벨을 추가하든 정리 필요
- **`PresenceBar` 위치가 설계와 다름** — 설계는 "캔버스 좌상단", 구현은 헤더 우측 클러스터. 헤더 쪽이 더 나아 보이나 문서화되지 않은 드리프트
- 좌표 이동만으로도 "수정했습니다" 토스트가 뜬다(`selectionImpact`가 `position` 변경을 구분하지 않음) — 남이 내가 선택한 테이블을 반복 드래그하면 토스트가 연달아 뜬다
- 소켓 인바운드 rate limit·payload cap 없음(`ws` 기본 `maxPayload` 100MiB). `selection` 프레임 1건이 채널 전체 presence 팬아웃을 유발하는데 스로틀은 클라 측에만 있다. `app.register(fastifyWebsocket, { options: { maxPayload: 64*1024 } })` 한 줄로 완화 가능
- 클라이언트 측 liveness 감지 없음(하트비트가 서버→클라 단방향) — half-open 소켓이면 TCP가 포기할 때까지 조용히 아무것도 못 받는다. 복구 자체는 `ready.seq` 불일치로 정상 동작
- `PEER_SELECTION_KINDS`·`PeerSelectionKind`·`PEER_PALETTE`가 core 밖에서 안 쓰임, `RealtimeHub.connectionCount`는 테스트 전용(공개 표면 정리 여지)
- DB 조회 실패 시 앱 레벨 close code가 아니라 1011로 닫힌다(인증 단계 실패는 4401/4403). 리포에 eslint 설정이 아예 없어 `react-hooks/exhaustive-deps`가 안 돌고, `canvas.tsx`의 `eslint-disable` 주석도 실효가 없다

**권한 (역할 기반 읽기 전용 — 구현 완료, 잔여 한계)**
- 읽기 전용 판정은 `project.get` 응답에 의존한다. 다른 사용자가 내 역할을 낮춰도 **내 화면은 새로고침 전까지 편집 가능 상태로 남는다**(실시간으로 권한 변경을 밀어주지 않는다). 서버가 막으므로 데이터는 안전하고, 편집 시도가 토스트로 거절된다
- Org Owner/Admin은 프로젝트 멤버가 아니어도 항상 `canEdit`·`canManage`가 참이다(`perm.ts`의 기존 정책 그대로)
- presence에서 Viewer와 Editor를 구분해 표시하지 않는다
- `domain-edit-dialog`·`custom-field-edit-dialog`, 그리고 `dict-panel.tsx`의 `WordEditDialog`·`TermEditDialog`에는 권한 분기가 없다. 부모 패널이 여는 추가·수정 버튼을 숨겨 도달 불가이기 때문이다 — 나중에 다른 곳에서 이 다이얼로그들을 렌더하면 가드를 추가해야 한다(`useSubmit` 가드가 저장은 막는다)
- **프로젝트 전환 시 권한이 fail-closed로 초기화되지 않는다.** `reset()`은 프로덕션에서 호출되지 않고 `setLoaded`도 권한을 건드리지 않으므로, 프로젝트 A→B 전환 시 `project.get(B)`가 도착할 때까지 A의 권한이 남는다. 실제 위험은 낮다 — `httpBatchLink`가 `model.get`/`project.get`을 한 요청으로 묶어 사실상 동시에 도착한다. 남는 창은 `project.get`만 에러일 때뿐이고 그때는 fail-open이 된다(서버가 막으므로 데이터는 안전, 대신 FORBIDDEN 바운스가 발생). 고친다면 `useModelLoader`에서 `projectId` 변경 시 초기화해야 하며, **`setLoaded` 안에 넣으면 안 된다** — mutation 실패 롤백이 같은 함수를 쓰므로 Editor가 잠긴다.
- **잔여 커버리지 구멍:** `toolbar.tsx`의 Cmd+Z 가드(리포 전체에 키보드 단축키 테스트가 0건), `group-panel.tsx`의 색상 입력 `disabled`(같은 성격의 `note-panel`만 검증됨), `relationship-panel.tsx`의 관계명 `readOnly`·컬럼 매핑 select `disabled`, `resource-panel.tsx`의 충돌 라디오 숨김(테스트 픽스처에 충돌 항목이 없어 미도달), `ghost-node.tsx`의 `isConnectable` 배선(`ghost-nodes.ts`가 이미 `connectable:false`라 실질 no-op).

**DDL 역설계 (구현 완료, 잔여 한계)**
- **가져온 컬럼의 도메인이 비어 있다.** 내보내기가 도메인을 타입으로 풀어 쓰므로 DDL에 도메인의 흔적이 없다. 타입만 채우고 `domainId`는 `null`이다 — 도메인 자동 매칭은 후속
- **왕복이 깨지는 조합이 5건 있다**(`JSON`→oracle/mssql, `DATE`·`TIME`→oracle, `UUID`→mysql). 내보내기 매핑이 단사가 아니어서 생기는 성질이고 `dialect.test.ts`의 `ROUND_TRIP_LOSSES`에 상수로 고정돼 있다. `toDialectType`을 고치면 이 목록도 함께 봐야 한다
- **Oracle `TIMESTAMP`는 의도적으로 `DATETIME`으로 읽는다.** 우리 매핑상 `TIME`으로 읽으면 왕복이 살아나지만 실무 Oracle DDL의 `TIMESTAMP`는 거의 항상 일시다
- 기존 테이블과의 **병합·재동기화가 없다** — 이름이 겹치면 건너뛴다. 운영 DB가 바뀐 뒤 다시 가져오는 시나리오는 미지원
- `CHECK` 제약을 도메인 허용값으로 변환하지 않는다(건너뛰고 경고)
- 파서는 `CREATE TABLE`·`ALTER TABLE ADD CONSTRAINT`·`CREATE INDEX`·`COMMENT ON`만 안다. 뷰·프로시저·트리거·시퀀스는 건너뛴다
- **인덱스 컬럼의 정렬 방향(`ASC`/`DESC`)이 유실된다.** 파서의 `identifierList`가 방향 토큰을 버려 계획 타입에 자리가 없고, 적용 시 전부 `'asc'`로 고정된다
- **관계 카디널리티가 항상 `1:N`이다.** 자식 FK 컬럼에 `UNIQUE`가 걸린 1:1 관계도 `1:N`으로 저장된다. 계획 단계가 UNIQUE 제약을 관계 판정에 쓰지 않기 때문이다
- **컬럼 인라인 `UNIQUE`(`ID INT UNIQUE`)를 파싱하지 않는다.** `ParsedColumn`에 자리가 없다. `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE`와 테이블 제약 `UNIQUE (...)`는 유니크 인덱스로 정상 합류한다
- **`0개 테이블 만들기` 버튼이 눌러도 반응이 없다.** 만들 것이 0개여도 버튼이 활성이고, 눌러도 다이얼로그가 닫히지 않으며 토스트도 없다. 기능적으로는 안전(빈 Revision이 생기지 않고 모델도 불변)하나 사용자에게는 먹통으로 보인다 — 비활성화하거나 안내 후 닫는 편이 낫다
- **MSSQL 코멘트는 왕복하지 않는다.** 내보내기가 `EXEC sys.sp_addextendedproperty`로 내는데 그 문장 형태는 파싱 범위 밖이다. 구조는 왕복하고 논리명만 물리명으로 떨어지며 경고가 남는다. 이 동작은 테스트로 고정돼 있어 나중에 `sp_addextendedproperty` 파싱을 구현하면 그 테스트가 깨져 재검토를 강제한다

**CLI 트랙 A (구현 완료, 잔여 한계)**
- `erdd.config.yaml`의 방언·명명 규칙은 pull 시점 사본이다. 서버에서 바꾸면 다음 pull 전까지 로컬 `validate` 결과가 서버와 다를 수 있다
- 파일에 `notes`·배치 좌표·`origin`을 담지 않는다. 트랙 B의 `push`는 "파일에 없는 것은 서버에서 건드리지 않는다"를 계약으로 지켰다(`applyMerge`가 서버 값을 그대로 통과시킨다 — 아래 "CLI 트랙 B" 이월 참조)
- 토큰에 만료가 없다. 폐기만 가능하다
- npm 공개 배포 파이프라인이 없다
- **인덱스 컬럼 방향을 `"MBR_NM DESC"` 한 문자열로 적는다.** 물리명이 정확히 `' ASC'`/`' DESC'`로 끝나면 되읽기가 모호하다. 사용자 판단으로 현행 유지했고, 기존 `ddl-parse.ts:209`도 리포 전역으로 같은 가정을 쓴다
- **`pull`의 네 단계 쓰기는 원자적이지 않다.** 중단되면 base가 트리보다 오래된 상태로 남아 다음 `status`가 오탐한다. 순서를 뒤집으면 낡은 트리를 **숨기게** 되어 더 나쁘므로 "시끄럽게 틀리는" 쪽을 의도적으로 골랐다(`pull.ts`에 주석 있음). `pull --yes` 재실행으로 수렴한다
- **`validateModelIntegrity`는 CLI `validate` 경로에서 죽은 코드다.** `filesToModel`이 파싱 단계에서 참조 실패를 전부 잡고 키===id를 보장하므로 `ok:true`인 모델에서는 8개 검사가 구조적으로 도달 불가하다. `filesToModel`이 느슨해질 때의 방어망으로 남겨 뒀다
- **`tokensEqual`(`apps/server/src/auth/token.ts`)은 호출처가 없다.** 인증이 `tokenHash` unique 인덱스 조회 한 방이라 상수시간 비교를 쓸 자리가 없다
- **`context.ts`의 `lastUsedAt` UPDATE가 인증 경로 안에 있다.** 이 쓰기가 실패하면 유효한 토큰도 인증 실패가 된다. 현재 단일 `pg.Pool`이라 실사용 리스크는 낮으나 리드 레플리카 도입 시 재검토 대상
- **토큰 발급 화면의 "복사" 버튼이 `navigator.clipboard` 결과를 확인하지 않는다.** 비-HTTPS 환경에서 복사되지 않아도 성공 토스트가 뜬다
- **CLI의 깨진 YAML·손상된 JSON이 `CliError`로 감싸이지 않고** 원본 예외가 새어 `run()`이 `NETWORK`로 감싼다(파일 파싱 실패에 `NETWORK`는 의미상 부정확)
- **`erdd/tables/` 아래에 `.yaml`로 끝나는 디렉터리가 있으면** `writeTree`가 `EISDIR`로 실패하고 최상위 파일 정리까지 건너뛴다

**CLI 트랙 B (구현 완료, 잔여 한계 — → [설계](specs/2026-08-04-cli-push-design.md) §9)**
- 배열 안 원소 단위 병합 없음 — `index.columns` 한 원소만 달라도 필드 전체가 충돌한다
- 충돌의 대화형 해소 없음 — `erdd pull`로 서버 변경을 받은 뒤 파일에서 손으로 정리한다
- 한 push가 `MAX_OPS_PER_MUTATION`(5000)을 넘으면 거부한다. 대규모 최초 push(300테이블+)는 청크가 필요한데 "단일 Revision = undo 1회" 계약과 상충하므로 별도 설계 대상이다
- `push`가 `notes`·좌표·`origin`을 절대 건드리지 않는다 — 파일에서 메모를 관리할 수 없다(트랙 A 이월과 동일한 제약)
- `--json` 실패 응답이 `{error:{code,message}}`와 `{ok:false,conflicts:[…]}` 두 형태다. 충돌은 오류가 아니라 **계획 결과**라 후자를 쓴다(exit 1은 동일)
- `expectedSeq` 재시도는 1회다. 매우 활발한 프로젝트에서는 반복 실패할 수 있다
- ~~**`push`는 비멱등 쓰기다** — 커밋 후 응답이 유실되면 다음 push가 조용히 사본을 만든다~~ → **해소됨**(CLI push 멱등성 사이클, → [설계](specs/2026-08-05-cli-push-idempotency-design.md)). `filesToModel`이 신규 id를 채운 트리를 함께 내고 `push`가 전송 직전 그것을 **원래 파일 경로에** 기록한다(3.9절). 서버 변경·마이그레이션 없음
- `skill install`은 Claude Code 형식만 낸다(`AGENTS.md`는 범위 밖)

**CLI push 멱등성 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-05-cli-push-idempotency-design.md) §9)**
- **서버는 여전히 멱등이 아니다.** 같은 요청을 그대로 두 번 보내면 리비전이 둘 생긴다. CLI는 재전송을 하지 않으므로 이 경로를 만들지 않지만, 다른 클라이언트가 `model.push`를 직접 쓰면 가능하다. 막으려면 `revisions.request_id`(마이그레이션)가 필요하다
- **기록된 id는 회수되지 않는다.** push가 영영 실패하고 사용자가 그 항목을 파일에 남겨 두면 서버가 모르는 id가 계속 있고 `status`가 계속 "로컬 변경"이라고 말한다(맞는 표시이나 지우는 길이 없다)
- **push가 실패해도 기록 대상 파일이 한 번 재작성된다** — YAML 재직렬화라 주석·서식이 사라진다. 트리는 원래 pull마다 재작성되므로 새로운 종류의 손실은 아니지만, **실패 경로에서도 일어나는 것은 이번에 생긴 동작**이다. `id`가 매핑 맨 뒤에 붙는 것(`modelToFiles`는 맨 앞)도 push가 성공하면 `syncDown`이 정규화한다
- **던져서 끝나는 경로의 봉투에는 `reservedFiles`가 없다.** `push.ts`가 직접 만드는 두 봉투(conflicts · op 상한 초과)에는 실었지만, `throw err`로 `run()`이 만드는 봉투 — 서버 거절(UNAUTHORIZED·FORBIDDEN·NOT_FOUND·VALIDATION)과 **CONFLICT 2회** — 는 그대로다. 둘 다 재시도 뒤에 닿을 수 있고 그때 워킹트리는 이미 재작성돼 있다. `CliError`에 `details`가 생겼으므로 수단은 이미 있다
- **`reserveIds`의 `rel in local` 가드와 `mkdir`은 프로덕션에서 도달하지 않는다.** `assigned`는 `localTree`의 `structuredClone`이라 키 집합이 항상 같다(실측: 가드를 지워도 cli 전부 통과 — `canonical(undefined)`가 `undefined`라 우연히 같은 결과가 난다). `reserve-ids.test.ts`는 그 갈래를 검증하는데 `tree.ts` 주석은 "닿지 않는다"고 적어 둘이 다른 이야기를 한다 — 방어 코드로 남기는 것 자체는 타당하나 어느 쪽이 사실인지 한 번 정리해야 한다
- **id를 나르지 않는 공유 참조는 검사에 걸리지 않는다.** `idOf`를 지나지 않는 자리(두 도메인이 같은 `dialectTypes` 매핑을 alias로 공유하는 것 등)는 합쳐질 id가 없어 3.9절 검사의 대상이 아니고, 그 파일이 기록 대상이 되면 `stringifyYaml`이 `&a1`/`*a1` 같은 **생성된 이름**으로 anchor를 다시 쓴다(이름이 바뀌는 것은 주석·서식 손실과 별개다)
- **전송 실패 시 자동 재시도는 없다** — 사용자가 다시 실행해야 한다(exit 1 유지). 보고 문구가 "다시 push하면 중복 없이 수렴합니다"로 바뀌었고, 그 문장이 이제 참이다

**초대 링크·비밀번호 재설정 링크 (구현 완료, 잔여 한계 — → [설계](specs/2026-08-06-invite-and-reset-links-design.md) §9)**
- **메일이 없다.** 링크는 화면에 뜨고 **관리자가 복사해 전달한다.** 비밀번호를 잊은 사용자는 스스로
  복구할 수 없고 관리자에게 알려야 한다. 발송을 붙일 때 이 설계의 토큰·화면은 그대로 두고 한 겹만
  얹으면 된다(1절 "다음 작업" 1번)
- **승격 요청 큐의 알림은 여전히 폴링 배지뿐이다** — 메일이 선행이라 이번에 얹을 것이 없었다
- **로그인 화면에 "비밀번호 찾기"가 없다.** 메일이 없는 상태에서 두면 미인증 공개 엔드포인트가 계정
  존재 여부 탐색·스팸 표면이 되는데, 어차피 관리자가 링크를 전달해야 하므로 그 대가를 치를 이유가
  없다고 보고 뺐다(설계 §2.3). 메일을 붙일 때 함께 검토한다
- **토큰이 브라우저 히스토리에 남는다.** `/invite/:token`·`/reset/:token`의 경로 자체가 토큰이다.
  **Referer 쪽은 닫혔다** — `apps/web/index.html`의 `<meta name="referrer" content="no-referrer">`.
  기본 정책(`strict-origin-when-cross-origin`) 아래서는 동일 출처 요청에 전체 URL이 붙어 nginx 표준
  combined 로그의 `$http_referer`에 `/trpc` 요청 한 줄마다 평문 토큰이 남았다. **문서 단위로 끈 것이
  의도다**(링크 단위 `referrerPolicy`가 아니라) — 토큰을 URL에 담은 것이 그 문서이므로 나중에 tRPC를
  거치지 않는 요청이 붙어도 자동으로 덮인다. **jsdom은 fetch에 `Referer`를 세팅하지 않아 헤더 자체는
  테스트로 재현할 수 없다** — `src/index-html.test.ts`가 태그의 존재만 잠그고 실제 헤더는 브라우저
  스모크로 확인한다. **2026-08-09 스모크에서 실측으로 닫혔다** — 토큰이 박힌 `/invite/:token` 화면에서
  로컬 에코 서버(`nc -l 127.0.0.1 5199`)로 요청을 받아 헤더를 봤더니 `Referer` 헤더 자체가 없고 토큰
  문자열은 0회 등장했다. 히스토리는 이월 — 마운트 직후 `history.replaceState`로 경로에서 토큰을 지우면
  된다(토큰은 이미 컴포넌트 상태에 들어와 있어 동작에 지장이 없다). 링크가 관리자→본인 직접 전달이라
  위험이 낮다고 보고 남겼다
- **링크를 잃으면 재발급뿐이다**(평문 재조회 없음 — 액세스 토큰과 같은 성질)
- **만료된 초대·재설정 행에 자동 정리가 없다** — 쌓인다(조회는 인덱스로 처리되나 청소 작업이 없다)
- **초대 수락 후 자동 로그인하지 않는다** — 로그인 화면으로 보낸다. 세션 발급 경로를 `auth.login`
  하나로 유지하는 대가로 사용자가 한 번 더 입력한다
- **재설정 링크 발급이 감사 로그를 남기지 않는다**(`createdBy`는 행에 있으나 조회 화면이 없다)
- **관리자가 적은 이름을 수락 화면에 프리필하지 않는다** — 이름은 수락자가 백지에서 정한다. 하려면
  스키마부터 열어야 한다(`invitations.name` nullable + `invite`의 optional 입력 + `peek` 반환 +
  수락 화면의 `defaultValue`). **마이그레이션 0012를 다시 여는 일**이고 얻는 것은 이름을 한 번 덜 치는
  것뿐인 데다, 초대 행이 "누구에게 어떤 자격을 준다" 밖의 프로필 정보를 들게 된다
- **동시 소비 가드에 테스트가 없다.** `invitation.accept`와 `auth.resetPassword`의 소비는 둘 다
  `usedAt IS NULL` 조건부 UPDATE라 같은 토큰으로 동시에 들어온 둘 중 하나만 통과한다 — 이 성질은
  **코드 검토로만 확인됐다.** 조건절을 지워도 순차 테스트는 전부 통과한다(순차로는 첫 요청이 이미
  `usedAt`을 채운 뒤라 두 번째가 `assertLive`에서 걸린다). 실증하려면 트랜잭션 둘을 원하는 지점에서
  교차시켜야 하는데 그 장치가 이 스위트에 없다 — **승격 요청 큐가 쓴 기법**(요청 행을 밖에서
  `FOR UPDATE`로 잠그고 `pg_locks`로 실제 대기를 확인)이 그대로 옮겨올 자리다
- **`auth.resetPassword`가 `users.isActive`를 보지 않는다.** `admin.users.resetLink`는 비활성 계정을
  거절하지만 그것은 **발급 시점**만 막는다. 비활성화 **이전에** 발급된 링크는 살아 있고,
  `setActive(false)`는 세션만 지울 뿐 미사용 재설정 토큰을 만료시키지 않는다. **계정 접근으로는
  이어지지 않는다**(`auth.login`이 `isActive`에서 막고 세션도 이미 지워져 있다) — 남는 것은 "비활성
  계정의 해시가 바뀐다"뿐. 다루려면 결정이 하나 필요하다: **비활성화가 그 사용자의 미사용 초대·재설정
  토큰까지 함께 만료시켜야 하는가**(세션을 지우는 것과 같은 급으로 볼 것인가). 그렇다고 정하면
  `setActive(false)`에 UPDATE 한 건이 붙고 `auth.resetPassword`의 `isActive` 검사는 필요 없어진다
- **`accept` 경로에서 scrypt 해싱이 열린 트랜잭션 안에서 돈다**(3.10절) — 초대 수락은 드문 경로라
  지금은 감당되지만 같은 패턴을 빈번한 경로로 복사하면 커넥션 고갈이다. 해시를 미리 계산해 넘기려면
  `createAccount`가 `passwordHash`를 받아야 하는데, 그것은 "정규화·개인 조직이 갈라지지 않는다"는
  그 함수의 존재 이유와 상충한다

**웹 UI 전수 대조에서 나온 것** (2026-08-10 `docs/manual/user-guide.md` 작성 + 교차 리뷰. 매뉴얼을
쓰려면 모든 화면 문구를 코드에서 확인해야 해서, 기능 검토와는 다른 각도로 걸러졌다)

> 여기 있던 **`deleteKeyCode='Backspace'` 가 모델 삭제로 이어지지 않는다**는 **이미 해소됐는데
> 목록에 남아 있던 것**이라 2026-08-12 에 지웠다(깜박임 사이클에서 발견). 지금 `canvas.tsx` 는
> `deleteKeyCode={null}` 로 React Flow 의 삭제를 끄고 **`useEditorShortcuts` 가 삭제를 전담**하며,
> 다중 선택은 확인 다이얼로그를 거친다. 테스트도 Backspace 를 눌러 **모델까지** 확인한다.
> 이 문서가 경고한 그 패턴이다 — 고친 사이클에서 이월 목록을 함께 지우지 않으면 다음 세션이
> 끝난 일을 후보로 고른다.
- **편집 패널에 `comment`·`defaultValue`·`autoIncrement` 입력이 없어 산출물 열이 영구히 빈다 —
  실사용 마찰이다.** `edit-panel.tsx` 에 `comment` grep 0건이고 `ColumnRow`(215~299행)에 기본값·
  자동증가 입력이 없다. 새 컬럼은 `column-edits.ts:17~18` 에서 `defaultValue: null,
  autoIncrement: false` 로 고정 생성되고 그 뒤 바꿀 UI 가 없다. **지금 드러난다** — Excel
  「테이블정의서」의 「설명」·「기본값」 열(`excel-sheets.ts:29~32`)과 「테이블 목록」의 「설명」 열이
  웹만 쓰는 프로젝트에서 **전부 빈 칸으로 제출된다.** 감리 제출이 목적인 산출물이라 눈에 띈다.
  반대로 DDL 역설계로 들어온 값(`ddl-import.ts` 가 `COMMENT ON`·`DEFAULT`·자동증가를 반영한다)은
  웹에서 보이지도 지우지도 못한다 — 컬럼을 삭제하는 것 말고는 손댈 방법이 없다. 입력란 3개 추가로
  끝나는 작업이다
- **`project.update` 는 서버에만 있고 호출부가 0건이다 — 실사용 마찰이다.**
  `routers/project.ts:79~91` 이 이름·설명·`dialects`·`namingRules` 를 받는데
  `grep -rn "project.update" apps/web/src apps/cli/src` → **0건**. `pages/project-settings.tsx` 는
  이름·설명·방언·내 역할을 읽기 전용 배지로만 보여주고 편집 폼은 프로젝트 멤버뿐이다.
  **지금 드러난다** — 프로젝트를 만들 때 고른 방언을 되돌릴 수 없어(오타로 MSSQL 을 빼면 프로젝트를
  다시 만들어야 한다) 명명 규칙은 손댈 수 없다. `docs/13-naming.md:24~29` 가 약속한 설정 화면이
  통째로 없는 것이다. 서버·스키마·기본값이 다 준비돼 있어 **화면만 붙이면 되는 상태**다
- **`dict-panel.tsx:37` 이 프로젝트 명명 규칙 대신 `DEFAULT_NAMING_RULES` 를 쓴다.** 같은 store 값을
  쓰는 다른 소비자들(`naming-check.tsx:36`, `edit-panel.tsx:54`, `ddl-import-dialog.tsx:26`,
  `dict-import-section.tsx:20`)과 이 한 곳만 다르고, 코드 주석도 "Task 6에서 … 교체한다"로 남아 있다.
  **지금은 드러나지 않는다** — 규칙을 바꿀 UI 가 없어(위 항목) 모든 프로젝트가 기본값과 같다.
  위 `project.update` 화면을 붙이는 순간 「미등록 단어」 탭만 옛 규칙으로 계산해 모델 검사 건수와
  어긋난다 — **그 작업의 필수 동반 수정**이다(한 줄)
- **`relationship.identifying` 과 FK 컬럼의 `isPk` 가 모델에서 묶이지 않아 사용자가 볼 수 없는 상태가
  생긴다.** 컬럼 「PK」 체크박스(`edit-panel.tsx:341~342`)는 `isPk` 만 바꾸고 역방향 동기화가 없다.
  **좁게 드러난다** — 교차 테이블 가드(`relationship.ts:231~238`, `edges.ts:122~129`)가 막아 주므로
  데이터는 깨지지 않지만, 버튼이 왜 잠겼는지를 문구로만 알 수 있고 그 상태를 **눈으로 확인할 방법이
  없다.** `warnings.ts` 에도 이 불일치를 잡는 종류가 없다 → 경고 한 종을 추가하는 것이 값이 크다
- **비밀번호 재설정 링크에 목록·명시적 회수가 없다**(초대에는 둘 다 있다 —
  `admin.invitations.list`/`revoke`). 실효 회수 경로는 있다: 재발급이 그 사용자의 미사용 토큰을
  죽인다(`routers/admin.ts:89~96`). **`docs/manual/install.md` 9.5 가 이미 그것을 문서화**했으므로
  운영자 쪽은 닫혔고, 남은 틈은 관리자 화면 문구(`pages/admin.tsx:142~145`)에 같은 안내가 없다는 것
- **기획 문서(`docs/10~18`)에 있으나 구현되지 않은 것 15건** — 매뉴얼 작성 중 전수 확인했고, 확인되지
  않은 것은 문서에서 뺐다(그래서 매뉴얼은 구현된 것만 설명한다). 값이 큰 것은 넷이다 —
  ① 프로젝트 명명 규칙·방언·이름 편집 화면(`13-naming.md:24~29`, `01-concepts.md:126` / 위
  `project.update` 항목과 같은 뿌리), ② 내보내기 범위의 "선택 테이블"(`17-import-export.md:20` —
  core 의 `DdlScope` 에 `{kind:'tables'}` 가 있고 `export-scope-select.tsx:8` 주석이 "이 UI 에서
  만들지 않는다"고 적어 둔, **엔진은 되고 UI 만 없는** 상태), ③ DDL 가져오기의 파일 업로드
  (`17-import-export.md:44` — 지금은 텍스트 영역뿐), ④ 다중 선택 후 그룹 일괄 배정
  (`12-grouping.md:18` — `setTableGroup` 호출부 둘 다 단일 대상). 나머지 11건은 노드 접기·복사
  붙여넣기·컬럼 순서 드래그·컬럼 단위 관계 드래그·인덱스 "탭"·도메인의 별도 일괄 반영 액션·
  테이블·컬럼 설명 입력·컬럼 기본값·자동증가 입력·스냅샷 설명 입력·자동 정렬의 "선택 테이블" 범위·
  인덱스 정렬 방향 역설계다(뒤 셋은 위 `comment`·`defaultValue` 항목과 겹친다).
  ⚠️ **주의**: `17-import-export.md:40` 의 이미지 내보내기는 "전체 뷰 또는 그룹 뷰 단위"만 약속했고
  코드가 그대로 동작하므로 **갭이 아니다** — 한때 갭으로 셌던 것을 정정했다

---

## 7. 새 세션 시작 프롬프트 (복사해서 사용)

```
ERDD 프로젝트를 이어서 작업한다. 먼저 CLAUDE.md(반드시 지킬 작업 규칙)와
docs/superpowers/HANDOFF.md(현재 상태·아키텍처 불변식·환경·작업 방식)를 순서대로 읽어라.

CLAUDE.md의 규칙은 예외 없이 지킨다 — 특히 메모리 기능에 프로젝트 지식을 저장하지 않는 것
(알게 된 것은 문서에 쓰고 커밋한다), 최상위에서 브랜치를 갈아타지 않는 것,
커밋은 경로를 명시해 스테이징하는 것.

다음 작업: <6절 이월 항목 정리 | 사용자가 실제로 쓰다 걸린 것 중 하나>를 고른다.
계획해 둔 작업이 모두 끝나 정해진 다음 작업이 없다 —
착수 전 브레인스토밍으로 범위를 사용자와 먼저 확정해라. HANDOFF.md의 "작업 방식"대로
brainstorming(설계 결정 확인) → spec → plan → SDD 구현/리뷰 → 최종 리뷰 → 브라우저 스모크 → main 머지
순서로 가라.
```

> 마지막 문단에 실제로 고를 것을 채운다. 예: "메일 발송을 붙인다(초대·재설정 링크 자동 전달 + '비밀번호 찾기' + 승격 요청 알림이 함께 해소된다)" / "실제 DB 접속 스키마 스캔을 붙인다" / "6절 이월 항목을 정리한다".
