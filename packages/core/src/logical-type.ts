export type LogicalType =
  | { kind: 'INT' }
  | { kind: 'VARCHAR'; length: number }
  | { kind: 'DECIMAL'; precision: number; scale: number }

export type ParseResult =
  | { ok: true; type: LogicalType; canonical: string }
  | { ok: false; raw: string }

const ALIASES: Record<string, string> = {
  INTEGER: 'INT',
  VARCHAR2: 'VARCHAR',
  NUMERIC: 'DECIMAL',
  NUMBER: 'DECIMAL',
}

export function parseLogicalType(input: string): ParseResult {
  const raw = input.trim()
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/.exec(raw)
  if (!m) return { ok: false, raw }
  const name = m[1]!.toUpperCase().replace(/\s+/g, ' ')
  const kind = ALIASES[name] ?? name
  const p1 = m[2] === undefined ? undefined : Number(m[2])
  const p2 = m[3] === undefined ? undefined : Number(m[3])

  switch (kind) {
    case 'INT':
      if (p1 !== undefined) return { ok: false, raw }
      return { ok: true, type: { kind: 'INT' }, canonical: 'INT' }
    case 'VARCHAR':
      if (p1 === undefined) return { ok: false, raw }
      return { ok: true, type: { kind: 'VARCHAR', length: p1 }, canonical: `VARCHAR(${p1})` }
    case 'DECIMAL': {
      if (p1 === undefined) return { ok: false, raw }
      const scale = p2 ?? 0
      return {
        ok: true,
        type: { kind: 'DECIMAL', precision: p1, scale },
        canonical: `DECIMAL(${p1},${scale})`,
      }
    }
    default:
      return { ok: false, raw }
  }
}
