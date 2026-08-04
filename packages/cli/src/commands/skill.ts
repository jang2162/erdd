import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError, emit } from '../output.js'
import { run, type CommandCtx } from './context.js'

export type SkillCtx = CommandCtx & { sub?: string; dir?: string; force: boolean }

export const DEFAULT_SKILL_DIR = '.claude/skills/erdd'

/** 패키지에 동봉된 SKILL.md. CLI는 빌드 없이 tsx로 돌므로 소스 위치 기준으로 찾는다. */
function packagedSkill(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../skill/SKILL.md')
}

export function skill(ctx: SkillCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.sub !== 'install') {
      throw new CliError('USAGE', '사용법: erdd skill install [--dir <경로>] [--force]')
    }
    const targetDir = join(ctx.cwd, ctx.dir ?? DEFAULT_SKILL_DIR)
    const target = join(targetDir, 'SKILL.md')
    const exists = await stat(target).then(() => true, () => false)
    if (exists && !ctx.force) {
      throw new CliError('VALIDATION', `${target}가 이미 있습니다. 덮어쓰려면 --force를 쓰세요`)
    }
    await mkdir(targetDir, { recursive: true })
    await copyFile(packagedSkill(), target)
    emit(ctx.json, `스킬을 설치했습니다: ${target}`, { ok: true, path: target, overwritten: exists })
    return 0
  })
}
