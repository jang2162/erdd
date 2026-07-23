# Phase 1 / M2b — 계정·조직·프로젝트 웹 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M2a 서버 API 위에 실사용 가능한 웹 UI — 로그인, 관리자 페이지(계정 관리), 조직·프로젝트 탐색과 생성(온보딩), 멤버 관리, 비밀번호 변경.

**Architecture:** React Router 기반 SPA. 데이터는 `@trpc/tanstack-react-query`(tRPC v11 공식 TanStack Query 통합)로 조회·변경하고, 인증은 세션 쿠키(브라우저 자동 전송) + `auth.me` 쿼리 기반 가드. UI는 Tailwind CSS v4 + shadcn/ui.

**Tech Stack:** react-router, @tanstack/react-query, @trpc/tanstack-react-query, tailwindcss v4(@tailwindcss/vite), shadcn/ui(Radix), lucide-react, sonner(토스트), pretendard + @fontsource-variable/jetbrains-mono(셀프호스팅 폰트).

## 디자인 방향 — "데이터 도면" (모든 태스크에 적용되는 계약)

- **팔레트**(CSS 변수로 정의, 임의 색 사용 금지): 잉크 `#1A2340`(전경), 페이퍼 `#F7F8FA`(배경), 청록 `#0E7A6C`(primary 액션), 키 골드 `#C89B3C`(PK·강조 전용 — 남용 금지), 적갈 `#C4453C`(destructive), 쿨 그레이 보더 `#E2E5EA`.
- **타이포 규칙**: UI 텍스트는 Pretendard. **물리명·식별자·이메일·코드성 값은 항상 `font-mono`**(JetBrains Mono). 이 규칙은 M4 에디터까지 이어지는 제품 아이덴티티다.
- **시그니처**: `BrandMark`(테이블 노드 글리프 SVG — 둥근 사각형+3행, 첫 행 골드 키 점) + 로그인·빈 상태에만 쓰는 모눈 배경(`bg-dotgrid`). 데이터 테이블·폼·다이얼로그는 조용하고 밀도 있게.
- **카피**: 한국어 sentence-case, 능동태, 버튼은 결과를 말한다("계정 만들기", "변경 사항 저장"). 에러는 원인+해결을 말하고 사과하지 않는다. 빈 상태는 행동 유도("첫 프로젝트를 만들어 보세요").
- 키보드 포커스 가시성(shadcn 기본 ring 유지), 모바일 최소 대응(로그인·목록이 375px에서 깨지지 않음).

## Global Constraints

- 수정 범위: `apps/web` + `pnpm-lock.yaml`. 서버·core 수정 금지(M2a API를 그대로 사용).
- 경로 별칭 `@/*` = `apps/web/src/*` (tsconfig paths + vite alias — Task 1에서 설정).
- 테스트: vitest + testing-library. tRPC 호출은 `src/testing/trpcMock.ts`의 fetch 스텁으로 모킹(Task 2에서 생성). 각 태스크의 신규 화면에 최소 1개 이상 의미 있는 테스트.
- 수동 스모크: 서버(`DATABASE_URL=... ADMIN_EMAIL=admin@erdd.dev ADMIN_PASSWORD=admin-pass-1 pnpm --filter @erdd/server dev`)와 웹(`pnpm --filter @erdd/web dev`)을 띄워 확인하는 단계가 명시된 태스크에서만 수행하고, 반드시 종료한다.
- ESM, TypeScript strict. 커밋 메시지는 한국어. `git add .`/`-A` 금지(작업 트리에 무관한 .idea 변경·.env 존재) — 명시 경로만.
- shadcn CLI는 대화형 프롬프트를 피하기 위해 `components.json`을 먼저 커밋된 상태로 두고 `pnpm dlx shadcn@latest add -y <컴포넌트>`만 사용한다.

---

### Task 1: UI 기반 — Tailwind v4, shadcn/ui, 라우터, tRPC Query 클라이언트, 앱 셸

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`(삭제 후 라우터로 대체), `apps/web/src/App.test.tsx`(대체)
- Create: `apps/web/components.json`, `apps/web/src/styles/globals.css`, `apps/web/src/lib/utils.ts`, `apps/web/src/lib/trpc.ts`(기존 src/trpc.ts 대체), `apps/web/src/components/brand-mark.tsx`, `apps/web/src/components/app-shell.tsx`, `apps/web/src/routes.tsx`
- shadcn CLI 생성: `apps/web/src/components/ui/*`(button, input, label, card, dialog, table, select, badge, dropdown-menu, sonner)

**Interfaces:**
- Produces: `TRPCProvider`/`useTRPC`(`@/lib/trpc`), `cn()`(`@/lib/utils`), `<AppShell>`(상단바: BrandMark+ERDD 워드마크, 우측 사용자 메뉴 슬롯 — Task 2에서 채움), `<BrandMark>`, 라우트 골격(`/login`, `/`, `/admin`, `/settings`, `/p/:projectId` — 페이지는 자리표시자, Task 2~5에서 구현), 전역 스타일·테마 토큰. Task 2~5 전부가 이 위에 선다.

- [ ] **Step 1: 의존성 설치와 설정 파일**

Run:
```bash
pnpm --filter @erdd/web add react-router @tanstack/react-query @trpc/tanstack-react-query lucide-react sonner class-variance-authority clsx tailwind-merge pretendard @fontsource-variable/jetbrains-mono
pnpm --filter @erdd/web add -D tailwindcss @tailwindcss/vite tw-animate-css
```

`apps/web/tsconfig.json`을 다음으로 교체:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`를 다음으로 교체:
```ts
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { proxy: { '/trpc': 'http://localhost:3000' } },
})
```

`apps/web/vitest.config.ts`를 다음으로 교체:
```ts
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: { environment: 'jsdom' },
})
```

`apps/web/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

`apps/web/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 2: 전역 스타일 — 테마 토큰(디자인 방향의 코드화)**

`apps/web/src/styles/globals.css`:
```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import 'pretendard/dist/web/variable/pretendardvariable.css';
@import '@fontsource-variable/jetbrains-mono';

:root {
  /* 데이터 도면 팔레트 */
  --background: #f7f8fa;          /* 페이퍼 */
  --foreground: #1a2340;          /* 잉크 */
  --card: #ffffff;
  --card-foreground: #1a2340;
  --popover: #ffffff;
  --popover-foreground: #1a2340;
  --primary: #0e7a6c;             /* 청록 */
  --primary-foreground: #ffffff;
  --secondary: #eef0f3;
  --secondary-foreground: #1a2340;
  --muted: #eef0f3;
  --muted-foreground: #5b6478;
  --accent: #eef0f3;
  --accent-foreground: #1a2340;
  --destructive: #c4453c;
  --destructive-foreground: #ffffff;
  --border: #e2e5ea;
  --input: #e2e5ea;
  --ring: #0e7a6c;
  --key: #c89b3c;                 /* 키 골드 — PK·강조 전용 */
  --radius: 0.5rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-key: var(--key);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
  --font-sans: 'Pretendard Variable', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', ui-monospace, monospace;
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground font-sans antialiased; }
}

/* 시그니처: 모눈(도면) 배경 — 로그인·빈 상태 전용 */
.bg-dotgrid {
  background-image: radial-gradient(circle, #d3d8e0 1px, transparent 1px);
  background-size: 20px 20px;
}
```

`apps/web/src/main.tsx`에서 `import '@/styles/globals.css'` 추가(구현은 Step 4).

- [ ] **Step 3: shadcn 컴포넌트 생성**

Run:
```bash
cd apps/web && pnpm dlx shadcn@latest add -y button input label card dialog table select badge dropdown-menu sonner && cd ../..
```
Expected: `apps/web/src/components/ui/*.tsx` 생성. 실패(프롬프트/네트워크) 시 오류를 읽고 재시도, 해결 불가면 BLOCKED 보고.

주의: 생성된 `ui/sonner.tsx`가 `next-themes`의 `useTheme`를 참조하면(Next.js 전용 템플릿) 해당 부분을 제거하고 `theme="light"`를 하드코딩해 Vite 환경에 맞게 단순화한다(보고서에 기록).

- [ ] **Step 4: tRPC Query 클라이언트·브랜드·셸·라우터**

`apps/web/src/lib/trpc.ts`(기존 `src/trpc.ts`는 삭제):
```ts
import { createTRPCContext } from '@trpc/tanstack-react-query'
import type { AppRouter } from '@erdd/server/src/router.js'

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>()
```

`apps/web/src/components/brand-mark.tsx`:
```tsx
import { cn } from '@/lib/utils'

/** 테이블 노드 글리프 — 둥근 사각형 + 3행, 첫 행에 골드 키 점. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('size-6', className)}>
      <rect x="2.5" y="3" width="19" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
      <line x1="2.5" y1="9.5" x2="21.5" y2="9.5" stroke="currentColor" strokeWidth="2" />
      <line x1="7" y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="17.5" x2="14" y2="17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6.5" cy="6.25" r="1.6" fill="var(--key)" />
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-mono text-lg font-bold tracking-tight', className)}>
      <BrandMark className="text-primary" />
      ERDD
    </span>
  )
}
```

`apps/web/src/components/app-shell.tsx`:
```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BrandWordmark } from '@/components/brand-mark'

/** 로그인 이후 화면의 공통 셸 — 상단바 + 콘텐츠. userMenu는 Task 2에서 주입. */
export function AppShell({ children, userMenu }: { children: ReactNode; userMenu?: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="홈으로">
            <BrandWordmark />
          </Link>
          {userMenu}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
```

`apps/web/src/routes.tsx`(페이지는 자리표시자 — 이후 태스크가 교체):
```tsx
import { createBrowserRouter } from 'react-router'

function Placeholder({ name }: { name: string }) {
  return <p className="p-8 text-muted-foreground">{name} — 준비 중</p>
}

export const router = createBrowserRouter([
  { path: '/login', element: <Placeholder name="로그인" /> },
  { path: '/', element: <Placeholder name="홈" /> },
  { path: '/admin', element: <Placeholder name="관리자" /> },
  { path: '/settings', element: <Placeholder name="설정" /> },
  { path: '/p/:projectId', element: <Placeholder name="프로젝트" /> },
])
```

`apps/web/src/main.tsx` 교체:
```tsx
import '@/styles/globals.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { Toaster } from '@/components/ui/sonner'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { router } from '@/routes'

function Root() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  }))
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="top-center" />
      </TRPCProvider>
    </QueryClientProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
```

`apps/web/index.html`의 `<title>`을 `ERDD`로 유지하고 `<html lang="ko">` 확인.

기존 `apps/web/src/App.tsx`와 `apps/web/src/trpc.ts` 삭제.

- [ ] **Step 5: 스모크 테스트 교체**

`apps/web/src/App.test.tsx` 삭제하고 `apps/web/src/components/brand-mark.test.tsx` 생성:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandWordmark } from './brand-mark.js'

describe('BrandWordmark', () => {
  it('renders the ERDD wordmark with the table glyph', () => {
    render(<BrandWordmark />)
    expect(screen.getByText('ERDD')).toBeDefined()
  })
})
```

Run:
```bash
pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck && pnpm --filter @erdd/web build
```
Expected: 테스트 통과, 타입체크 통과, Vite 빌드 성공(Tailwind·폰트 번들 포함).

- [ ] **Step 6: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): UI 기반 — Tailwind v4, shadcn/ui, 라우터, tRPC Query, 데이터 도면 테마"
```

---

### Task 2: 인증 플로우 — 로그인, 세션 가드, 사용자 메뉴

**Files:**
- Create: `apps/web/src/pages/login.tsx`, `apps/web/src/components/require-auth.tsx`, `apps/web/src/components/user-menu.tsx`, `apps/web/src/testing/trpc-mock.ts`
- Modify: `apps/web/src/routes.tsx`(login 라우트 연결, 보호 라우트를 RequireAuth로 감쌈)
- Test: `apps/web/src/pages/login.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `useTRPC`, shadcn 컴포넌트.
- Produces:
  - `<RequireAuth>` — `auth.me` 쿼리로 사용자를 확인, 미인증(UNAUTHORIZED)이면 `/login`으로 리다이렉트, 로딩 중엔 스피너. 자식에게 `me`를 context로 제공(`useMe()` 훅 export). Task 3~5의 모든 보호 페이지가 사용.
  - `<UserMenu me={...}>` — 이름 표시 + 드롭다운(설정, 관리자[admin만], 로그아웃).
  - `mockTrpcFetch(handlers)` 테스트 헬퍼 — tRPC GET/POST 요청 경로별 응답 스텁(`src/testing/trpc-mock.ts`). Task 3~5 테스트가 재사용.

- [ ] **Step 1: 테스트 헬퍼와 실패하는 테스트 작성**

`apps/web/src/testing/trpc-mock.ts`:
```ts
import { vi } from 'vitest'

type Handler = (input: unknown) => { data?: unknown; error?: { code: number; message: string } }

/**
 * tRPC httpBatchLink 요청을 경로별로 스텁한다.
 * handlers: { 'auth.me': () => ({ data: {...} }), 'auth.login': (input) => ({ error: { code: -32001, message: '...' } }) }
 * tRPC 오류 코드: UNAUTHORIZED=-32001 (JSON-RPC 매핑). 성공은 { result: { data } }, 실패는 { error }.
 */
export function mockTrpcFetch(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url), 'http://localhost')
    const paths = u.pathname.replace(/^\/trpc\//, '').split(',')
    const isBatch = u.searchParams.has('batch')
    const inputs: Record<string, unknown> = (() => {
      const raw = init?.body ? String(init.body) : u.searchParams.get('input')
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return isBatch ? parsed : { 0: parsed }
    })()
    const results = paths.map((path, i) => {
      const handler = handlers[path]
      if (!handler) return { error: { code: -32004, message: `no handler: ${path}`, data: { httpStatus: 404 } } }
      const out = handler(inputs[String(i)])
      if (out.error) {
        return { error: { code: out.error.code, message: out.error.message, data: { httpStatus: out.error.code === -32001 ? 401 : 400, code: 'ERROR' } } }
      }
      return { result: { data: out.data } }
    })
    const body = isBatch ? results : results[0]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
```

`apps/web/src/pages/login.test.tsx`:
```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { LoginPage } from './login.js'

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([
    { path: '/login', Component: LoginPage },
    { path: '/', Component: () => <p>홈 도착</p> },
  ])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/login']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('LoginPage', () => {
  it('logs in and navigates home', async () => {
    mockTrpcFetch({
      'auth.login': () => ({ data: { id: 'u1', email: 'a@b.dev', name: '사용자', role: 'user' } }),
    })
    renderLogin()
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.dev')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(screen.getByText('홈 도착')).toBeDefined())
  })

  it('shows the server error message on failure', async () => {
    mockTrpcFetch({
      'auth.login': () => ({ error: { code: -32001, message: '이메일 또는 비밀번호가 올바르지 않습니다' } }),
    })
    renderLogin()
    await userEvent.type(screen.getByLabelText('이메일'), 'a@b.dev')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong-pass')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() =>
      expect(screen.getByText('이메일 또는 비밀번호가 올바르지 않습니다')).toBeDefined(),
    )
  })
})
```

Run: `pnpm --filter @erdd/web add -D @testing-library/user-event` 후 `pnpm --filter @erdd/web test`
Expected: FAIL — `login.js` 모듈 없음.

- [ ] **Step 2: 구현**

`apps/web/src/pages/login.tsx`:
```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { BrandWordmark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginPage() {
  const trpc = useTRPC()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: () => navigate('/', { replace: true }),
    }),
  )

  return (
    <div className="bg-dotgrid flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandWordmark className="mx-auto mb-2" />
          <CardTitle>로그인</CardTitle>
          <CardDescription>계정이 없다면 관리자에게 요청하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              login.mutate({ email, password })
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email" type="email" required autoComplete="username"
                className="font-mono" value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password" type="password" required autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {login.error && (
              <p role="alert" className="text-sm text-destructive">{login.error.message}</p>
            )}
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? '확인 중…' : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

`apps/web/src/components/require-auth.tsx`:
```tsx
import { createContext, useContext, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'

export type Me = { id: string; email: string; name: string; role: 'admin' | 'user' }

const MeContext = createContext<Me | null>(null)

export function useMe(): Me {
  const me = useContext(MeContext)
  if (!me) throw new Error('useMe는 RequireAuth 안에서만 사용할 수 있습니다')
  return me
}

export function RequireAuth({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const trpc = useTRPC()
  const me = useQuery(trpc.auth.me.queryOptions(undefined, { retry: false }))

  if (me.isPending) {
    return <div className="flex min-h-dvh items-center justify-center text-muted-foreground">불러오는 중…</div>
  }
  if (me.isError) return <Navigate to="/login" replace />
  if (adminOnly && me.data.role !== 'admin') return <Navigate to="/" replace />
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>
}
```

`apps/web/src/components/user-menu.tsx`:
```tsx
import { Link, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Settings, ShieldCheck } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useMe } from '@/components/require-auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu() {
  const me = useMe()
  const trpc = useTRPC()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: async () => {
        await queryClient.clear()
        navigate('/login', { replace: true })
      },
    }),
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">{me.name}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-mono text-xs">{me.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {me.role === 'admin' && (
          <DropdownMenuItem asChild>
            <Link to="/admin"><ShieldCheck /> 관리자</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/settings"><Settings /> 설정</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout.mutate()}>
          <LogOut /> 로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

`apps/web/src/routes.tsx` 교체:
```tsx
import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { LoginPage } from '@/pages/login'
import { RequireAuth } from '@/components/require-auth'
import { AppShell } from '@/components/app-shell'
import { UserMenu } from '@/components/user-menu'

function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  return (
    <RequireAuth adminOnly={adminOnly}>
      <AppShell userMenu={<UserMenu />}>{children}</AppShell>
    </RequireAuth>
  )
}

function Placeholder({ name }: { name: string }) {
  return <p className="text-muted-foreground">{name} — 준비 중</p>
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <Protected><Placeholder name="홈" /></Protected> },
  { path: '/admin', element: <Protected adminOnly><Placeholder name="관리자" /></Protected> },
  { path: '/settings', element: <Protected><Placeholder name="설정" /></Protected> },
  { path: '/p/:projectId', element: <Protected><Placeholder name="프로젝트" /></Protected> },
])
```

- [ ] **Step 3: 테스트·타입체크 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS (brand-mark 1 + login 2).

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): 인증 플로우 — 로그인 화면, 세션 가드, 사용자 메뉴"
```

---

### Task 3: 관리자 페이지 — 계정 목록·생성·재설정·비활성화

**Files:**
- Create: `apps/web/src/pages/admin.tsx`
- Modify: `apps/web/src/routes.tsx`(admin 라우트 연결)
- Test: `apps/web/src/pages/admin.test.tsx`

**Interfaces:**
- Consumes: `useTRPC`, `admin.users.*` 라우트(M2a), shadcn Table/Dialog/Badge/Select, `mockTrpcFetch`.
- Produces: `/admin` 페이지. 이메일은 `font-mono`, 역할·상태는 Badge(관리자=키 골드 계열 강조).

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/pages/admin.test.tsx`:
```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { AdminPage } from './admin.js'

const USERS = [
  { id: 'u1', email: 'admin@test.dev', name: '관리자', role: 'admin', isActive: true, createdAt: '2026-07-24T00:00:00Z' },
  { id: 'u2', email: 'user@test.dev', name: '사용자', role: 'user', isActive: false, createdAt: '2026-07-24T00:00:00Z' },
]

function renderAdmin(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/admin', Component: AdminPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/admin']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AdminPage', () => {
  it('lists accounts with role and status badges', async () => {
    renderAdmin({ 'admin.users.list': () => ({ data: USERS }) })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    expect(screen.getByText('비활성')).toBeDefined()
    expect(screen.getAllByText('관리자').length).toBeGreaterThan(0)
  })

  it('creates an account through the dialog', async () => {
    const created = vi.fn(() => ({ data: { id: 'u3', email: 'new@test.dev' } }))
    renderAdmin({
      'admin.users.list': () => ({ data: USERS }),
      'admin.users.create': created,
    })
    await waitFor(() => expect(screen.getByText('admin@test.dev')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: '계정 만들기' }))
    await userEvent.type(screen.getByLabelText('이메일'), 'new@test.dev')
    await userEvent.type(screen.getByLabelText('이름'), '신규')
    await userEvent.type(screen.getByLabelText('초기 비밀번호'), 'password-1')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(created).toHaveBeenCalled())
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`apps/web/src/pages/admin.tsx`:
```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function CreateAccountDialog() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [initialPassword, setInitialPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const create = useMutation(
    trpc.admin.users.create.mutationOptions({
      onSuccess: async () => {
        toast.success('계정을 만들었습니다')
        await queryClient.invalidateQueries({ queryKey: trpc.admin.users.list.queryKey() })
        setOpen(false)
        setEmail(''); setName(''); setInitialPassword(''); setRole('user')
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>계정 만들기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>계정 만들기</DialogTitle>
          <DialogDescription>초기 비밀번호를 사용자에게 직접 전달하세요.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate({ email, name, initialPassword, role })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="new-email">이메일</Label>
            <Input id="new-email" type="email" required className="font-mono"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-name">이름</Label>
            <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">초기 비밀번호</Label>
            <Input id="new-password" required minLength={8} className="font-mono"
              value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>역할</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'user')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">일반</SelectItem>
                <SelectItem value="admin">관리자</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>만들기</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ userId, email }: { userId: string; email: string }) {
  const trpc = useTRPC()
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const reset = useMutation(
    trpc.admin.users.resetPassword.mutationOptions({
      onSuccess: () => {
        toast.success('비밀번호를 재설정했습니다')
        setOpen(false)
        setNewPassword('')
      },
      onError: (err) => toast.error(err.message),
    }),
  )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">비밀번호 재설정</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>비밀번호 재설정</DialogTitle>
          <DialogDescription className="font-mono">{email}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            reset.mutate({ userId, newPassword })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="reset-password">새 비밀번호</Label>
            <Input id="reset-password" required minLength={8} className="font-mono"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={reset.isPending}>재설정</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AdminPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const users = useQuery(trpc.admin.users.list.queryOptions())
  const setActive = useMutation(
    trpc.admin.users.setActive.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.admin.users.list.queryKey() })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">계정 관리</h1>
          <p className="text-sm text-muted-foreground">계정을 만들고 비밀번호와 사용 상태를 관리합니다.</p>
        </div>
        <CreateAccountDialog />
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono">{u.email}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell>
                  {u.role === 'admin'
                    ? <Badge className="bg-key/15 text-key border-key/30" variant="outline">관리자</Badge>
                    : <Badge variant="secondary">일반</Badge>}
                </TableCell>
                <TableCell>
                  {u.isActive
                    ? <Badge variant="outline">활성</Badge>
                    : <Badge variant="destructive">비활성</Badge>}
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <ResetPasswordDialog userId={u.id} email={u.email} />
                  <Button
                    variant="outline" size="sm" disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ userId: u.id, isActive: !u.isActive })}
                  >
                    {u.isActive ? '비활성화' : '활성화'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.data?.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">아직 계정이 없습니다.</p>
        )}
      </div>
    </div>
  )
}
```

`apps/web/src/routes.tsx`: admin 라우트를 `<Protected adminOnly><AdminPage /></Protected>`로 교체(import 추가).

- [ ] **Step 3: 테스트·타입체크 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): 관리자 페이지 — 계정 목록·생성·비밀번호 재설정·비활성화"
```

---

### Task 4: 홈 — 조직 목록·생성, 조직 상세(프로젝트·멤버)

**Files:**
- Create: `apps/web/src/pages/home.tsx`, `apps/web/src/pages/org-detail.tsx`(홈에서 조직 선택 시 표시되는 섹션 컴포넌트 포함)
- Modify: `apps/web/src/routes.tsx`(`/` 연결, `/org/:orgId` 라우트 추가)
- Test: `apps/web/src/pages/home.test.tsx`

**Interfaces:**
- Consumes: `org.*`, `project.*` 라우트(M2a), `useMe`.
- Produces:
  - `/` — 내 조직 목록(개인 조직은 "개인 공간" Badge + 항상 맨 위), 팀 조직 생성 Dialog. 조직 카드 클릭 → `/org/:orgId`.
  - `/org/:orgId` — 프로젝트 카드 그리드(+ "프로젝트 만들기" Dialog: 이름/설명/방언 다중 선택 체크박스), 팀 조직이면 멤버 섹션(목록·이메일로 추가·역할 변경 Select·제거). 프로젝트 카드 클릭 → `/p/:projectId`.
  - 빈 상태(프로젝트 0개): 모눈 배경 패널 + "첫 프로젝트를 만들어 보세요" + 만들기 버튼(온보딩).

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/pages/home.test.tsx`:
```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { HomePage } from './home.js'

function renderHome(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/', Component: HomePage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HomePage', () => {
  it('lists organizations with the personal org labeled and pinned first', async () => {
    renderHome({
      'org.list': () => ({
        data: [
          { id: 'o2', name: '팀A', kind: 'team', role: 'owner' },
          { id: 'o1', name: '사용자의 공간', kind: 'personal', role: 'owner' },
        ],
      }),
    })
    await waitFor(() => expect(screen.getByText('팀A')).toBeDefined())
    expect(screen.getByText('개인 공간')).toBeDefined()
    const cards = screen.getAllByRole('link')
    expect(cards[0]?.textContent).toContain('사용자의 공간')
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`apps/web/src/pages/home.tsx`:
```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMe } from '@/components/require-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function CreateOrgDialog() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const create = useMutation(
    trpc.org.create.mutationOptions({
      onSuccess: async () => {
        toast.success('조직을 만들었습니다')
        await queryClient.invalidateQueries({ queryKey: trpc.org.list.queryKey() })
        setOpen(false)
        setName('')
      },
      onError: (err) => toast.error(err.message),
    }),
  )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">팀 조직 만들기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>팀 조직 만들기</DialogTitle></DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); create.mutate({ name }) }}
        >
          <div className="grid gap-2">
            <Label htmlFor="org-name">조직 이름</Label>
            <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter><Button type="submit" disabled={create.isPending}>만들기</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HomePage() {
  const trpc = useTRPC()
  const me = useMe()
  const orgs = useQuery(trpc.org.list.queryOptions())
  const sorted = [...(orgs.data ?? [])].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'personal' ? -1 : 1,
  )

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{me.name}님의 작업 공간</h1>
          <p className="text-sm text-muted-foreground">조직을 선택해 프로젝트로 이동하세요.</p>
        </div>
        <CreateOrgDialog />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((org) => (
          <Link key={org.id} to={`/org/${org.id}`}>
            <Card className="transition-colors hover:border-primary">
              <CardHeader className="flex-row items-center gap-3">
                <Building2 className="size-5 text-muted-foreground" />
                <CardTitle className="flex-1 text-base">{org.name}</CardTitle>
                {org.kind === 'personal' && <Badge variant="secondary">개인 공간</Badge>}
                <ChevronRight className="size-4 text-muted-foreground" />
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

`apps/web/src/pages/org-detail.tsx`:
```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DIALECTS, type Dialect } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const DIALECT_LABEL: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL/MariaDB', oracle: 'Oracle', mssql: 'MSSQL',
}

function CreateProjectDialog({ orgId }: { orgId: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dialects, setDialects] = useState<Dialect[]>(['postgresql'])
  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: async () => {
        toast.success('프로젝트를 만들었습니다')
        await queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey({ orgId }) })
        setOpen(false)
        setName(''); setDescription(''); setDialects(['postgresql'])
      },
      onError: (err) => toast.error(err.message),
    }),
  )
  const toggleDialect = (d: Dialect) =>
    setDialects((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> 프로젝트 만들기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>프로젝트 만들기</DialogTitle></DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (dialects.length === 0) { toast.error('대상 DB를 하나 이상 선택하세요'); return }
            create.mutate({ orgId, name, description, dialects })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="prj-name">이름</Label>
            <Input id="prj-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prj-desc">설명 (선택)</Label>
            <Input id="prj-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>대상 DB 방언</Label>
            <div className="flex flex-wrap gap-2">
              {DIALECTS.map((d) => (
                <Button
                  key={d} type="button" size="sm"
                  variant={dialects.includes(d) ? 'default' : 'outline'}
                  onClick={() => toggleDialect(d)}
                >
                  {DIALECT_LABEL[d]}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={create.isPending}>만들기</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MembersSection({ orgId, myRole }: { orgId: string; myRole: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const members = useQuery(trpc.org.members.list.queryOptions({ orgId }))
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const canManage = myRole === 'owner' || myRole === 'admin'
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.org.members.list.queryKey({ orgId }) })
  const add = useMutation(
    trpc.org.members.add.mutationOptions({
      onSuccess: async () => { toast.success('멤버를 추가했습니다'); setEmail(''); await invalidate() },
      onError: (err) => toast.error(err.message),
    }),
  )
  const setMemberRole = useMutation(
    trpc.org.members.setRole.mutationOptions({
      onSuccess: invalidate, onError: (err) => toast.error(err.message),
    }),
  )
  const remove = useMutation(
    trpc.org.members.remove.mutationOptions({
      onSuccess: invalidate, onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">멤버</h2>
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); add.mutate({ orgId, email, role }) }}
        >
          <div className="grid gap-1">
            <Label htmlFor="member-email" className="text-xs">이메일로 추가</Label>
            <Input id="member-email" type="email" required placeholder="user@example.com"
              className="w-64 font-mono" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={add.isPending}>추가</Button>
        </form>
      )}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              {canManage && <TableHead className="text-right">동작</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.name}</TableCell>
                <TableCell className="font-mono">{m.email}</TableCell>
                <TableCell>
                  {canManage ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        setMemberRole.mutate({ orgId, memberId: m.id, role: v as 'owner' | 'admin' | 'member' })
                      }
                    >
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{m.role}</Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={remove.isPending}
                      onClick={() => remove.mutate({ orgId, memberId: m.id })}>
                      제거
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function OrgDetailPage() {
  const { orgId = '' } = useParams()
  const trpc = useTRPC()
  const orgs = useQuery(trpc.org.list.queryOptions())
  const projects = useQuery(trpc.project.list.queryOptions({ orgId }))
  const org = orgs.data?.find((o) => o.id === orgId)

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{org?.name ?? '조직'}</h1>
          <p className="text-sm text-muted-foreground">
            {org?.kind === 'personal' ? '개인 공간' : '팀 조직'}
          </p>
        </div>
        <CreateProjectDialog orgId={orgId} />
      </div>

      {projects.data?.length === 0 ? (
        <div className="bg-dotgrid grid place-items-center rounded-lg border py-16 text-center">
          <div className="grid gap-3">
            <Database className="mx-auto size-8 text-muted-foreground" />
            <p className="font-medium">첫 프로젝트를 만들어 보세요</p>
            <p className="text-sm text-muted-foreground">프로젝트 하나가 DB 스키마 하나입니다.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data?.map((p) => (
            <Link key={p.id} to={`/p/${p.id}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription>{p.description || '설명 없음'}</CardDescription>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {p.dialects.map((d) => (
                      <Badge key={d} variant="outline" className="font-mono text-xs">{d}</Badge>
                    ))}
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {org && org.kind === 'team' && <MembersSection orgId={orgId} myRole={org.role} />}
    </div>
  )
}
```

`apps/web/src/routes.tsx`: `/`를 `<Protected><HomePage /></Protected>`로, `/org/:orgId` 라우트를 `<Protected><OrgDetailPage /></Protected>`로 추가/교체.

- [ ] **Step 3: 테스트·타입체크 통과 확인 후 Commit**

Run: `pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck`
Expected: PASS.

```bash
git add apps/web
git commit -m "feat(web): 홈·조직 상세 — 조직/프로젝트 탐색과 생성, 멤버 관리"
```

---

### Task 5: 프로젝트 페이지·설정, 전체 빌드 스모크

**Files:**
- Create: `apps/web/src/pages/project.tsx`, `apps/web/src/pages/settings.tsx`
- Modify: `apps/web/src/routes.tsx`(연결)
- Test: `apps/web/src/pages/settings.test.tsx`

**Interfaces:**
- Consumes: `project.get/members.*`, `auth.changePassword`.
- Produces:
  - `/p/:projectId` — 프로젝트 헤더(이름, 설명, 방언 Badge, 내 역할), "에디터는 준비 중" 자리표시자 패널(M4에서 교체), 프로젝트 멤버 관리 섹션(canManage 시: 조직 멤버 Select로 추가/역할/제거 — `project.members.*` + `org.members.list` 조합).
  - `/settings` — 비밀번호 변경 폼(현재/새/확인, 불일치 클라이언트 검증, 성공 토스트).

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/pages/settings.test.tsx`:
```tsx
import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { SettingsPage } from './settings.js'

function renderSettings(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/settings', Component: SettingsPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={['/settings']} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SettingsPage', () => {
  it('blocks submit when the confirmation does not match', async () => {
    const change = vi.fn(() => ({ data: { ok: true } }))
    renderSettings({ 'auth.changePassword': change })
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-2')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-x')
    await userEvent.click(screen.getByRole('button', { name: '변경 사항 저장' }))
    expect(await screen.findByText('새 비밀번호가 서로 다릅니다')).toBeDefined()
    expect(change).not.toHaveBeenCalled()
  })

  it('submits when valid', async () => {
    const change = vi.fn(() => ({ data: { ok: true } }))
    renderSettings({ 'auth.changePassword': change })
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'password-1')
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'password-2')
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'password-2')
    await userEvent.click(screen.getByRole('button', { name: '변경 사항 저장' }))
    await waitFor(() => expect(change).toHaveBeenCalled())
  })
})
```

Run: `pnpm --filter @erdd/web test` → FAIL(모듈 없음).

- [ ] **Step 2: 구현**

`apps/web/src/pages/settings.tsx`:
```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SettingsPage() {
  const trpc = useTRPC()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success('비밀번호를 변경했습니다')
        setCurrentPassword(''); setNewPassword(''); setConfirm('')
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>변경하면 다른 기기의 로그인이 해제됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (newPassword !== confirm) { setMismatch(true); return }
              setMismatch(false)
              change.mutate({ currentPassword, newPassword })
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="cur">현재 비밀번호</Label>
              <Input id="cur" type="password" required autoComplete="current-password"
                value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new">새 비밀번호</Label>
              <Input id="new" type="password" required minLength={8} autoComplete="new-password"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">새 비밀번호 확인</Label>
              <Input id="confirm" type="password" required autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {mismatch && <p role="alert" className="text-sm text-destructive">새 비밀번호가 서로 다릅니다</p>}
            <Button type="submit" disabled={change.isPending}>변경 사항 저장</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

`apps/web/src/pages/project.tsx`:
```tsx
import { useState } from 'react'
import { useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PencilRuler } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function ProjectMembers({ projectId, orgId }: { projectId: string; orgId: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const projectMembers = useQuery(trpc.project.members.list.queryOptions({ projectId }))
  const orgMembers = useQuery(trpc.org.members.list.queryOptions({ orgId }))
  const [memberId, setMemberId] = useState('')
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.project.members.list.queryKey({ projectId }) })
  const add = useMutation(
    trpc.project.members.add.mutationOptions({
      onSuccess: async () => { toast.success('멤버를 추가했습니다'); setMemberId(''); await invalidate() },
      onError: (err) => toast.error(err.message),
    }),
  )
  const remove = useMutation(
    trpc.project.members.remove.mutationOptions({
      onSuccess: invalidate, onError: (err) => toast.error(err.message),
    }),
  )
  const candidates = orgMembers.data?.filter(
    (om) => !projectMembers.data?.some((pm) => pm.memberId === om.id),
  )

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">프로젝트 멤버</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (memberId) add.mutate({ projectId, memberId, role }) }}
      >
        <div className="grid gap-1">
          <Label className="text-xs">조직 멤버 추가</Label>
          <Select value={memberId} onValueChange={setMemberId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="멤버 선택" /></SelectTrigger>
            <SelectContent>
              {candidates?.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name} ({m.email})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={add.isPending || !memberId}>추가</Button>
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectMembers.data?.map((pm) => (
              <TableRow key={pm.id}>
                <TableCell>{pm.name}</TableCell>
                <TableCell className="font-mono">{pm.email}</TableCell>
                <TableCell><Badge variant="secondary">{pm.role}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" disabled={remove.isPending}
                    onClick={() => remove.mutate({ projectId, projectMemberId: pm.id })}>
                    제거
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const trpc = useTRPC()
  const project = useQuery(trpc.project.get.queryOptions({ projectId }))

  if (project.isPending) return <p className="text-muted-foreground">불러오는 중…</p>
  if (project.isError) return <p role="alert" className="text-destructive">{project.error.message}</p>

  const p = project.data
  const canManage = p.myOrgRole === 'owner' || p.myOrgRole === 'admin' || p.myRole === 'admin'

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <p className="text-sm text-muted-foreground">{p.description || '설명 없음'}</p>
        <div className="flex flex-wrap gap-1 pt-2">
          {p.dialects.map((d) => (
            <Badge key={d} variant="outline" className="font-mono text-xs">{d}</Badge>
          ))}
          {p.myRole && <Badge variant="secondary">내 역할: {p.myRole}</Badge>}
        </div>
      </div>

      <div className="bg-dotgrid grid place-items-center rounded-lg border py-20 text-center">
        <div className="grid gap-3">
          <PencilRuler className="mx-auto size-8 text-muted-foreground" />
          <p className="font-medium">ERD 에디터는 준비 중입니다</p>
          <p className="text-sm text-muted-foreground">다음 마일스톤에서 이 자리에 캔버스가 열립니다.</p>
        </div>
      </div>

      {canManage && <ProjectMembers projectId={projectId} orgId={p.orgId} />}
    </div>
  )
}
```

`apps/web/src/routes.tsx`: `/settings` → `<Protected><SettingsPage /></Protected>`, `/p/:projectId` → `<Protected><ProjectPage /></Protected>`.

- [ ] **Step 3: 테스트·타입체크·빌드 확인**

Run:
```bash
pnpm --filter @erdd/web test && pnpm --filter @erdd/web typecheck && pnpm --filter @erdd/web build
pnpm test && pnpm typecheck   # 루트 전체(서버·core 회귀 없음)
```
Expected: 전부 통과.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): 프로젝트 페이지·설정 — 멤버 관리, 비밀번호 변경, 에디터 자리"
```

---

## 완료 기준 (M2b Definition of Done)

- `pnpm --filter @erdd/web test`(컴포넌트 테스트 7+), typecheck, build 통과. 루트 테스트·타입체크 통과(서버 66개 유지).
- 브라우저 스모크(컨트롤러가 Playwright로 수행): 로그인 → 홈(개인 공간) → 팀 조직 생성 → 프로젝트 생성(방언 선택) → 프로젝트 페이지 → 관리자 페이지에서 계정 생성 → 설정에서 비밀번호 변경까지 전 플로우가 실제 서버에 대해 동작.
- 디자인 계약 준수: 팔레트 토큰 외 임의 색 없음, 물리적 식별자(이메일·방언)는 font-mono, 모눈 배경은 로그인·빈 상태에만.
