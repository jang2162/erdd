export type CliErrorCode =
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'NO_CONFIG'
  | 'NETWORK' | 'VALIDATION' | 'USAGE' | 'CANCELLED' | 'CONFLICT'

export class CliError extends Error {
  readonly code: CliErrorCode
  /**
   * --json 오류 봉투의 `error` 객체에 함께 실을 사실들. 던져서 끝나는 자리는 자기 봉투를
   * 만들지 못하는데, 그 사이에 워킹트리가 이미 바뀌었다면(push의 신규 id 기록) 소비자가
   * 그것을 알 길이 없다. 기존 `{code, message}`에 키를 더하기만 하므로 모양은 그대로다.
   */
  readonly details: Readonly<Record<string, unknown>>
  constructor(code: CliErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.details = details
  }
}

export function exitCodeFor(code: CliErrorCode): 1 | 2 {
  return code === 'USAGE' ? 2 : 1
}

/** --json이면 stdout에 JSON 한 덩어리, 아니면 사람용 문구. 진행 메시지는 note()가 stderr로. */
export function emit(json: boolean, human: string, payload: unknown): void {
  // JSON.stringify(undefined)는 문자열이 아니라 undefined를 돌려준다 — 그대로 쓰면
  // stdout에 리터럴 "undefined"가 나가 JSON.parse가 깨진다. null로 정규화한다.
  process.stdout.write(json ? `${JSON.stringify(payload ?? null)}\n` : `${human}\n`)
}

export function emitError(json: boolean, err: CliError): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: { code: err.code, message: err.message, ...err.details } })}\n`)
    return
  }
  process.stderr.write(`오류: ${err.message}\n`)
}

/** 진행 상황·프롬프트. 항상 stderr — stdout은 --json의 것이다. */
export function note(message: string): void {
  process.stderr.write(`${message}\n`)
}
