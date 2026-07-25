# Phase 1 M8 — 이미지 내보내기(PNG/SVG) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 캔버스(전체 뷰 또는 활성 그룹 뷰, 현재 보기 모드)를 PNG 또는 SVG 이미지로 내보낸다.

**Architecture:** 02-architecture의 선택대로 `html-to-image`를 React Flow의 뷰포트 DOM(`.react-flow__viewport`)에 적용한다. 현재 캔버스에 렌더된 노드(테이블·메모·색상영역·그룹뷰의 고스트)를 그대로 캡처하므로, "범위"는 이미 화면 상태(활성 뷰·보기 모드)로 결정된다 — 별도 범위 선택이 필요 없다. 노드 bounding box(`getNodesBounds`)로 이미지 크기를 잡고 1:1 배율로 캡처해 현재 팬/줌과 무관하게 다이어그램 전체를 담는다. 서버·core 변경 없음(순수 웹).

**Tech Stack:** React 19, @xyflow/react(`getNodesBounds`, `useReactFlow`), `html-to-image`(신규 의존성), vitest.

## Global Constraints

- 출력: PNG(래스터, 2x pixelRatio) / SVG(벡터). 파일명 `erdd.<ext>`(프로젝트명은 모델에 없어 고정 접두, 후속에 개선).
- 캡처 대상: `.react-flow__viewport`(노드·엣지만 포함, 미니맵·컨트롤·배경격자는 형제 요소라 제외됨). 배경은 도면 paper 색(`#F7F8FA`)으로 채운다.
- 크기: `getNodesBounds(nodes)` + 여백(MARGIN 48px), 배율 1(네이티브 해상도). 현재 팬/줌 상태와 무관.
- 노드가 0개면 "내보낼 노드가 없습니다" 오류(토스트)로 막고 다운로드하지 않는다.
- 활성 뷰(전체/그룹)와 보기 모드(논리/물리/혼합)는 캔버스에 이미 반영돼 있으므로 캡처가 자동으로 그 상태를 담는다. 별도 옵션 없음.
- 순수 웹. 서버/DB/core 변경 없음.
- `html-to-image`의 실제 이미지 렌더는 jsdom에서 단위 검증이 불가하므로 순수 헬퍼(파일명)만 단위 테스트하고, 실제 PNG/SVG 산출은 컨트롤러 브라우저 스모크로 확인한다.
- 한국어 UI, 커밋 메시지 한국어.

## 범위 밖

- 프로젝트명 기반 파일명(모델에 name 필드 도입 시), 해상도/여백 옵션, 특정 영역만 잘라 내보내기, PDF. Excel 산출물(Phase 2).

---

## File Structure

**web (신규):**
- `apps/web/src/editor/image-export.ts` — `downloadCanvasImage(rf, opts)`, `imageFileName(base, format)`.
- `apps/web/src/editor/image-export.test.ts` — `imageFileName` 단위 테스트.

**web (수정):**
- `apps/web/package.json` — `html-to-image` 의존성.
- `apps/web/src/editor/export-dialog.tsx` — DDL | 이미지 탭 토글 + 이미지 섹션.
- `apps/web/src/editor/export-dialog.test.tsx` — 이미지 탭 렌더 테스트 추가.

---

## Task 1: 이미지 내보내기 유틸 + 의존성

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/editor/image-export.ts`, `apps/web/src/editor/image-export.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ImageFormat = 'png' | 'svg'
  imageFileName(base: string, format: ImageFormat): string
  downloadCanvasImage(rf: ReactFlowInstance, opts: { format: ImageFormat; fileName?: string }): Promise<void>
  ```

### 설계 (읽고 시작)

- `html-to-image`를 설치한다: `pnpm --filter @erdd/web add html-to-image`(package.json + lockfile 갱신).
- `imageFileName`: base가 비면 `erdd`. 파일명에 안전하지 않은 문자를 `_`로 치환(한글·영숫자·`.`·`-`는 허용). `\`${safe}.\${format}\``.
- `downloadCanvasImage`:
  - `rf.getNodes()`가 0개면 `throw new Error('내보낼 노드가 없습니다')`.
  - `.react-flow__viewport` 요소를 찾는다(없으면 `throw new Error('캔버스를 찾을 수 없습니다')`).
  - `getNodesBounds(nodes)` → `{ x, y, width, height }`. MARGIN=48. `width = ceil(b.width)+96`, `height = ceil(b.height)+96`.
  - style로 캡처 시 변환을 덮어쓴다: `transform: translate(\${MARGIN-b.x}px, \${MARGIN-b.y}px) scale(1)`, `width/height`.
  - `toPng`/`toSvg`(html-to-image)에 `{ width, height, style, backgroundColor: '#F7F8FA', pixelRatio: 2 }` 전달 → dataURL.
  - `<a download>`로 다운로드.
- **import 검증**: `getNodesBounds`가 `@xyflow/react`에서 export되는지 typecheck로 확인. v12.11.2에 없다면(이름 상이) 실제 export 이름으로 교체(예: `getRectOfNodes`는 v11 이름 — v12는 `getNodesBounds`).

### Steps

- [ ] **Step 1: html-to-image 설치** — `pnpm --filter @erdd/web add html-to-image` 실행, package.json에 추가됐는지 확인.

- [ ] **Step 2: 실패 테스트** — `image-export.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { imageFileName } from './image-export.js'

describe('imageFileName', () => {
  it('확장자를 붙인다', () => {
    expect(imageFileName('erdd', 'png')).toBe('erdd.png')
    expect(imageFileName('erdd', 'svg')).toBe('erdd.svg')
  })
  it('빈 base는 erdd로 대체', () => {
    expect(imageFileName('', 'png')).toBe('erdd.png')
  })
  it('안전하지 않은 문자를 _로 치환하고 한글·영숫자는 유지', () => {
    expect(imageFileName('회원 스키마/v1', 'png')).toBe('회원_스키마_v1.png')
  })
})
```

- [ ] **Step 3: 실패 확인** — `pnpm --filter @erdd/web test image-export` → FAIL(모듈 없음).

- [ ] **Step 4: image-export.ts 구현**

```ts
import { toPng, toSvg } from 'html-to-image'
import { getNodesBounds, type ReactFlowInstance } from '@xyflow/react'

export type ImageFormat = 'png' | 'svg'

const MARGIN = 48
const PAPER = '#F7F8FA'

export function imageFileName(base: string, format: ImageFormat): string {
  const trimmed = base.trim()
  const safe = (trimmed === '' ? 'erdd' : trimmed).replace(/[^\w가-힣.-]+/g, '_')
  return `${safe}.${format}`
}

/** 현재 캔버스(활성 뷰·보기 모드 반영)를 PNG/SVG로 내려받는다. 현재 팬/줌과 무관하게 전체를 담는다. */
export async function downloadCanvasImage(
  rf: ReactFlowInstance,
  opts: { format: ImageFormat; fileName?: string },
): Promise<void> {
  const nodes = rf.getNodes()
  if (nodes.length === 0) throw new Error('내보낼 노드가 없습니다')
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
  if (!viewport) throw new Error('캔버스를 찾을 수 없습니다')

  const b = getNodesBounds(nodes)
  const width = Math.ceil(b.width) + MARGIN * 2
  const height = Math.ceil(b.height) + MARGIN * 2
  const style = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(${MARGIN - b.x}px, ${MARGIN - b.y}px) scale(1)`,
  }
  const params = { width, height, style, backgroundColor: PAPER, pixelRatio: 2 }
  const dataUrl = opts.format === 'png' ? await toPng(viewport, params) : await toSvg(viewport, params)

  const a = document.createElement('a')
  a.href = dataUrl
  a.download = imageFileName(opts.fileName ?? 'erdd', opts.format)
  a.click()
}
```

- [ ] **Step 5: 통과 확인** — `pnpm --filter @erdd/web test image-export` → PASS. `pnpm --filter @erdd/web typecheck` → 클린(`getNodesBounds` import 확인; 실패 시 실제 export 이름으로 교체).

- [ ] **Step 6: 커밋**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/editor/image-export.ts apps/web/src/editor/image-export.test.ts
git commit -m "feat(web): 이미지 내보내기 유틸 — 캔버스 PNG/SVG(html-to-image)"
```

(주: lockfile 경로가 루트라면 `pnpm-lock.yaml`을 루트에서 스테이징. `git status`로 실제 변경된 lockfile 경로 확인 후 그것만 add.)

---

## Task 2: 내보내기 다이얼로그 — 이미지 탭

**Files:**
- Modify: `apps/web/src/editor/export-dialog.tsx`, `apps/web/src/editor/export-dialog.test.tsx`

**Interfaces:**
- Consumes: `downloadCanvasImage`/`imageFileName`(Task 1), `useReactFlow`(@xyflow/react), `toast`(sonner).

### 설계 (읽고 시작)

- 현재 `export-dialog.tsx`는 DDL 전용이다. 상단에 토글 두 개(DDL | 이미지)를 두고(로컬 state, 기본 DDL — version-dialog의 토글 패턴 참고), 기존 DDL 내용은 DDL 섹션으로 감싼다.
- 이미지 섹션: 포맷 토글(PNG | SVG, 기본 PNG) + "다운로드" 버튼 + 짧은 안내("현재 화면(뷰·보기 모드)이 그대로 저장됩니다").
- 다운로드 클릭: `const rf = useReactFlow()`로 인스턴스를 얻어 `await downloadCanvasImage(rf, { format })`. try/catch로 오류 시 `toast.error(message)`(노드 0개 등). 성공 시 토스트(선택).
- `useReactFlow`는 ExportDialog가 `ReactFlowProvider`(project.tsx가 헤더까지 감쌈) 안에 있으므로 동작한다 — 기존 Toolbar가 `useReactFlow`를 쓰는 것과 동일.
- 다이얼로그 제목은 "내보내기" 유지.

### Steps

- [ ] **Step 1: export-dialog.tsx에 탭 + 이미지 섹션 추가** — 현재 파일을 읽고, DDL 콘텐츠를 `section==='ddl'` 분기로 감싼 뒤 `section==='image'` 분기에 포맷 토글·다운로드 버튼을 추가. `useReactFlow` import·사용. 기존 DDL 동작·테스트는 불변 유지.

- [ ] **Step 2: export-dialog.test.tsx에 이미지 탭 테스트 1개** — 다이얼로그 열고 "이미지" 토글 클릭 → PNG/SVG 포맷 옵션과 "다운로드" 버튼이 렌더된다. (실제 다운로드는 html-to-image라 jsdom에서 검증 불가 — 렌더만 assert. 필요 시 `downloadCanvasImage`를 vi.mock으로 스텁해 클릭이 호출하는지까지 assert.)

- [ ] **Step 3: 웹 테스트·타입체크** — `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck` → 기존 81 + 신규 통과.

- [ ] **Step 4: 커밋**

```bash
git add apps/web/src/editor/export-dialog.tsx apps/web/src/editor/export-dialog.test.tsx
git commit -m "feat(web): 내보내기 다이얼로그에 이미지(PNG/SVG) 탭 추가"
```

---

## 완료 기준 (최종 리뷰 체크리스트)

- "내보내기" 다이얼로그에 DDL | 이미지 탭이 있고, 이미지 탭에서 PNG/SVG를 골라 다운로드한다.
- 다운로드한 이미지가 현재 캔버스(전체/그룹 뷰·보기 모드)를 담고, 현재 팬/줌과 무관하게 다이어그램 전체가 여백과 함께 들어간다.
- 노드가 0개면 오류 토스트로 막고 다운로드하지 않는다.
- DDL 탭 동작은 기존과 동일(무회귀).
- 전체 테스트·타입체크 통과. (실제 이미지 산출은 컨트롤러 브라우저 스모크로 확인.)

## 이월(후속)

프로젝트명 파일명, 해상도/여백 옵션, 그룹 단위 일괄 내보내기, PDF, Excel 산출물(Phase 2).
