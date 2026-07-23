export const DIALECTS = ['postgresql', 'mysql', 'oracle', 'mssql'] as const
export type Dialect = (typeof DIALECTS)[number]
