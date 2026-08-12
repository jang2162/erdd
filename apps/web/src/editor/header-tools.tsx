import { useState } from 'react'
import { BookOpen, ChevronDown } from 'lucide-react'
import { DomainPanel } from './domain-panel.js'
import { DictPanel } from './dict-panel.js'
import { CustomFieldPanel } from './custom-field-panel.js'
import { ResourcePanel } from './resource-panel.js'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** 상단 우측에서 열 수 있는 관리 도구. 한 번에 하나만 열린다. */
type ToolId = 'domain' | 'dict' | 'customField' | 'resource'

/**
 * 상단 우측 관리 도구. 열린 도구를 **단일 상태**로 들어 두 다이얼로그가 동시에 열리는 상태가
 * 구조적으로 생기지 않게 한다(설계 D5). 다이얼로그는 드롭다운 **바깥**에 마운트한다 — 메뉴 안에
 * 두면 메뉴가 닫힐 때 함께 언마운트된다.
 */
export function HeaderTools({ projectId }: { projectId: string }) {
  const [tool, setTool] = useState<ToolId | null>(null)
  const close = (open: boolean) => { if (!open) setTool(null) }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <BookOpen />
            사전·리소스
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setTool('domain')}>도메인</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('dict')}>단어·용어 사전</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('customField')}>커스텀 항목</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTool('resource')}>공용 리소스</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DomainPanel projectId={projectId} open={tool === 'domain'} onOpenChange={close} />
      <DictPanel projectId={projectId} open={tool === 'dict'} onOpenChange={close} />
      <CustomFieldPanel projectId={projectId} open={tool === 'customField'} onOpenChange={close} />
      <ResourcePanel projectId={projectId} open={tool === 'resource'} onOpenChange={close} />
    </>
  )
}
