import { app } from 'electron'
import path from 'node:path'
import Database, { type Database as DatabaseHandle } from 'better-sqlite3'
import bossSeed from '../../resources/bosses.seed.json'
import { runMigrations } from './migrations'
import type {
  BossRecord,
  BossSeedRecord,
  DatabaseStatus,
  JournalEntryInput,
  JournalRecord
} from './types'

let database: DatabaseHandle | null = null
let databasePath = ''
let schemaVersion = 0

export function normalizeNpcName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^an?\s+|^the\s+/i, '')
    .replace(/\s+/g, ' ')
}

function seedNamedMobs(records: BossSeedRecord[]) {
  if (!database || records.length === 0) return

  const insert = database.prepare(`
    INSERT INTO named_mobs (
      npc_name,
      title,
      normalized_npc_name,
      zone_name,
      aliases_json,
      known_drops_json,
      wiki_page_title,
      wiki_url,
      source_revision
    ) VALUES (
      @npcName,
      @title,
      @normalizedNpcName,
      @zone,
      @aliasesJson,
      @knownDropsJson,
      @wikiPageTitle,
      @wikiUrl,
      @sourceRevision
    )
    ON CONFLICT(normalized_npc_name, zone_name) DO UPDATE SET
      npc_name = excluded.npc_name,
      title = excluded.title,
      aliases_json = excluded.aliases_json,
      known_drops_json = excluded.known_drops_json,
      wiki_page_title = excluded.wiki_page_title,
      wiki_url = excluded.wiki_url,
      source_revision = excluded.source_revision,
      imported_at = CURRENT_TIMESTAMP
  `)

  const seedAll = database.transaction((seedRecords: BossSeedRecord[]) => {
    for (const record of seedRecords) {
      insert.run({
        ...record,
        normalizedNpcName: normalizeNpcName(record.npcName),
        aliasesJson: JSON.stringify(record.aliases),
        knownDropsJson: JSON.stringify(record.knownDrops)
      })
    }
  })

  seedAll(records)
}

export function initializeDatabase(): DatabaseStatus {
  if (database) return getDatabaseStatus()

  databasePath = path.join(app.getPath('userData'), 'peql.db')
  database = new Database(databasePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  schemaVersion = runMigrations(database)
  seedNamedMobs(bossSeed as BossSeedRecord[])

  return getDatabaseStatus()
}

export function getDatabaseStatus(): DatabaseStatus {
  const bossCount = database
    ? Number(
        (
          database
            .prepare('SELECT COUNT(*) AS count FROM named_mobs')
            .get() as { count: number }
        ).count
      )
    : 0

  const journalCount = database
    ? Number(
        (
          database
            .prepare('SELECT COUNT(*) AS count FROM journal_entries')
            .get() as { count: number }
        ).count
      )
    : 0

  return {
    ready: database !== null,
    path: databasePath,
    schemaVersion,
    bossCount,
    journalCount
  }
}

export function searchBosses(query: string, zone?: string): BossRecord[] {
  if (!database) throw new Error('PEQL database is not initialized.')

  const normalizedQuery = `%${normalizeNpcName(query)}%`
  const rows = zone
    ? database
        .prepare(`
          SELECT * FROM named_mobs
          WHERE normalized_npc_name LIKE ?
            AND LOWER(COALESCE(zone_name, '')) = LOWER(?)
          ORDER BY title IS NULL, COALESCE(title, npc_name), npc_name
          LIMIT 50
        `)
        .all(normalizedQuery, zone)
    : database
        .prepare(`
          SELECT * FROM named_mobs
          WHERE normalized_npc_name LIKE ?
             OR LOWER(COALESCE(title, '')) LIKE LOWER(?)
             OR LOWER(aliases_json) LIKE LOWER(?)
          ORDER BY title IS NULL, COALESCE(title, npc_name), npc_name
          LIMIT 50
        `)
        .all(normalizedQuery, `%${query}%`, `%${query}%`)

  return rows.map((row: unknown) => {
    const value = row as Record<string, unknown>
    return {
      id: Number(value.id),
      npcName: String(value.npc_name),
      title: value.title ? String(value.title) : null,
      zone: value.zone_name ? String(value.zone_name) : null,
      aliases: JSON.parse(String(value.aliases_json ?? '[]')) as string[],
      knownDrops: JSON.parse(
        String(value.known_drops_json ?? '[]')
      ) as string[],
      wikiPageTitle: String(value.wiki_page_title),
      wikiUrl: String(value.wiki_url),
      sourceRevision: value.source_revision
        ? Number(value.source_revision)
        : null
    }
  })
}

function ensureJournalSession(logFilePath: string, startedAt: string): number {
  if (!database) throw new Error('PEQL database is not initialized.')

  const existing = database
    .prepare(`
      SELECT id
      FROM sessions
      WHERE log_file_path = ?
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(logFilePath) as { id: number } | undefined

  if (existing) return Number(existing.id)

  const result = database
    .prepare(`
      INSERT INTO sessions (
        character_name,
        log_file_path,
        started_at
      ) VALUES (?, ?, ?)
    `)
    .run(null, logFilePath, startedAt)

  return Number(result.lastInsertRowid)
}

export function saveJournalEntries(
  logFilePath: string,
  entries: JournalEntryInput[]
): number {
  if (!database) throw new Error('PEQL database is not initialized.')
  if (!logFilePath || entries.length === 0) return 0

  const startedAt =
    entries
      .map((entry) => entry.occurredAt)
      .filter(Boolean)
      .sort()[0] ?? new Date().toISOString()

  const sessionId = ensureJournalSession(logFilePath, startedAt)

  const insert = database.prepare(`
    INSERT OR IGNORE INTO journal_entries (
      session_id,
      encounter_id,
      entry_type,
      occurred_at,
      title,
      narrative,
      metadata_json,
      source_key,
      zone_name
    ) VALUES (
      @sessionId,
      NULL,
      @entryType,
      @occurredAt,
      @title,
      @narrative,
      @metadataJson,
      @sourceKey,
      @zoneName
    )
  `)

  const saveAll = database.transaction((records: JournalEntryInput[]) => {
    let inserted = 0

    for (const entry of records) {
      const result = insert.run({
        sessionId,
        entryType: entry.entryType,
        occurredAt: entry.occurredAt,
        title: entry.title,
        narrative: entry.narrative,
        metadataJson: entry.metadata
          ? JSON.stringify(entry.metadata)
          : null,
        sourceKey: entry.sourceKey,
        zoneName: entry.zoneName ?? null
      })

      inserted += result.changes
    }

    return inserted
  })

  return saveAll(entries)
}

export function listJournalEntries(limit = 2000): JournalRecord[] {
  if (!database) throw new Error('PEQL database is not initialized.')

  const safeLimit = Math.max(1, Math.min(10000, Math.trunc(limit)))

  const rows = database
    .prepare(`
      SELECT
        id,
        session_id,
        entry_type,
        occurred_at,
        title,
        narrative,
        zone_name,
        metadata_json
      FROM journal_entries
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `)
    .all(safeLimit)

  return rows.map((row: unknown) => {
    const value = row as Record<string, unknown>

    let metadata: Record<string, unknown> = {}
    try {
      metadata = JSON.parse(
        String(value.metadata_json ?? '{}')
      ) as Record<string, unknown>
    } catch {
      metadata = {}
    }

    return {
      id: Number(value.id),
      sessionId: Number(value.session_id),
      entryType: String(value.entry_type),
      occurredAt: String(value.occurred_at),
      title: String(value.title),
      narrative: String(value.narrative),
      zoneName: value.zone_name ? String(value.zone_name) : null,
      metadata
    }
  })
}

export function closeDatabase() {
  database?.close()
  database = null
}
