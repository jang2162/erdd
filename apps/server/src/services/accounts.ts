import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { Db, DbOrTx } from '../db/client.js'
import { members, organizations, users } from '../db/schema.js'
import { hashPassword } from '../auth/password.js'

/** 이메일을 저장·조회 전반에서 일관되게 비교할 수 있도록 정규화한다. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * 사용자 + 개인 조직 + owner 멤버를 한 트랜잭션으로 생성한다(관리자 페이지·부트스트랩·초대 수락 공용).
 *
 * `db`에 호출자의 트랜잭션을 넘겨도 된다 — drizzle의 중첩 transaction은 SAVEPOINT로 열려
 * 바깥 트랜잭션과 함께 커밋·롤백된다(실측). 그래서 "이미 트랜잭션 안"임을 알리는 플래그가 없다.
 * 세 가지가 갈라지지 않는 것이 이 함수의 존재 이유이고, 이메일 정규화도 여기서만 한다 —
 * 호출자가 각자 부르면 한 곳이 빠진다.
 */
export async function createAccount(
  db: DbOrTx,
  input: { email: string; name: string; password: string; role: 'admin' | 'user' },
): Promise<{ id: string; email: string }> {
  const email = normalizeEmail(input.email)
  const passwordHash = await hashPassword(input.password)
  return db.transaction(async (tx) => {
    const user = (
      await tx.insert(users).values({
        id: uuidv7(), email, name: input.name, passwordHash, role: input.role,
      }).returning({ id: users.id, email: users.email })
    )[0]!
    const org = (
      await tx.insert(organizations).values({
        id: uuidv7(), name: `${input.name}의 공간`, kind: 'personal',
      }).returning({ id: organizations.id })
    )[0]!
    await tx.insert(members).values({ id: uuidv7(), orgId: org.id, userId: user.id, role: 'owner' })
    return user
  })
}

/** env ADMIN_EMAIL/ADMIN_PASSWORD가 있고 해당 이메일 계정이 없으면 admin 계정을 만든다. */
export async function ensureBootstrapAdmin(db: Db): Promise<void> {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  const normalized = normalizeEmail(email)
  const existing = (
    await db.select({ id: users.id }).from(users).where(eq(users.email, normalized))
  )[0]
  if (existing) return
  await createAccount(db, { email, name: '관리자', password, role: 'admin' })
  console.log(`부트스트랩 관리자 계정 생성: ${email}`)
}
