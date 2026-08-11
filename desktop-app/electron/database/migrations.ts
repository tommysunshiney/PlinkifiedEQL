import type { Database as DatabaseHandle } from 'better-sqlite3'
import initialSchema from './schema/001_initial_schema.sql?raw'
import persistentJournal from './schema/002_persistent_journal.sql?raw'
import encounterHistory from './schema/003_encounter_history.sql?raw'
import combatAnalytics from './schema/004_combat_analytics.sql?raw'

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
  },
  {
    version: 3,
    name: 'encounter_history',
    sql: encounterHistory
  },
  {
    version: 4,
    name: 'combat_analytics',
    sql: combatAnalytics
  }
]


function ensureEncounterCompatibility(database: DatabaseHandle): void {
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'encounters'"
    )
    .get() as { name?: string } | undefined

  if (!table?.name) return

  const columns = database
    .prepare("PRAGMA table_info(encounters)")
    .all() as Array<{ name: string }>

  if (!columns.some((column) => column.name === 'mob_breakdown_json')) {
    database.exec(
      "ALTER TABLE encounters ADD COLUMN mob_breakdown_json TEXT NOT NULL DEFAULT '[]'"
    )
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS player_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      encounter_source_key TEXT,
      created_at TEXT NOT NULL,
      zone_name TEXT,
      note_text TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_player_notes_created_at
      ON player_notes(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_player_notes_encounter_source
      ON player_notes(session_id, encounter_source_key);
  `)
}


function repairPlayerNotesForeignKey(database: DatabaseHandle): void {
  const exists = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'player_notes'"
    )
    .get() as { name?: string } | undefined

  if (!exists?.name) return

  const foreignKeys = database
    .prepare("PRAGMA foreign_key_list(player_notes)")
    .all() as Array<{ table: string }>

  const hasBadSessionForeignKey = foreignKeys.some(
    (foreignKey) => foreignKey.table === 'journal_sessions'
  )

  if (!hasBadSessionForeignKey) return

  database.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE player_notes_repaired (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      encounter_source_key TEXT,
      created_at TEXT NOT NULL,
      zone_name TEXT,
      note_text TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    INSERT INTO player_notes_repaired (
      id,
      session_id,
      encounter_source_key,
      created_at,
      zone_name,
      note_text
    )
    SELECT
      id,
      session_id,
      encounter_source_key,
      created_at,
      zone_name,
      note_text
    FROM player_notes;

    DROP TABLE player_notes;
    ALTER TABLE player_notes_repaired RENAME TO player_notes;

    CREATE INDEX IF NOT EXISTS idx_player_notes_created_at
      ON player_notes(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_player_notes_encounter_source
      ON player_notes(session_id, encounter_source_key);

    PRAGMA foreign_keys = ON;
  `)
}

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

  ensureEncounterCompatibility(database)
  repairPlayerNotesForeignKey(database)

  const row = database
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number }

  return Number(row.version)
}
