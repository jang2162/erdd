# public-docs 바꿈 (ERDD)

## README 와 사용자 문서는 한국어 한 벌만 둔다

바꾸는 절: `public-docs/03-i18n.md`

`README.md` 와 `docs/manual/` 의 문서는 한국어 원본 한 벌이다. 영어 원본·번역본(`README.ko.md`, `docs/manual/<lang>/`)·언어 전환 줄·`docs/manual/glossary.md`·`translation` 이슈를 두지 않는다.

다른 public-docs 파일의 다국어 항목도 이 프로젝트에서는 따르지 않는다.

| 파일 | 따르지 않는 것 | 대신 |
| --- | --- | --- |
| `00-readme.md` | 섹션 표의 「언어 전환 줄」 행과 「영문 제목」 열 | 같은 뜻의 한국어 제목을 쓴다 |
| `00-readme.md`·`02-manual.md`·`06-readme-template.md` | `docs/manual/<lang>/` 경로 | `docs/manual/` 로 읽는다 |
| `04-style.md` | 「어조(영어)」, 영어 원어 ↔ 번역어 대응표 | 같은 대상에 같은 이름을 쓰는 규칙은 따른다 |
| `06-readme-template.md` | 영어 뼈대, 언어 전환 줄, `README.ko.md` 만들기 | 섹션 순서만 참고한다 |
| `07-release-check.md` | 번역본 반영·언어 전환 줄 확인 항목 | — |

- **Why:** 문서가 전부 한국어로 쓰여 있고 다른 언어판이 없다. 이 바꿈이 없으면 README 나 매뉴얼을 고치는 에이전트가 원본 지침대로 영어 원본을 만들고 매뉴얼을 언어 폴더로 옮기려 한다 — 매뉴얼 경로를 가리키는 README·지침의 링크가 함께 끊긴다.
- **How to apply:** 다른 언어를 더하기로 했으면 사용자에게 확인한 뒤 이 절을 걷는다. 걷으면 원본 `03-i18n.md` 가 다시 적용되어 영어가 원본이 된다 — 한국어를 원본으로 둘 거면 그 판단을 새 바꿈 절로 적는다.

## 사용자 문서는 `docs/manual/` 바로 아래에 둔다

바꾸는 절: `public-docs/02-manual.md` 「README 가 길어지면 사용자 문서는 `docs/manual/` 아래 언어 폴더로 나눈다」

사용자 문서는 언어 폴더 없이 `docs/manual/` 바로 아래에 둔다. 어떤 문서가 있고 기능을 바꿀 때 무엇을 함께 고치는지는 `.ruler/project.md` 「필수 참조 문서」 의 `docs/manual/` 항목이 갖는다. 목표별 안내를 하위 폴더로 나눌 때는 `guides/` 가 아니라 `how-to/` 로 짓는다. README 의 문서 링크는 `docs/manual/` 의 문서만 가리킨다.

- **Why:** 언어가 한 벌이라 언어 폴더는 경로만 한 단계 늘린다(「README 와 사용자 문서는 한국어 한 벌만 둔다」). `docs/guides/` 는 개발 규칙의 정본 자리라, 사용자 안내를 `guides` 라 부르면 두 갈래가 이름으로 섞인다.
- **How to apply:** 매뉴얼을 옮기거나 이름을 바꾸면 README 「시작하기」 와 지침의 매뉴얼 경로도 함께 고친다.
