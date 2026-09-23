import { EXCEL_SHEET_NAME } from './excel-sheets.js'
import { planDictImport, type DictImportIssue, type RawSheet } from './excel-import.js'
import type { LibraryFileDoc, LibraryFileEntry } from './library-file.js'
import { createEmptyModel } from './model.js'

/**
 * 기존 Excel 사전 양식을 라이브러리 원천 파일 문서로 바꾼다. 서버가 받는 입력은 언제나 라이브러리 파일
 * 하나라서, Excel 은 클라(웹·CLI)가 이것으로 바꿔 직렬화해 보낸다.
 *
 * 헤더 해석·행 검증은 `planDictImport` 를 재사용한다. 그 `patch` 는 시트에 **있던 컬럼만** 담으므로
 * 그대로 원천 파일의 「적힌 키」가 된다 — 없는 컬럼은 말하지 않은 것이고 가져오기가 기존 값을 두지만,
 * draft 를 쓰면 영문명 컬럼이 없는 파일이 기존 영문명을 전부 지운다.
 */
export function libraryDocFromDictSheets(
  sheets: RawSheet[], opts: { name: string; targetDomainNames: readonly string[] },
): { ok: true; doc: LibraryFileDoc; warnings: DictImportIssue[] } | { ok: false; issues: DictImportIssue[] } {
  // 대상 라이브러리의 도메인 이름을 모델에 얹어, 「기본 도메인을 찾을 수 없다」 경고가 파일에도 대상에도
  // 없을 때만 나게 한다(해석 자체는 가져오기 계획이 이름으로 다시 한다).
  const model = createEmptyModel()
  opts.targetDomainNames.forEach((name, i) => {
    const id = `target:${i}`
    model.domains[id] = {
      id, name, category: null, logicalType: '',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
  })
  const plan = planDictImport(sheets, model)
  const errors = plan.issues.filter((i) => i.level === 'error')
  if (errors.length > 0) return { ok: false, issues: errors }

  const present = new Set(sheets.map((s) => s.key))
  const kinds: LibraryFileDoc['kinds'] = {}
  const domainIdByName = new Map<string, string>()
  if (present.has('domains')) {
    kinds.domain = []
    for (const e of plan.entries) {
      if (e.kind !== 'domain') continue
      const id = `domain:${e.row}`
      domainIdByName.set(e.draft.name.trim(), id)
      kinds.domain.push({ id, fields: { ...e.patch } })
    }
  }
  if (present.has('words')) {
    kinds.word = plan.entries.flatMap((e) => (e.kind === 'word' ? [{ fields: { ...e.patch } }] : []))
  }
  if (present.has('terms')) {
    kinds.term = plan.entries.flatMap((e): LibraryFileEntry[] => {
      if (e.kind !== 'term') return []
      const { domainName, ...rest } = e.patch
      if (domainName === undefined) return [{ fields: rest }]
      const fileId = domainIdByName.get(domainName.trim())
      return [fileId !== undefined ? { fields: { ...rest, domainId: fileId } } : { domainName, fields: rest }]
    })
  }
  return {
    ok: true,
    doc: { library: { name: opts.name, description: '' }, kinds },
    warnings: plan.issues.filter((i) => i.level === 'warning'),
  }
}

/** 화면·CLI 공용 문구 — `row` 는 1-based 데이터 행이라 Excel 행 번호는 +1 이다. */
export function dictIssueText(issue: DictImportIssue): string {
  const where = issue.row === null ? EXCEL_SHEET_NAME[issue.sheet] : `${EXCEL_SHEET_NAME[issue.sheet]} ${issue.row + 1}행`
  return `${where} — ${issue.message}`
}
