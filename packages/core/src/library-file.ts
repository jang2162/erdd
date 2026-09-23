import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { z } from 'zod'
import { DomainSchema } from './model.js'
import {
  RESOURCE_COLLECTION_BY_KIND, RESOURCE_KINDS, RESOURCE_PAYLOAD_SCHEMAS, resourceDisplayName,
  type ResourceKind,
} from './resource.js'
import type { LibraryItem } from './resource-sync.js'

/**
 * 공용 라이브러리 파일(`.erdd-lib.yaml`) — 서버 라이브러리의 내보내기·가져오기와
 * 로컬 `erdd dict pull --file` 이 주고받는 포맷이다(guides/shared-resources.md 「파일 내보내기·가져오기」).
 *
 * 엄격도가 둘이다. **배포 파일**(서버가 내보낸 것)은 라이브러리 id·항목 id·version 이 있고 payload 가
 * 완전값이다. **원천 파일**(사람·스크립트·Excel 이 만든 것)은 그것들을 생략할 수 있고, payload 의
 * 빠진 키는 「말하지 않음」이다 — 가져오기가 그 키의 기존 값을 건드리지 않는다.
 */
export const LIBRARY_FILE_FORMAT = 'erdd-library'
export const LIBRARY_FILE_VERSION = 1
export const LIBRARY_FILE_EXTENSION = '.erdd-lib.yaml'
export const MAX_LIBRARY_FILE_ITEMS = 50_000

export type LibraryFileEntry = {
  id?: string
  version?: number
  /** 용어 전용·원천 파일 전용 — 도메인을 이름으로 가리킨다. 해석은 가져오기 계획이 한다. */
  domainName?: string
  /** payload 필드. 배포 파일은 완전값, 원천 파일은 적힌 키만. 용어의 domainId 는 이 파일 안 도메인 id. */
  fields: Record<string, unknown>
}
export type LibraryFileMeta = { id?: string; name: string; description: string }
/** `kinds` 에 키가 있는 종류만 파일에 적혀 있던 것이다(빈 목록 포함) — 가져오기의 삭제 판정이 쓴다. */
export type LibraryFileDoc = { library: LibraryFileMeta; kinds: Partial<Record<ResourceKind, LibraryFileEntry[]>> }
export type LibraryFileStrictness = 'source' | 'distribution'
export type LibraryFileIssue = { path: string; message: string }

const TOP_KEYS: readonly string[] = [
  'format', 'formatVersion', 'library', ...RESOURCE_KINDS.map((k) => RESOURCE_COLLECTION_BY_KIND[k]),
]
const LIBRARY_KEYS: readonly string[] = ['id', 'name', 'description']
const DIALECT_KEYS = ['postgresql', 'mysql', 'oracle', 'mssql'] as const
const DIST_REQUIRED = '배포 파일에는 필수입니다 — 서버에서 내보낸 파일만 받을 수 있습니다'

/**
 * 원천 파일 검증용 스키마. 도메인의 dialectTypes 도 부분을 허용한다. **검증에만 쓰고 출력은 버린다** —
 * zod 4 는 `.partial()` 안의 `.default()` 를 채워, 말하지 않은 키(`englishName`)를 만들어 낸다.
 */
const SOURCE_SCHEMAS: Record<ResourceKind, z.ZodType> = {
  domain: RESOURCE_PAYLOAD_SCHEMAS.domain
    .extend({ dialectTypes: DomainSchema.shape.dialectTypes.partial() }).partial(),
  word: RESOURCE_PAYLOAD_SCHEMAS.word.partial(),
  term: RESOURCE_PAYLOAD_SCHEMAS.term.partial(),
  customField: RESOURCE_PAYLOAD_SCHEMAS.customField.partial(),
}
const REQUIRED_SOURCE_FIELDS: Record<ResourceKind, readonly string[]> = {
  domain: ['name', 'logicalType'], word: ['logicalName'],
  term: ['logicalName', 'physicalName'], customField: ['name', 'target', 'type'],
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const byId = <T extends { id: string }>(a: T, b: T): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const TYPE_LABEL: Record<string, string> = {
  string: '문자열', number: '숫자', int: '정수', boolean: '참/거짓', array: '목록', object: '객체', null: 'null',
}
function zodIssueText(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': return `${TYPE_LABEL[issue.expected] ?? issue.expected}이어야 합니다`
    case 'unrecognized_keys': return `모르는 키입니다: ${issue.keys.join(', ')}`
    case 'invalid_value': return `다음 중 하나여야 합니다: ${issue.values.map(String).join(', ')}`
    default: return issue.message
  }
}

function nameKey(kind: ResourceKind, fields: Record<string, unknown>): string {
  const name = resourceDisplayName(kind, fields).trim()
  return kind === 'customField' ? `${kind}\0${name}\0${String(fields.target)}` : `${kind}\0${name}`
}

export function parseLibraryFile(
  text: string, strictness: LibraryFileStrictness,
): { ok: true; doc: LibraryFileDoc } | { ok: false; issues: LibraryFileIssue[] } {
  let raw: unknown
  try {
    // 별칭 폭탄은 maxAliasCount 가, 중복 키는 기본 uniqueKeys 가 오류로 만든다.
    raw = parseYaml(text.replace(/^﻿/, ''), { maxAliasCount: 100 })
  } catch (err) {
    return { ok: false, issues: [{ path: '(파일)', message: `YAML 을 읽지 못했습니다 — ${(err as Error).message}` }] }
  }
  return parseLibraryValue(raw, strictness)
}

function parseLibraryValue(
  raw: unknown, strictness: LibraryFileStrictness,
): { ok: true; doc: LibraryFileDoc } | { ok: false; issues: LibraryFileIssue[] } {
  const fail = (path: string, message: string) => ({ ok: false as const, issues: [{ path, message }] })
  if (!isRec(raw)) return fail('(파일)', '최상위가 객체가 아닙니다')
  // 사용자가 고른 가져오기라서 모르는 포맷·버전을 조용히 삼키지 않는다(DDL 머릿말과 반대).
  if (raw.format !== LIBRARY_FILE_FORMAT) {
    return fail('format', `${LIBRARY_FILE_FORMAT} 이어야 합니다 — ERDD 라이브러리 파일이 아닙니다`)
  }
  if (raw.formatVersion !== LIBRARY_FILE_VERSION) {
    return fail('formatVersion',
      `이 ERDD 가 읽을 수 있는 버전은 ${LIBRARY_FILE_VERSION} 입니다(파일: ${String(raw.formatVersion)}) — ERDD 를 업그레이드하세요`)
  }
  let total = 0
  for (const kind of RESOURCE_KINDS) {
    const list = raw[RESOURCE_COLLECTION_BY_KIND[kind]]
    if (Array.isArray(list)) total += list.length
  }
  if (total > MAX_LIBRARY_FILE_ITEMS) {
    return fail('(파일)', `항목이 ${total}건입니다 — 한 파일에 ${MAX_LIBRARY_FILE_ITEMS}건까지 가져올 수 있습니다. 나눠서 가져오세요`)
  }

  const issues: LibraryFileIssue[] = []
  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) issues.push({ path: key, message: '모르는 키입니다' })

  const library: LibraryFileMeta = { name: '', description: '' }
  const lib = raw.library
  if (!isRec(lib)) issues.push({ path: 'library', message: '객체여야 합니다' })
  else {
    for (const key of Object.keys(lib)) if (!LIBRARY_KEYS.includes(key)) issues.push({ path: `library.${key}`, message: '모르는 키입니다' })
    if (lib.id !== undefined && (typeof lib.id !== 'string' || lib.id === '')) {
      issues.push({ path: 'library.id', message: '비어 있지 않은 문자열이어야 합니다' })
    } else if (lib.id === undefined && strictness === 'distribution') {
      issues.push({ path: 'library.id', message: DIST_REQUIRED })
    }
    if (typeof lib.name !== 'string' || lib.name.trim() === '') {
      issues.push({ path: 'library.name', message: '비어 있지 않은 문자열이어야 합니다' })
    }
    if (lib.description !== undefined && lib.description !== null && typeof lib.description !== 'string') {
      issues.push({ path: 'library.description', message: '문자열이어야 합니다' })
    }
    if (typeof lib.id === 'string' && lib.id !== '') library.id = lib.id
    if (typeof lib.name === 'string') library.name = lib.name
    if (typeof lib.description === 'string') library.description = lib.description
  }

  const kinds: LibraryFileDoc['kinds'] = {}
  const idAt = new Map<string, string>()
  const nameAt = new Map<string, string>()
  const domainIds = new Set<string>()
  for (const kind of RESOURCE_KINDS) {
    const key = RESOURCE_COLLECTION_BY_KIND[kind]
    if (!(key in raw)) continue
    const list = raw[key]
    if (!Array.isArray(list)) { issues.push({ path: key, message: '목록이어야 합니다' }); continue }
    const entries: LibraryFileEntry[] = []
    list.forEach((el: unknown, i) => {
      const at = `${key}[${i}]`
      if (!isRec(el)) { issues.push({ path: at, message: '객체여야 합니다' }); return }
      const { id, version, domainName, ...rest } = el
      const name = resourceDisplayName(kind, rest)
      const where = name === '' ? at : `${at} (${name})`

      if (id !== undefined && (typeof id !== 'string' || id === '')) {
        issues.push({ path: `${where}: id`, message: '비어 있지 않은 문자열이어야 합니다' })
      } else if (id === undefined && strictness === 'distribution') {
        issues.push({ path: `${where}: id`, message: DIST_REQUIRED })
      }
      if (version !== undefined && !(Number.isInteger(version) && (version as number) >= 1)) {
        issues.push({ path: `${where}: version`, message: '1 이상의 정수여야 합니다' })
      } else if (version !== undefined && id === undefined) {
        issues.push({ path: `${where}: version`, message: 'version 은 id 와 함께 적어야 합니다' })
      } else if (version === undefined && strictness === 'distribution') {
        issues.push({ path: `${where}: version`, message: DIST_REQUIRED })
      }
      if (domainName !== undefined) {
        if (kind !== 'term') issues.push({ path: `${where}: domainName`, message: '용어에만 쓸 수 있습니다' })
        else if (strictness === 'distribution') issues.push({ path: `${where}: domainName`, message: '배포 파일에는 쓸 수 없습니다 — domainId 로 가리키세요' })
        else if (typeof domainName !== 'string') issues.push({ path: `${where}: domainName`, message: '문자열이어야 합니다' })
        else if ('domainId' in rest) issues.push({ path: `${where}: domainName`, message: 'domainId 와 함께 쓸 수 없습니다' })
      }

      const schema = strictness === 'distribution' ? RESOURCE_PAYLOAD_SCHEMAS[kind] : SOURCE_SCHEMAS[kind]
      const parsed = schema.safeParse(rest)
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          issues.push({
            path: issue.path.length === 0 ? where : `${where}: ${issue.path.join('.')}`,
            message: zodIssueText(issue),
          })
        }
      }
      if (strictness === 'source') {
        for (const field of REQUIRED_SOURCE_FIELDS[kind]) {
          if (!(field in rest)) issues.push({ path: `${where}: ${field}`, message: '필수 필드가 없습니다' })
        }
      }
      if (typeof id === 'string' && id !== '') {
        const prev = idAt.get(id)
        if (prev !== undefined) issues.push({ path: `${where}: id`, message: `${prev} 와 id 가 같습니다` })
        else idAt.set(id, at)
        if (kind === 'domain') domainIds.add(id)
      }
      if (name.trim() !== '') {
        const nk = nameKey(kind, rest)
        const prev = nameAt.get(nk)
        if (prev !== undefined) issues.push({ path: where, message: `같은 이름이 ${prev} 에도 있습니다` })
        else nameAt.set(nk, at)
      }
      entries.push({
        ...(typeof id === 'string' && id !== '' ? { id } : {}),
        ...(typeof version === 'number' ? { version } : {}),
        ...(typeof domainName === 'string' ? { domainName } : {}),
        fields: strictness === 'distribution' && parsed.success
          ? parsed.data as Record<string, unknown>
          : { ...rest },
      })
    })
    kinds[kind] = entries
  }

  ;(kinds.term ?? []).forEach((entry, i) => {
    const target = entry.fields.domainId
    if (typeof target === 'string' && !domainIds.has(target)) {
      const name = resourceDisplayName('term', entry.fields)
      issues.push({ path: `terms[${i}] (${name}): domainId`, message: `이 파일에 id 가 ${target} 인 도메인이 없습니다` })
    }
  })

  return issues.length > 0 ? { ok: false, issues } : { ok: true, doc: { library, kinds } }
}

/** payload 키를 스키마 순서로 늘어놓는다 — 저장소(jsonb)의 키 순서와 무관하게 같은 바이트를 낸다. */
function orderedFields(kind: ResourceKind, fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(RESOURCE_PAYLOAD_SCHEMAS[kind].shape)) {
    if (!(key in fields)) continue
    const value = fields[key]
    if (kind === 'domain' && key === 'dialectTypes' && isRec(value)) {
      out[key] = Object.fromEntries(DIALECT_KEYS.filter((d) => d in value).map((d) => [d, value[d]]))
    } else out[key] = value
  }
  return out
}

export function stringifyLibraryFile(doc: LibraryFileDoc): string {
  const out: Record<string, unknown> = {
    format: LIBRARY_FILE_FORMAT,
    formatVersion: LIBRARY_FILE_VERSION,
    library: {
      ...(doc.library.id !== undefined ? { id: doc.library.id } : {}),
      name: doc.library.name,
      description: doc.library.description,
    },
  }
  for (const kind of RESOURCE_KINDS) {
    const entries = doc.kinds[kind]
    if (entries === undefined) continue
    out[RESOURCE_COLLECTION_BY_KIND[kind]] = entries.map((e) => ({
      ...(e.id !== undefined ? { id: e.id } : {}),
      ...(e.version !== undefined ? { version: e.version } : {}),
      ...orderedFields(kind, e.fields),
      ...(e.domainName !== undefined ? { domainName: e.domainName } : {}),
    }))
  }
  // lineWidth 0 — 긴 설명을 접지 않는다(접으면 diff 가 시끄럽다).
  return stringifyYaml(out, { lineWidth: 0 })
}

/**
 * 서버 라이브러리를 배포 파일로 쓴다. 종류는 `RESOURCE_KINDS` 순, 종류 안은 id 코드 단위 오름차순,
 * 타임스탬프 없음 — 같은 라이브러리 상태면 바이트가 같다. 네 종류 키를 언제나 모두 쓴다.
 *
 * 항목 삭제가 용어의 도메인 참조를 정리하지 않으므로, 삭제된 도메인을 가리키는 용어는 `domainId: null`
 * 로 쓰고 그 수를 돌려준다 — 파일의 「domainId 는 파일 안만 가리킨다」를 어기지 않기 위해서다.
 */
export function exportLibraryFile(
  library: { id: string; name: string; description: string }, items: readonly LibraryItem[],
): { text: string; danglingDomainRefs: number } {
  const domainIds = new Set(items.filter((i) => i.kind === 'domain').map((i) => i.id))
  let danglingDomainRefs = 0
  const kinds: LibraryFileDoc['kinds'] = {}
  for (const kind of RESOURCE_KINDS) {
    kinds[kind] = items.filter((i) => i.kind === kind).sort(byId).map((item) => {
      // 옛 행(키 누락)도 완전값으로 쓴다 — 기본값을 채운 스키마 출력을 쓴다.
      const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(item.payload)
      const fields: Record<string, unknown> = { ...(parsed.success ? parsed.data as Record<string, unknown> : item.payload) }
      if (kind === 'term' && typeof fields.domainId === 'string' && !domainIds.has(fields.domainId)) {
        fields.domainId = null
        danglingDomainRefs += 1
      }
      return { id: item.id, version: item.version, fields }
    })
  }
  return {
    text: stringifyLibraryFile({ library: { id: library.id, name: library.name, description: library.description }, kinds }),
    danglingDomainRefs,
  }
}

/** 배포 파일의 항목을 재동기화 입력(`planResync`)으로 — id 코드 단위 오름차순(결정성). */
export function libraryItemsOf(doc: LibraryFileDoc): LibraryItem[] {
  const out: LibraryItem[] = []
  for (const kind of RESOURCE_KINDS) {
    for (const e of doc.kinds[kind] ?? []) {
      if (e.id === undefined || e.version === undefined) {
        throw new Error('libraryItemsOf 는 배포 파일에만 쓴다 — id·version 이 없는 항목이 있다')
      }
      out.push({ id: e.id, kind, version: e.version, payload: e.fields })
    }
  }
  return out.sort(byId)
}

export function formatLibraryFileIssues(issues: readonly LibraryFileIssue[], max = 20): string[] {
  const lines = issues.slice(0, max).map((i) => `${i.path} — ${i.message}`)
  if (issues.length > max) lines.push(`… 외 ${issues.length - max}건`)
  return lines
}
