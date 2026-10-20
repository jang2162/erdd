# ruler 바꿈 (ERDD)

## `AGENTS.md` 만은 생성물이지만 커밋한다

바꾸는 절: `ruler/00-sources.md` 「지침 소스는 `.ruler/` 이고 에이전트가 읽는 파일은 생성물이다」

| 구분 | 파일 |
| --- | --- |
| 소스(수정 대상) | `.ruler/*.md`, `.ruler/skills/` |
| 설정 | `.ruler/ruler.toml` |
| 생성물(직접 수정 금지) | `AGENTS.md`(Claude Code 도 이것을 읽는다), 에이전트별 설정·스킬 경로(`.mcp.json`, `.codex/config.toml`, `.claude/`, `.agents/` 등), 이들의 `.bak` |

생성물에 지침을 써 넣지 않는다. 지침을 고치려면 소스를 고치고 `ruler apply` 를 돌린다.

**생성물 중 `AGENTS.md` 하나만 git 에 추적한다.** `.gitignore` 의 Ruler 블록에 `/AGENTS.md` 가 있어도 이미 추적 중인 파일이라 ignore 가 듣지 않는다. 나머지 생성물(`.mcp.json`, `.codex/config.toml`, `.claude/skills`, `.agents/skills`)은 커밋하지 않고, 루트 `package.json` 의 `prepare` 가 `pnpm install` 때 만든다.

`.ruler/<스택>/` 과 `docs/guideline/` 은 `guideline` CLI 가 지침 서버에서 받은 **사본**이다. 직접 고치지 않는다 — 고칠 것은 `guideline propose` 로 올린다(에이전트는 `guideline-export` 스킬). 직접 고친 사본은 다음 `guideline update` 에서 건너뛰어지거나 원본과 조용히 갈라진다.

- **Why:** 생성물은 다음 apply 에서 통째로 덮어써진다. 생성물이 소스로 다시 읽히는 설정이면 apply 마다 자기 자신을 덧붙여 중복 헤더로 오염된다. `AGENTS.md` 를 추적하는 것은 `pnpm install` 전의 새 클론·새 워크트리에서도 에이전트가 지침을 받게 하려는 것이다 — 그 시점에는 `prepare` 가 아직 돌지 않았다.
- **How to apply:**
  - 어떤 파일이 생성물인지 헷갈리면 `.ruler/ruler.toml` 의 에이전트 목록과 `.gitignore` 의 Ruler 블록을 본다. 블록 안에 있으면 생성물이다.
  - `AGENTS.md` 를 손으로 고치지 않는다. 추적 파일이라 손으로 고친 것도 커밋에 실리고, 다음 apply 가 조용히 되돌린다.
  - 새 생성물 경로가 추적되고 있으면(`git ls-files` 에 나오면) `git rm --cached` 로 뺀다. `AGENTS.md` 만 예외다.

## `ruler apply` 는 저절로 돌지 않는다 — 소스를 고친 턴에 직접 돌리고 바뀐 `AGENTS.md` 를 함께 커밋한다

바꾸는 절: `ruler/00-sources.md` 「`ruler apply` 는 저절로 돌지 않는다 — 소스를 고친 턴에 직접 돌린다」

`prepare` 스크립트에 걸어 둔 apply 는 **install 할 때만** 돈다. 소스를 고쳤다고 돌지 않는다.

- **Why:** `AGENTS.md` 밖의 생성물은 gitignore 되어 `git status` 에 뜨지 않는다. 안 돌려도 경고가 없고 리뷰에도 안 걸리므로, 다른 에이전트와 다음 세션이 낡은 지침을 최신인 줄 알고 주입받는다. 원칙과 나머지 근거는 `base` 스택 「생성물을 직접 편집하지 않는다」 절.
- **How to apply:** 저장소 루트에서 apply 를 돌린 뒤 `git status` 를 본다. **바뀌는 추적 파일은 `AGENTS.md` 뿐이어야 정상이다**(생성물 경로가 새로 생겼으면 `.gitignore` 블록도 바뀐다). 소스 변경과 바뀐 `AGENTS.md` 를 같은 커밋에 싣는다. 그 밖의 추적 파일이 바뀌었으면 생성물이 추적되고 있는 것이다 — 위 절대로 추적에서 뺀다.
  ```bash
  pnpm exec ruler apply
  git status
  ```
