import { useState } from 'react'
import { BookOpen, ChevronDown, FolderOpen, History, ListChecks } from 'lucide-react'
import { useEditorStore } from './store.js'
import { useWarnings } from './use-warnings.js'
import { DomainPanel } from './domain-panel.js'
import { DictPanel } from './dict-panel.js'
import { CustomFieldPanel } from './custom-field-panel.js'
import { ResourcePanel } from './resource-panel.js'
import { VersionDialog } from './version-dialog.js'
import { NamingCheck } from './naming-check.js'
import { DdlImportDialog } from './ddl-import-dialog.js'
import { ExportDialog } from './export-dialog.js'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsLocal } from '@/components/require-auth'

/** 상단 우측에서 열 수 있는 관리 도구. 한 번에 하나만 열린다. */
type ToolId =
  | 'version' | 'domain' | 'dict' | 'customField'
  | 'resource' | 'namingCheck' | 'ddlImport' | 'export'

/**
 * 상단 우측 관리 도구. 열린 도구를 **단일 상태**로 들어 두 다이얼로그가 동시에 열리는 상태가
 * 구조적으로 생기지 않게 한다(설계 D5). 다이얼로그는 드롭다운 **바깥**에 마운트한다 — 메뉴 안에
 * 두면 메뉴가 닫힐 때 함께 언마운트된다.
 *
 * 성격이 같은 넷(도메인·사전·커스텀 항목·공용 리소스)과 파일 둘(가져오기·내보내기)만 묶는다.
 * 버전은 이력, 모델 검사는 진단이라 성격이 달라 단독으로 두고, 특히 모델 검사는 경고 건수 배지가
 * 상시 보여야 해서 메뉴 안에 숨기면 신호가 죽는다(설계 D2).
 */
export function HeaderTools({ projectId }: { projectId: string }) {
  const [tool, setTool] = useState<ToolId | null>(null)
  const close = (open: boolean) => { if (!open) setTool(null) }
  const warnings = useWarnings()
  const canEdit = useEditorStore((s) => s.canEdit)
  // 공용 리소스는 서버의 라이브러리 테이블에 얹혀 있다 — 로컬 서버에는 그 프로시저가 없다.
  const isLocal = useIsLocal()

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setTool('version')}>
        <History />
        버전
      </Button>

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
          {!isLocal && (
            <DropdownMenuItem onSelect={() => setTool('resource')}>공용 리소스</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="sm" onClick={() => setTool('namingCheck')}>
        <ListChecks />
        {`모델 검사${warnings.length > 0 ? ` (${warnings.length})` : ''}`}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <FolderOpen />
            파일
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/*
            읽기 전용에는 가져오기 항목 자체를 렌더하지 않는다. 제어형이 되면서 다이얼로그가 스스로
            사라져도 **메뉴에는 눌러도 아무 일 없는 죽은 항목이 남으므로** 가드가 여기로 왔다(설계 3.3).
          */}
          {canEdit && (
            <DropdownMenuItem onSelect={() => setTool('ddlImport')}>DDL·DBML 가져오기</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setTool('export')}>내보내기</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <VersionDialog projectId={projectId} open={tool === 'version'} onOpenChange={close} />
      <DomainPanel projectId={projectId} open={tool === 'domain'} onOpenChange={close} />
      <DictPanel projectId={projectId} open={tool === 'dict'} onOpenChange={close} />
      <CustomFieldPanel projectId={projectId} open={tool === 'customField'} onOpenChange={close} />
      {/*
        닫아 두는 것으로는 부족하다 — ResourcePanel 은 enabled 가드 없이 마운트 즉시
        resource.library.listForProject 를 부른다. 로컬 라우터에 없는 프로시저다.
      */}
      {!isLocal && <ResourcePanel projectId={projectId} open={tool === 'resource'} onOpenChange={close} />}
      <NamingCheck projectId={projectId} open={tool === 'namingCheck'} onOpenChange={close} />
      <DdlImportDialog projectId={projectId} open={tool === 'ddlImport'} onOpenChange={close} />
      <ExportDialog open={tool === 'export'} onOpenChange={close} />
    </>
  )
}
