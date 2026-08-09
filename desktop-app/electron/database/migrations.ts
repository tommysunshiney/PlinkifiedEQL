import type { Database as DatabaseHandle } from 'better-sqlite3'
import initialSchema from './schema/001_initial_schema.sql?raw'
import persistentJournal from './schema/002_persistent_journal.sql?raw'

type Migration = {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: initialSchema
  },
  {
    version: 2,
    name: 'persistent_journal',
    sql: persistentJournal
  }
]

export function runMigrations(database: DatabaseHandle): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const appliedVersions = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row: unknown) => Number((row as { version: number }).version))
  )

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql)
    database
      .prepare(
        'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
      )
      .run(migration.version, migration.name)
  })

  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(migration)
    }
  }

  const row = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number }

  return Number(row.version)
}
