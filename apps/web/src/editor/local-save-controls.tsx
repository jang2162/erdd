import { useState } from 'react'
import { ChevronDown, Save } from 'lucide-react'
import { useEditorStore } from './store.js'
import { useLocalSave } from './use-local-save.js'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * 로컬 모드 헤더의 저장 컨트롤. **`isLocal` 일 때만 렌더한다**(`project.tsx`) — 서버 모드에서는
 * 마운트되지 않으므로 `Cmd+S` 리스너도 붙지 않는다(닫아 두는 것이 아니라 렌더하지 않는 것,
 * HANDOFF 3.18 의 같은 규칙).
 *
 * 자리는 `HeaderTools` **앞**이다 — `HeaderTools` 는 다이얼로그를 여는 도구 모음이고 저장은
 * 문서 수준 동작이라 성격이 다르다.
 */
export function LocalSaveControls() {
  const { dirty, saving, save, discard } = useLocalSave()
  const blocked = useEditorStore((s) => s.blocked)
  const [confirming, setConfirming] = useState(false)

  const onDiscard = () => {
    setConfirming(false)
    void discard()
  }

  return (
    <>
      {dirty && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          미저장
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        // 파일이 깨져 편집이 잠긴 동안에는 저장도 막힌다 — 성한 화면으로 깨진 파일을 덮어쓰면
        // 손으로 고치던 내용이 사라진다.
        disabled={!dirty || saving || blocked !== null}
        onClick={() => { void save() }}
      >
        <Save />
        저장
      </Button>

      {/*
        「버릴 시도가 diff 를 더럽힌다」가 이 사이클의 동기 중 하나다 — 버리는 수단이 없으면
        드래프트가 재시작을 넘어 살아남아 없앨 방법이 아예 없다.
      */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="저장 옵션">
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!dirty} onSelect={() => setConfirming(true)}>
            변경 버리기
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>저장하지 않은 변경을 버릴까요?</DialogTitle>
            <DialogDescription>
              화면의 편집을 버리고 파일에 저장된 내용으로 되돌립니다. 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>취소</Button>
            <Button variant="destructive" onClick={onDiscard}>변경 버리기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * 외부 변경 배너. `blocked` 배너 **아래**에 둔다 — 편집이 잠긴 것이 더 급한 사실이다.
 *
 * ⚠️ **문구가 대가를 말해야 한다**(설계 §13 ①, 사용자 확정). 「내 편집 유지」를 고르면 기준선이
 * 지금 디스크로 옮겨져, 이어지는 저장이 **화면 그대로** 파일을 만든다 — 밖에서 추가된 파일도
 * 지워진다. 그것을 모르고 고르면 남의 작업을 말없이 잃는다.
 */
export function LocalSaveBanner() {
  const { external, keep, discard } = useLocalSave()
  const [confirming, setConfirming] = useState(false)

  if (!external) return null

  const onReload = () => {
    setConfirming(false)
    void discard()
  }

  return (
    <>
      <div
        role="alert"
        className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-amber-500/10 px-4 py-2 text-sm"
      >
        <span>
          파일이 밖에서 바뀌었습니다. <strong>내 편집을 유지하면 저장할 때 화면의 내용이 파일을
          덮어씁니다.</strong>
        </span>
        <span className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { void keep() }}>내 편집 유지</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            파일 다시 읽기
          </Button>
        </span>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>파일을 다시 읽을까요?</DialogTitle>
            <DialogDescription>
              저장하지 않은 편집을 버리고 파일의 내용으로 화면을 되돌립니다. 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>취소</Button>
            <Button variant="destructive" onClick={onReload}>파일 다시 읽기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
