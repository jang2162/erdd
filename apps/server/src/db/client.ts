import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type Db = NodePgDatabase<typeof schema>
/** `db.transaction(cb)`이 콜백에 넘기는 값. drizzle에서 중첩 transaction은 SAVEPOINT다. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/**
 * 자체 트랜잭션을 열든 호출자의 트랜잭션 위에서 돌든 상관없는 코드가 받는 타입.
 * 이것을 받는 함수는 "트랜잭션 안인가"를 묻는 플래그가 필요 없다.
 */
export type DbOrTx = Db | Tx

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url })
  return { db: drizzle(pool, { schema }), pool }
}
