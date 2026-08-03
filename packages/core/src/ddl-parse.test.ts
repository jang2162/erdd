import { describe, expect, it } from 'vitest'
import { detectDialect, parseDdl, splitStatements, unquoteIdentifier } from './ddl-parse.js'

describe('splitStatements', () => {
  it('세미콜론으로 나누고 각 문장의 시작 줄 번호를 남긴다', () => {
    const s = splitStatements('CREATE TABLE A (X INT);\nCREATE TABLE B (Y INT);')
    expect(s).toHaveLength(2)
    expect(s[0]!.line).toBe(1)
    expect(s[1]!.line).toBe(2)
  })

  it('줄 주석과 블록 주석을 제거하되 줄 번호는 유지한다', () => {
    const s = splitStatements('-- 머리말\n/* 블록\n   주석 */\nCREATE TABLE A (X INT);')
    expect(s).toHaveLength(1)
    expect(s[0]!.text).toContain('CREATE TABLE A')
    expect(s[0]!.line).toBe(4)
  })

  it('문자열 리터럴 안의 세미콜론·주석 기호로 나누지 않는다', () => {
    const s = splitStatements("COMMENT ON TABLE A IS 'a;b -- c';\nCREATE TABLE B (Y INT);")
    expect(s).toHaveLength(2)
    expect(s[0]!.text).toContain("'a;b -- c'")
  })

  it('문자열 안의 작은따옴표 이스케이프를 문자열의 일부로 본다', () => {
    const s = splitStatements("COMMENT ON TABLE A IS 'it''s; ok';\nCREATE TABLE B (Y INT);")
    expect(s).toHaveLength(2)
  })

  it('Oracle 스크립트의 / 구분자로도 나눈다', () => {
    const s = splitStatements('CREATE TABLE A (X INT)\n/\nCREATE TABLE B (Y INT)\n/')
    expect(s).toHaveLength(2)
  })

  it('빈 문장을 버린다', () => {
    expect(splitStatements(';;\n  \n;')).toEqual([])
  })

  it('CRLF 줄바꿈에서도 Oracle / 구분자와 줄 번호가 정상이다', () => {
    const s = splitStatements('CREATE TABLE A (X INT)\r\n/\r\nCREATE TABLE B (Y INT)\r\n/')
    expect(s).toHaveLength(2)
    expect(s[0]!.line).toBe(1)
    expect(s[1]!.line).toBe(3)
  })

  it('CRLF 줄바꿈에서 줄 주석이 문장을 삼키지 않는다', () => {
    const s = splitStatements('-- 머리말\r\nCREATE TABLE A (X INT);\r\nCREATE TABLE B (Y INT);')
    expect(s).toHaveLength(2)
    expect(s[0]!.line).toBe(2)
  })
})

describe('unquoteIdentifier', () => {
  it('방언별 따옴표를 벗긴다', () => {
    expect(unquoteIdentifier('"MBR"')).toBe('MBR')
    expect(unquoteIdentifier('`MBR`')).toBe('MBR')
    expect(unquoteIdentifier('[MBR]')).toBe('MBR')
    expect(unquoteIdentifier('MBR')).toBe('MBR')
  })

  it('스키마 접두사를 떼고 마지막 조각만 남긴다', () => {
    expect(unquoteIdentifier('public.MBR')).toBe('MBR')
    expect(unquoteIdentifier('"public"."MBR"')).toBe('MBR')
    expect(unquoteIdentifier('[dbo].[MBR]')).toBe('MBR')
    expect(unquoteIdentifier('SCOTT.MBR')).toBe('MBR')
  })

  it('따옴표 안의 점은 구분자가 아니다', () => {
    expect(unquoteIdentifier('"a.b"')).toBe('a.b')
  })

  it('이스케이프된 따옴표를 되돌린다', () => {
    expect(unquoteIdentifier('"a""b"')).toBe('a"b')
  })
})

describe('detectDialect', () => {
  it('특징 토큰으로 방언을 맞힌다', () => {
    expect(detectDialect('CREATE TABLE `a` (id INT AUTO_INCREMENT);')).toBe('mysql')
    expect(detectDialect('CREATE TABLE a (id NUMBER(10), nm VARCHAR2(10), memo CLOB);')).toBe('oracle')
    expect(detectDialect('CREATE TABLE [a] ([id] INT IDENTITY(1,1), nm NVARCHAR(10));')).toBe('mssql')
    expect(detectDialect('CREATE TABLE a (id serial, doc jsonb, at timestamptz);')).toBe('postgresql')
  })

  it('근거가 없으면 null을 준다', () => {
    expect(detectDialect('CREATE TABLE a (id INT, nm VARCHAR(10));')).toBeNull()
  })
})

describe('parseDdl', () => {
  it('인식하지 못한 문장을 skipped에 키워드·줄 번호와 함께 남긴다', () => {
    const r = parseDdl('GRANT SELECT ON a TO b;\nCREATE SEQUENCE s;')
    expect(r.skipped.map((s) => s.keyword)).toEqual(['GRANT', 'CREATE SEQUENCE'])
    expect(r.skipped[0]!.line).toBe(1)
    expect(r.skipped[1]!.line).toBe(2)
    expect(r.skipped[0]!.excerpt).toContain('GRANT SELECT')
  })

  it('빈 입력에서 빈 결과를 준다', () => {
    expect(parseDdl('')).toEqual({
      tables: [], constraints: [], indexes: [], comments: [], skipped: [],
    })
  })
})
