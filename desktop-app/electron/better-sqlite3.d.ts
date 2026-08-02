declare module 'better-sqlite3' {
  export type RunResult = {
    changes: number
    lastInsertRowid: number | bigint
  }

  export interface Statement {
    run(...params: unknown[]): RunResult
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  export interface Database {
    exec(sql: string): this
    pragma(source: string): unknown
    prepare(sql: string): Statement
    transaction<T extends (...args: any[]) => any>(fn: T): T
    close(): void
  }

  export default class DatabaseConstructor implements Database {
    constructor(filename: string)
    exec(sql: string): this
    pragma(source: string): unknown
    prepare(sql: string): Statement
    transaction<T extends (...args: any[]) => any>(fn: T): T
    close(): void
  }
}
