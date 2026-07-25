import type { Dialect } from '@erdd/core'

export const DIALECT_LABEL: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL·MariaDB', oracle: 'Oracle', mssql: 'MSSQL',
}
