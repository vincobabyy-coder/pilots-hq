// Lightweight SQL query builder.
// Usage: select('users').where({org_id: 'x', status: 'active'}).limit(10).build()

interface QueryParts {
  table: string
  conditions: string[]
  params: unknown[]
  limitVal?: number
  offsetVal?: number
  orderByCol?: string
  orderDir?: 'ASC' | 'DESC'
  selectedCols: string[]
}

export class QueryBuilder {
  private parts: QueryParts

  constructor(table: string) {
    this.parts = { table, conditions: [], params: [], selectedCols: ['*'] }
  }

  select(...cols: string[]): this {
    this.parts.selectedCols = cols
    return this
  }

  where(conditions: Record<string, unknown>): this {
    for (const [col, val] of Object.entries(conditions)) {
      this.parts.params.push(val)
      this.parts.conditions.push(`${col} = $${this.parts.params.length}`)
    }
    return this
  }

  whereRaw(condition: string, params: unknown[]): this {
    const offset = this.parts.params.length
    this.parts.params.push(...params)
    // Re-number $1, $2 to $offset+1, $offset+2
    const reNumbered = condition.replace(/\$(\d+)/g, (_, n: string) => `$${parseInt(n) + offset}`)
    this.parts.conditions.push(reNumbered)
    return this
  }

  limit(n: number): this { this.parts.limitVal = n; return this }
  offset(n: number): this { this.parts.offsetVal = n; return this }
  orderBy(col: string, dir: 'ASC' | 'DESC' = 'ASC'): this {
    this.parts.orderByCol = col
    this.parts.orderDir = dir
    return this
  }

  build(): { sql: string; params: unknown[] } {
    const { table, conditions, params, limitVal, offsetVal, orderByCol, orderDir, selectedCols } = this.parts
    let sql = `SELECT ${selectedCols.join(', ')} FROM ${table}`
    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
    if (orderByCol) sql += ` ORDER BY ${orderByCol} ${orderDir ?? 'ASC'}`
    if (limitVal !== undefined) sql += ` LIMIT ${limitVal}`
    if (offsetVal !== undefined) sql += ` OFFSET ${offsetVal}`
    return { sql, params }
  }
}

export function select(table: string): QueryBuilder {
  return new QueryBuilder(table)
}
