import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  RESOURCE_KIND_LABEL, resourceDisplayName, resourceSecondaryName, type ResourceKind,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { formatCount } from '@/lib/format'
import { PAGE_SIZE } from '@/lib/paginate'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { libraryDomainsQueryKey, useLibraryDomains } from '@/lib/library-domains'
import { ResourceItemForm } from '@/components/resource-item-form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

export type ItemRow = { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }
export type ViewedLibrary = { id: string; name: string; countsByKind: Record<ResourceKind, number> }

/** 조회 모달의 탭 순서 — 처음 열면 단어다(RESOURCE_KINDS 의 도메인 우선 순서와 다르다). */
export const VIEW_KINDS = ['word', 'term', 'domain', 'customField'] as const satisfies readonly ResourceKind[]

const SEARCH_DEBOUNCE_MS = 300
/** 서버 `items.page` 의 검색어 상한(zod `max(200)`). 넘기면 zod 원문이 오류로 뜨므로 입력에서 막는다. */
const SEARCH_MAX_LENGTH = 200
type TabState = { query: string; page: number }
const INITIAL_TABS: Record<ResourceKind, TabState> = {
  word: { query: '', page: 1 }, term: { query: '', page: 1 },
  domain: { query: '', page: 1 }, customField: { query: '', page: 1 },
}
const TARGET_LABEL: Record<string, string> = { table: '테이블', column: '컬럼' }
const TYPE_LABEL: Record<string, string> = { text: '텍스트', boolean: '불리언', select: '선택형' }

const text = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key]
  return typeof value === 'string' ? value : ''
}

/** 종류별 표 열(설계 1절의 표). 첫 칸은 논리명 칸, 둘째 칸은 단어·용어의 물리명 칸이다. */
function columnsOf(kind: ResourceKind): readonly string[] {
  switch (kind) {
    case 'word': return ['논리명', '물리명', '영문명']
    case 'term': return ['논리명', '물리명', '도메인']
    case 'domain': return ['이름', '분류', '논리 타입']
    case 'customField': return ['이름', '대상', '타입']
  }
}

function cellsOf(
  kind: ResourceKind, payload: Record<string, unknown>, domainName: (id: string | null) => string,
): string[] {
  const name = resourceDisplayName(kind, payload)
  switch (kind) {
    case 'word': return [name, resourceSecondaryName(kind, payload) ?? '', text(payload, 'englishName')]
    case 'term': return [
      name, resourceSecondaryName(kind, payload) ?? '',
      domainName(typeof payload.domainId === 'string' ? payload.domainId : null),
    ]
    case 'domain': return [name, text(payload, 'category'), text(payload, 'logicalType')]
    case 'customField': return [
      name, TARGET_LABEL[text(payload, 'target')] ?? '', TYPE_LABEL[text(payload, 'type')] ?? '',
    ]
  }
}

/**
 * 「라이브러리 조회 — 〈이름〉」 모달. 종류별 탭마다 검색·표·페이지이고 데이터는 `items.page` 로만 받는다
 * (`items.list` 는 이 화면에서 부르지 않는다 — 16,565건을 한 번에 받지 않기 위해서다).
 * 탭별 검색어·페이지는 여기(부모)가 들고 있어 탭을 옮겨도 남는다.
 */
export function LibraryViewDialog({ library, canManage, onClose, onChanged }: {
  library: ViewedLibrary
  canManage: boolean
  onClose: () => void
  /** 항목을 추가·수정·삭제한 뒤 — 호출부가 library.list(개수)를 무효화한다. */
  onChanged: () => Promise<unknown>
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ResourceKind>('word')
  const [tabs, setTabs] = useState(INITIAL_TABS)
  const [editing, setEditing] = useState<{ kind: ResourceKind; item: ItemRow | null } | null>(null)
  const domains = useLibraryDomains(library.id, kind === 'term' || editing?.kind === 'term')
  const domainNames = useMemo(() => new Map((domains.data ?? []).map((d) => [d.id, d.name])), [domains.data])
  const domainName = (id: string | null) => (id === null ? '' : domainNames.get(id) ?? '')

  const patchTab = (k: ResourceKind, patch: Partial<TabState>) =>
    setTabs((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }))

  // 추가·편집·삭제 뒤에는 항목 페이지·도메인 목록·라이브러리 목록(개수)을 함께 무효화한다 — 규칙은 하나다.
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: trpc.resource.items.page.queryKey({ libraryId: library.id }) }),
    queryClient.invalidateQueries({ queryKey: libraryDomainsQueryKey(library.id) }),
    onChanged(),
  ])
  const onError = (err: { message: string }) => toast.error(err.message)
  const createItem = useMutation(trpc.resource.items.create.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidate() }, onError,
  }))
  const updateItem = useMutation(trpc.resource.items.update.mutationOptions({
    onSuccess: async () => { setEditing(null); await invalidate() }, onError,
  }))
  const removeItem = useMutation(trpc.resource.items.remove.mutationOptions({
    onSuccess: async () => { await invalidate() }, onError,
  }))

  const onRemove = (item: ItemRow) => {
    const name = resourceDisplayName(item.kind, item.payload)
    if (!window.confirm(`"${name}"을(를) 삭제할까요? 이미 가져간 프로젝트의 사본은 그대로 남습니다.`)) return
    removeItem.mutate({ itemId: item.id })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>라이브러리 조회 — {library.name}</DialogTitle></DialogHeader>
        <Tabs value={kind} onValueChange={(v) => setKind(v as ResourceKind)}>
          <TabsList aria-label="항목 종류">
            {VIEW_KINDS.map((k) => (
              <TabsTrigger key={k} value={k}>
                {RESOURCE_KIND_LABEL[k]} ({formatCount(library.countsByKind[k])})
              </TabsTrigger>
            ))}
          </TabsList>
          {VIEW_KINDS.map((k) => (
            <TabsContent key={k} value={k}>
              <KindTab
                libraryId={library.id} kind={k} state={tabs[k]} canManage={canManage}
                domainName={domainName}
                onQueryChange={(query) => patchTab(k, { query, page: 1 })}
                onPageChange={(page) => patchTab(k, { page })}
                onAdd={() => setEditing({ kind: k, item: null })}
                onEdit={(item) => setEditing({ kind: k, item })}
                onRemove={onRemove}
              />
            </TabsContent>
          ))}
        </Tabs>

        {editing && (
          <Dialog open onOpenChange={(open) => { if (!open) setEditing(null) }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {RESOURCE_KIND_LABEL[editing.kind]} {editing.item ? '수정' : '추가'}
                </DialogTitle>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto">
                <ResourceItemForm
                  key={editing.item?.id ?? `new-${editing.kind}`}
                  kind={editing.kind}
                  payload={editing.item?.payload ?? null}
                  domainOptions={domains.data ?? []}
                  onCancel={() => setEditing(null)}
                  onSubmit={(payload) => {
                    if (editing.item) updateItem.mutate({ itemId: editing.item.id, payload })
                    else createItem.mutate({ libraryId: library.id, kind: editing.kind, payload })
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 탭 하나 — 검색창(300ms 디바운스)·표·페이지. 탭을 바꾸면 다시 마운트되지만 상태는 부모가 들고 있다. */
function KindTab({
  libraryId, kind, state, canManage, domainName, onQueryChange, onPageChange, onAdd, onEdit, onRemove,
}: {
  libraryId: string
  kind: ResourceKind
  state: TabState
  canManage: boolean
  domainName: (id: string | null) => string
  onQueryChange: (query: string) => void
  onPageChange: (page: number) => void
  onAdd: () => void
  onEdit: (item: ItemRow) => void
  onRemove: (item: ItemRow) => void
}) {
  const trpc = useTRPC()
  const query = useDebouncedValue(state.query, SEARCH_DEBOUNCE_MS).trim()
  const result = useQuery({
    ...trpc.resource.items.page.queryOptions({
      libraryId, kind, ...(query === '' ? {} : { query }),
      offset: (state.page - 1) * PAGE_SIZE, limit: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  })
  const total = result.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 마지막 쪽의 마지막 항목을 지우면 그 쪽이 빈다 — 남은 마지막 쪽으로 물러난다(빈 쪽에 갇히지 않게).
  useEffect(() => {
    if (result.data && result.data.items.length === 0 && result.data.total > 0 && state.page > pageCount) {
      onPageChange(pageCount)
    }
  }, [result.data, state.page, pageCount, onPageChange])

  const columns = columnsOf(kind)
  const label = RESOURCE_KIND_LABEL[kind]
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Input aria-label={`${label} 검색`} placeholder="논리명·물리명 검색" value={state.query}
          maxLength={SEARCH_MAX_LENGTH} onChange={(e) => onQueryChange(e.target.value)} />
        {canManage && (
          <Button type="button" size="sm" variant="outline" onClick={onAdd}><Plus /> 추가</Button>
        )}
      </div>
      {result.isError && <p role="alert" className="text-destructive">{result.error.message}</p>}
      {result.data && result.data.total === 0 && (
        <p className="text-sm text-muted-foreground">
          {query !== '' ? '검색 결과가 없습니다' : '항목이 없습니다'}
        </p>
      )}
      {result.data && result.data.items.length > 0 && (
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
                <TableHead>버전</TableHead>
                {canManage && <TableHead><span className="sr-only">작업</span></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.items.map((raw) => {
                const item = raw as ItemRow
                const cells = cellsOf(kind, item.payload, domainName)
                const name = cells[0]!
                return (
                  <TableRow key={item.id}>
                    {cells.map((cell, i) => (
                      <TableCell key={columns[i]}
                        className={i === 1 && (kind === 'word' || kind === 'term') ? 'font-mono text-xs' : undefined}>
                        {cell}
                      </TableCell>
                    ))}
                    <TableCell className="text-xs text-muted-foreground">v{item.version}</TableCell>
                    {canManage && (
                      <TableCell>
                        <span className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="size-6" aria-label={`${name} 편집`}
                            onClick={() => onEdit(item)}>
                            <Pencil className="size-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-6 text-destructive"
                            aria-label={`${name} 삭제`} onClick={() => onRemove(item)}>
                            <Trash2 className="size-3" />
                          </Button>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination label={label} page={Math.min(state.page, pageCount)} pageCount={pageCount} total={total}
        onPageChange={onPageChange} listRef={listRef} />
    </div>
  )
}
