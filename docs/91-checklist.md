# 구현 전 구체화 체크리스트

구현 착수 전에 결정·문서화가 필요한 항목을 추적한다. 위에서 아래 순서로 진행하고, 완료 시 체크하고 결과가 반영된 문서를 링크한다.

## Phase 1 착수 전 (필수)

- [x] **아키텍처** — 기술 스택, 데이터 계층(상태 + op 로그), identity 모델(UUIDv7), 스냅샷·diff 전략 → [02-architecture](02-architecture.md)
- [x] **논리 타입 체계** — 논리 타입 17종과 문법, 4방언 기본 변환 표, 자동증가, 관대한 파싱 정책 → [14-domain](14-domain.md)
- [x] **관계(FK) 편집 시맨틱** — 하이브리드 생성, 식별 전환 자동 처리, 부모 PK 변경은 확인 후 일괄 반영, 삭제 시 FK 컬럼 보존, 자기참조·다중 관계 허용 → [10-editor](10-editor.md)
- [x] **계정·온보딩** — 이메일+비밀번호 로그인, 암묵적 개인 조직, 멤버 직접 추가 → [18-account](18-account.md)
  - **계정 생성·비밀번호 재설정을 일회용 링크로 교체** 구현 완료(2026-08-06). 관리자는 이메일과 서비스 역할을 정해 초대 링크를 발급할 뿐이고 이름·비밀번호는 수락자가 정한다. 재설정도 링크 발급이며 **발급만으로는 비밀번호가 바뀌지 않고 세션도 유지된다** — 사용자가 링크를 열어 새 비밀번호를 정할 때 바뀌고 그때 그 사용자의 세션이 전부 삭제된다. 조직 Owner/Admin은 미가입자에게 조직 초대 링크를 낼 수 있다(수락하면 계정·개인 조직·조직 합류가 한 트랜잭션으로 처리된다). 결과적으로 **관리자 화면에 비밀번호 입력란이 하나도 남지 않았다** → [설계](superpowers/specs/2026-08-06-invite-and-reset-links-design.md)
  - ⚠️ **미결(메일): 링크를 사람이 전달한다.** 초대·재설정 링크는 화면에 뜨고 관리자가 복사해 슬랙·구두로 전달한다. 발송자 선택·도메인 인증·발송 실패 처리·개발 환경 발송 차단이 선행 결정이고, 그것이 붙어야 로그인 화면의 "비밀번호 찾기"와 승격 요청 큐 알림도 함께 해소된다(아래 "메일 발송 인프라"). **완전 개방형 셀프 가입**(도메인 허용목록·가입 요청 승인 큐)과 **소셜 로그인**은 여전히 비범위다
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
- [x] **권한 세분화** — 검토 결과 **새 권한 축 미도입**. 그룹 단위 편집 권한은 `column`·`relationship`·`index`의 그룹 귀속 판정과 사전·도메인 예외 처리가 필요해 비용 대비 실익 미확인, 표준 축(사전·도메인) 분리는 `ENTITY_KINDS`로 구현은 싸지만 필요 미확인. 실제 필요는 "이미 있는 역할이 UI에 반영되지 않는 것"이었고 그것만 해소했다 → [설계](superpowers/specs/2026-08-01-viewer-readonly-ui-design.md)

## Phase 4 착수 전

- [x] **CLI 상세** — base는 `.erdd/base.json` 단일 JSON(사람이 열어볼 대상이 아니므로 분할하지 않음). `--json` 출력 스키마는 트랙 A 4개 명령(`init`/`pull`/`status`/`validate`)분을 확정(명령별 평면 객체, 공통 봉투 없음, 오류는 `{"error":{"code","message"}}`). 패키지명 `@erdd/cli`·바이너리 `erdd`로 확정. **push 충돌 출력 형식**은 트랙 B에서 확정: **블록형**(파일별 그룹 + 기준/로컬/서버 값), 판정 단위는 **필드 단위**, `--json`은 오류 봉투가 아니라 `{ ok: false, conflicts: […] }`(충돌은 오류가 아니라 계획 결과라서 exit 1은 동일하되 형태를 구분) → [설계](superpowers/specs/2026-08-03-cli-pull-design.md), [트랙 B 설계](superpowers/specs/2026-08-04-cli-push-design.md)
- [x] **에이전트 스킬 문서** — 동봉할 `SKILL.md`는 `packages/cli/skill/SKILL.md`. `erdd skill install`이 `.claude/skills/erdd/SKILL.md`로 복사하며, `--dir`로 설치 위치 재지정·`--force`로 기존 파일 덮어쓰기를 지원한다. 내용은 파일 구조 파악·pull→수정→validate→diff→push 워크플로·물리명 짓기(용어 우선, 없으면 단어 조합)·도메인/커스텀 항목 지침·하지 말 것 목록 → [설계](superpowers/specs/2026-08-04-cli-push-design.md)
- [x] **DDL 역설계 범위** — 손으로 쓴 좁은 파서(파서 라이브러리 미도입, `packages/core`의 무의존 원칙 유지). 범위는 "우리 내보내기의 왕복 + 실무 구문" — `CREATE TABLE`(인라인 PK·REFERENCES·자동증가·MySQL 인라인 COMMENT), `ALTER TABLE ADD CONSTRAINT`, `CREATE [UNIQUE] INDEX`, `COMMENT ON`. `CHECK`·파티션·트리거·시퀀스·권한은 건너뛰고 경고. 타입 역매핑은 보수적 기본값 + 대안 경고이며 **왕복이 깨지는 5건**을 테스트에 상수로 고정했다. 논리명은 코멘트 → 사전 → 물리명 순 → [설계](superpowers/specs/2026-08-03-ddl-reverse-engineering-design.md)

## 추후 검토 착수 전 (현재 비범위)

- [ ] **메일 발송 인프라** — 발송자 선택(SES/Postmark 등), 도메인 인증, 발송 실패 처리, 개발 환경의 발송 차단. 여기에 얹히는 것이 셋이다: 초대·재설정 링크 자동 전달(→ [18-account](18-account.md)), 로그인 화면의 "비밀번호 찾기", 승격 요청 큐 알림(현재는 폴링 배지뿐). **토큰·화면은 이미 있고 발송 한 겹만 얹으면 된다** → [초대·재설정 링크 설계](superpowers/specs/2026-08-06-invite-and-reset-links-design.md)
- [ ] **과금 플랜** — 티어 구성, 제한 항목, 결제 연동. 조직 내 실무 도구 완성이 최우선 목표라 후순위로 이동(→ [90-roadmap](90-roadmap.md), [00-vision](00-vision.md))

## 구현 중 결정해도 되는 세부

- Note의 그룹 뷰 표시 여부, "미분류" 상태의 그룹 뷰 제공 여부 ([12-grouping](12-grouping.md))
- 브라우저 지원 범위, 접근성 기준
- 이력 화면의 페이지네이션·Revision 보존 정책
