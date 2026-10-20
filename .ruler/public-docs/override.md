# public-docs 바꿈 (ERDD)

## README 가 길어지면 사용자 문서는 `docs/manual/` 아래 언어 폴더로 나눈다

바꾸는 절: `public-docs/02-manual.md` 「README 가 길어지면 사용자 문서는 `docs/manual/` 아래 언어 폴더로 나눈다」

언어 폴더(`docs/manual/en/` 원본, `docs/manual/ko/` 번역본)·`docs/manual/README.md`(언어 선택 + 목차)·`docs/manual/glossary.md`·`docs/manual/images/` 는 원본 절대로 둔다. 다르게 하는 것은 언어 폴더 **안**이다 — 원본 절 파일 트리의 `getting-started.md`·`how-to/`·`configuration.md`·`reference.md`·`troubleshooting.md` 대신, 언어 폴더마다 아래 네 편을 이 파일 이름 그대로 둔다.

| 파일 | 다루는 것 |
| --- | --- |
| `local-guide.md` | 로컬 모드 — 서버 없이 쓰는 길을 처음부터 끝까지 |
| `user-guide.md` | 브라우저 에디터의 기능별 레퍼런스 |
| `cli-guide.md` | `erdd` 명령 레퍼런스·파일 포맷·충돌 처리·CI |
| `install.md` | ERDD 서버 설치·운영 |

네 편을 더하거나 나누거나 이름을 바꾸지 않는다. 바꿔야 하면 사용자에게 확인한 뒤 이 절을 고친다. 기능을 바꿀 때 네 편 중 무엇을 함께 고치는지는 `.ruler/project.md` 「필수 참조 문서」 의 「제품 동작·화면 문구를 바꿨을 때」 항목이 갖는다.

- **Why:** 네 편은 서로를 상대 링크로 수십 번 가리키고, `packages/cli/scripts/bundle-docs.mjs` 가 이 네 이름을 언어 폴더마다 찾아 npm 패키지에 동봉한다. 이름을 바꾸거나 나누면 문서끼리의 링크, 패키지 README 의 동봉 문서 링크, 동봉 검사가 함께 깨진다.
- **How to apply:** 새 내용은 네 편 중 목적이 맞는 문서의 절로 넣는다. 원본 절의 나머지(README 는 입구이고 매뉴얼은 상세 안내, 목표별 안내 폴더 이름은 `how-to/`, README 의 Documentation 섹션은 `docs/manual/<lang>/` 문서만 링크)는 따른다.

## 문서마다 목적이 하나이고, 위에 요약을, 아래에 다음 문서를 둔다

바꾸는 절: `public-docs/02-manual.md` 「문서마다 목적이 하나이고, 위에 요약을, 아래에 다음 문서를 둔다」

원본 절의 다섯 문서(`getting-started`·`how-to/<topic>`·`configuration`·`reference`·`troubleshooting`)로 나누지 않는다. 네 편의 목적은 「README 가 길어지면 사용자 문서는 `docs/manual/` 아래 언어 폴더로 나눈다」 의 표가 정한다. 한 편 안에 처음 해 보기·레퍼런스·문제 해결이 함께 들어가도 된다 — 그때는 절 제목으로 목적을 가른다.

각 문서 맨 위의 한 문장 요약과 대상 독자, 맨 아래의 다음에 읽을 문서 링크는 원본 절대로 둔다.

- **Why:** 사용자가 지금의 네 편을 유지하기로 정했다. 다섯 문서로 재편하면 「README 가 길어지면 사용자 문서는 `docs/manual/` 아래 언어 폴더로 나눈다」 의 바꿈이 지키는 링크와 동봉 구조가 깨진다.
- **How to apply:** 새 내용을 쓸 때는 다섯 문서 중 하나를 고르는 대신 네 편 중 하나와 그 안의 절을 고른다.
