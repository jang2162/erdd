export type CliErrorCode =
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'NO_CONFIG'
  | 'NETWORK' | 'VALIDATION' | 'USAGE' | 'CANCELLED'

export class CliError extends Error {
  readonly code: CliErrorCode
  constructor(code: CliErrorCode, message: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
  }
}

export function exitCodeFor(code: CliErrorCode): 1 | 2 {
  return code === 'USAGE' ? 2 : 1
}

/** --json이면 stdout에 JSON 한 덩어리, 아니면 사람용 문구. 진행 메시지는 note()가 stderr로. */
export function emit(json: boolean, human: string, payload: unknown): void {
  process.stdout.write(json ? `${JSON.stringify(payload)}\n` : `${human}\n`)
}

export function emitError(json: boolean, err: CliError): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: { code: err.code, message: err.message } })}\n`)
    return
  }
  process.stderr.write(`오류: ${err.message}\n`)
}

/** 진행 상황·프롬프트. 항상 stderr — stdout은 --json의 것이다. */
export function note(message: string): void {
  process.stderr.write(`${message}\n`)
}
