# 구현 전 구체화 체크리스트

구현 착수 전에 결정·문서화가 필요한 항목을 추적한다. 위에서 아래 순서로 진행하고, 완료 시 체크하고 결과가 반영된 문서를 링크한다.

## Phase 1 착수 전 (필수)

- [x] **아키텍처** — 기술 스택, 데이터 계층(상태 + op 로그), identity 모델(UUIDv7), 스냅샷·diff 전략 → [02-architecture](02-architecture.md)
- [x] **논리 타입 체계** — 논리 타입 17종과 문법, 4방언 기본 변환 표, 자동증가, 관대한 파싱 정책 → [14-domain](14-domain.md)
- [x] **관계(FK) 편집 시맨틱** — 하이브리드 생성, 식별 전환 자동 처리, 부모 PK 변경은 확인 후 일괄 반영, 삭제 시 FK 컬럼 보존, 자기참조·다중 관계 허용 → [10-editor](10-editor.md)
- [x] **계정·온보딩** — 관리자 계정 생성(셀프 가입·메일 인증은 추후), 이메일+비밀번호 로그인, 암묵적 개인 조직, 멤버 직접 추가 → [18-account](18-account.md)
- [x] **CLI 파일 포맷 내부 명세** — `id` 필드 규칙(신규 객체는 id 없이 작성, push 시 발급), 파일명≠identity 확정 → [16-cli](16-cli.md). JSON Schema 작성은 구현과 병행

## Phase 2 착수 전

- [x] **단어 분해 알고리즘** — 논리명 앞에서부터 **최장 일치 그리디** 토큰화, 매칭 실패 구간은 `unknownWords`로 모아 경고. 동의어·영문/한영 혼합 특수 처리는 없음(사전에 등록된 단어면 매칭, 아니면 미등록 경고) → `packages/core/src/naming.ts`, [설계](superpowers/specs/2026-07-26-phase2-naming-design.md)
- [x] **Term 물리명 관리** — Term은 물리명을 **저장값**으로 보유(파생 아님). 명명 규칙 변경 시 기존 물리명은 그대로 두고 경고로만 알림(`too-long`/`term-mismatch`). 컬럼 물리명은 자동생성 시점의 스냅샷이며 논리명 재입력·"재생성"으로만 갱신 → `packages/core/src/naming.ts`, `warnings.ts`
  - **용어 수정 시 사용 중 컬럼 일괄 반영** 구현 완료(2026-08-01). 용어 저장 시 사용처가 있고 실제로 바뀐 필드가 있으면 확인 다이얼로그로 "유지 / N곳에 반영"을 묻고, 반영은 용어 수정과 **한 Revision**으로 묶여 undo 1회로 함께 원복된다. 사용처는 **수정 전 논리명** 기준으로 확정하며, 도메인은 `null → 값`·`값 → 다른 값`만 전파한다(용어에서 도메인을 떼도 컬럼 도메인은 보존) → [설계](superpowers/specs/2026-08-01-term-propagation-design.md), `apps/web/src/editor/dict-edits.ts`
- [x] **공용 리소스 fork/재동기화 구조** — 원본 참조는 op 엔티티의 `origin` 필드(`{libraryId, sourceId, sourceVersion, base}`), `base`는 가져온 시점에 프로젝트 공간으로 투영한 payload라 3-way 병합이 core 순수 함수로 닫힌다. 전역+조직 2계층. 충돌은 항목별 3상태(보류/프로젝트 유지/원본 반영) → [설계](superpowers/specs/2026-07-28-phase2-shared-resources-fork-design.md)
- [x] **Excel 산출물 상세 양식** — 시트 5종 확정. 테이블 목록(그룹·논리명·물리명·설명·비고), 테이블정의서(그룹·테이블 논리/물리명·순번·논리명·물리명·도메인·타입·PK·NOT NULL·기본값·설명 + 커스텀 항목 컬럼), 단어사전(논리명·약어·영문명·설명), 용어사전(용어·구성 단어·물리명·기본 도메인·설명), 도메인정의서(이름·분류·논리 타입·방언 4종·기본값·허용값·설명). **내보내기 헤더와 업로드 파서가 같은 상수를 공유해 왕복 가능**(예외: 용어사전 `구성 단어`는 파생값이라 업로드 시 무시) → [설계](superpowers/specs/2026-07-28-phase2-excel-import-export-design.md)
- [x] **표준 사전 데이터 소싱** — 출처·라이선스·갱신주기 확인 완료(2026-08-01 조사). 공공데이터포털에서 CSV 직접 다운로드(로그인 불필요), 오픈API(JSON/XML)도 제공. **이용허락범위 "제한 없음"·무료**, 갱신주기 **연간**(차기 등록 예정일 2026-11-01). 최신은 2025-11-01 기준 8차 제·개정본.
  | 데이터셋 | 건수 | ERDD 매핑 |
  |---|---|---|
  | [공통표준단어](https://www.data.go.kr/data/15156439/fileData.do) | 3,284 | `Word` — 단어명→`logicalName`, 영문약어명→`abbreviation`, 영문명→`englishName` (완전 대응) |
  | [공통표준용어](https://www.data.go.kr/data/15156379/fileData.do) | 13,176 | `Term` — 용어명→`logicalName`, 영문약어명→`physicalName`, 공통표준도메인명→`domainId`(이름 해석) |
  | [공통표준도메인](https://www.data.go.kr/data/15156442/fileData.do) | 129 | `Domain` — 데이터타입+데이터길이+소수점길이를 `logicalType`으로 **조립 필요**, 허용값→`allowedValues`, 도메인분류명→`category` |
  - 버전 관리: `resource_items.version`(정수)이 이미 있어 항목별 버전 관리가 가능하다. 전역 라이브러리 시드는 `ensureStarterGlobalLibrary`가 **op 로그 밖 직접 insert**라 16,589건 적재에 op 제한이 없다.
  - ⚠️ **미결(구현 시 결정)**: 프로젝트로 **가져오기(fork)는 op를 태운다** — `MAX_OPS_PER_MUTATION`(5000)에 걸려 용어 13,176건 통째 가져오기는 불가. 선택 가져오기가 정상 사용 경로이므로 "전체 가져오기" 진입점이 있다면 거기서 막거나 청크 적용이 필요하다(Excel 사전 업로드도 같은 벽을 "파일을 나눠 올려주세요"로 처리 중).
  - ⚠️ **미결(구현 시 결정)**: 연간 갱신 반영 방식(오픈API 폴링 vs 수동 재적재), 개정된 항목의 `version` 증가와 기존 fork 프로젝트로의 재동기화 알림 정책.

## Phase 3 착수 전

- [x] **실시간 프로토콜 상세** — 전송은 WebSocket(`@fastify/websocket`), 채널은 `/ws?projectId=`. **인증은 업그레이드 시 `erdd_session` 쿠키 재사용**(별도 티켓 없음, tRPC와 동일한 신뢰 경계·동일한 `canView` 판정), 실패는 예외가 아니라 close code(4401 미인증 / 4403 권한 없음). Viewer도 접속·수신·presence 가능(편집 차단은 `model.mutate`의 `'edit'` 게이트가 담당). **재수화는 간극 크기와 무관하게 항상 전체 리로드**(`model.get`) — "마지막 수신 seq 이후 revisions 재전송" 경로는 만들지 않았다. 수신 op는 기존 `serializeMutation` 직렬화 체인에 태워 낙관적 mutation과의 경합을 구조적으로 차단하고, `seq`가 연속이면 `applyOps`·과거면 무시(에코)·간극이면 전체 리로드. presence는 영속화 없는 별도 메시지로 참여자 **전체 목록**을 매번 전송(델타 아님), 사용자 색은 서버가 배정하지 않고 `peerColor(userId)`로 클라가 결정론적으로 계산 → [설계](superpowers/specs/2026-07-29-phase3-realtime-collab-design.md)
  - 미결(후속): 다중 인스턴스 배포 시 Redis pub/sub 브리지(허브가 인메모리 단일 인스턴스 전제), 편집 중 텍스트의 문자 단위 병합(현재는 필드 확정 단위 LWW), presence에 "편집 중" 상태를 선택과 구분해 표시
- [x] **diff 화면과 변경분 정의서** — 표시 전용 `diffModelsForDisplay`(적용용 `diffModels`와 분리), 기준/비교 각각 선택(현재+스냅샷), 결과는 종류별 목록 + 속성별 before/after. 변경분 정의서는 한 시트 flat(구분·대상·변경유형·속성·이전값·이후값) + 1행에 비교 대상 표기. **배치 좌표는 비교에서 제외**(옮기기만 해도 전체가 변경으로 잡히면 정의서가 무의미), 참조형 속성(domainId·groupId·custom 키 등)은 이름으로 해석해 UUID가 문서에 나오지 않게 한다 → [설계](superpowers/specs/2026-07-28-phase3-snapshot-diff-design.md)

## Phase 4 착수 전

- [ ] **CLI 상세** — base 사본 저장 방식, push 충돌 출력 형식, `--json` 출력 스키마, 패키지명 확정(현 `schemantic` 가칭 → ERDD 네이밍 정리)
- [ ] **에이전트 스킬 문서** — 동봉할 SKILL.md 내용 설계
- [ ] **DDL 역설계 범위** — 지원 방언별 파싱 범위와 한계, 파서 라이브러리 선택

## 추후 검토 착수 전 (현재 비범위)

- [ ] **과금 플랜** — 티어 구성, 제한 항목, 결제 연동. 조직 내 실무 도구 완성이 최우선 목표라 후순위로 이동(→ [90-roadmap](90-roadmap.md), [00-vision](00-vision.md))

## 구현 중 결정해도 되는 세부

- Note의 그룹 뷰 표시 여부, "미분류" 상태의 그룹 뷰 제공 여부 ([12-grouping](12-grouping.md))
- 브라우저 지원 범위, 접근성 기준
- 이력 화면의 페이지네이션·Revision 보존 정책
