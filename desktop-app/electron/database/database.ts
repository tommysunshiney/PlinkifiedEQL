import { app } from 'electron'
import path from 'node:path'
import Database, { type Database as DatabaseHandle } from 'better-sqlite3'
import bossSeed from '../../resources/bosses.seed.json'
import { runMigrations } from './migrations'
import type {
  BossRecord,
  BossSeedRecord,
  DatabaseStatus,
  EncounterInput,
  EncounterRecord,
  JournalEntryInput,
  JournalRecord,
  PlayerNoteInput,
  PlayerNoteRecord
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

  const encounterCount = database
    ? Number(
        (
          database
            .prepare('SELECT COUNT(*) AS count FROM encounters')
            .get() as { count: number }
        ).count
      )
    : 0

  return {
    ready: database !== null,
    path: databasePath,
    schemaVersion,
    bossCount,
    journalCount,
    encounterCount
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

function findNamedMobId(npcName: string, zoneName?: string): number | null {
  if (!database) return null

  const normalized = normalizeNpcName(npcName)
  const row = database
    .prepare(`
      SELECT id
      FROM named_mobs
      WHERE normalized_npc_name = ?
        AND (
          zone_name IS NULL
          OR ? IS NULL
          OR LOWER(zone_name) = LOWER(?)
        )
      ORDER BY
        CASE WHEN ? IS NOT NULL AND LOWER(COALESCE(zone_name, '')) = LOWER(?) THEN 0 ELSE 1 END,
        id
      LIMIT 1
    `)
    .get(
      normalized,
      zoneName ?? null,
      zoneName ?? null,
      zoneName ?? null,
      zoneName ?? null
    ) as { id: number } | undefined

  return row ? Number(row.id) : null
}

export function saveEncounters(
  logFilePath: string,
  encounters: EncounterInput[],
  mode: 'live' | 'replay' = 'live'
): number {
  if (!database) throw new Error('PEQL database is not initialized.')
  if (!logFilePath || encounters.length === 0) return 0

  const startedAt =
    encounters
      .map((encounter) => encounter.startedAt)
      .sort()[0] ?? new Date().toISOString()

  const sessionId = ensureJournalSession(logFilePath, startedAt)

  const insert = database.prepare(`
    INSERT OR IGNORE INTO encounters (
      session_id,
      zone_name,
      encounter_title,
      primary_npc_name,
      primary_named_mob_id,
      started_at,
      ended_at,
      duration_ms,
      total_damage,
      dps,
      xp_percent,
      mob_kill_count,
      is_boss_encounter,
      source_key,
      end_reason,
      outcome,
      player_damage,
      pet_damage,
      best_hit,
      zone_detail,
      actions_json,
      mob_breakdown_json
    ) VALUES (
      @sessionId,
      @zoneName,
      @encounterTitle,
      @primaryNpcName,
      @namedMobId,
      @startedAt,
      @endedAt,
      @durationMs,
      @totalDamage,
      @dps,
      0,
      @mobKillCount,
      @isBossEncounter,
      @sourceKey,
      @endReason,
      @outcome,
      @playerDamage,
      @petDamage,
      @bestHit,
      @zoneDetail,
      @actionsJson,
      @mobBreakdownJson
    )
  `)

  const findEquivalentVictory = database.prepare(`
    SELECT
      id,
      source_key,
      duration_ms,
      total_damage,
      player_damage,
      pet_damage,
      actions_json
    FROM encounters
    WHERE session_id = ?
      AND outcome = 'victory'
      AND LOWER(COALESCE(primary_npc_name, '')) = LOWER(?)
      AND LOWER(COALESCE(zone_name, '')) = LOWER(COALESCE(?, ''))
      AND ended_at = ?
    ORDER BY total_damage DESC, duration_ms DESC, id ASC
  `)

  const updateEncounter = database.prepare(`
    UPDATE encounters SET
      zone_name = @zoneName,
      encounter_title = @encounterTitle,
      primary_npc_name = @primaryNpcName,
      primary_named_mob_id = @namedMobId,
      started_at = @startedAt,
      ended_at = @endedAt,
      duration_ms = @durationMs,
      total_damage = @totalDamage,
      dps = @dps,
      mob_kill_count = @mobKillCount,
      is_boss_encounter = @isBossEncounter,
      source_key = @sourceKey,
      end_reason = @endReason,
      outcome = @outcome,
      player_damage = @playerDamage,
      pet_damage = @petDamage,
      best_hit = @bestHit,
      zone_detail = @zoneDetail,
      actions_json = @actionsJson,
      mob_breakdown_json = @mobBreakdownJson
    WHERE id = @id
  `)

  const deleteEncounter = database.prepare(
    'DELETE FROM encounters WHERE id = ?'
  )

  const saveAll = database.transaction((records: EncounterInput[]) => {
    let changed = 0

    for (const encounter of records) {
      let primaryNpcName = encounter.primaryNpcName
      let namedMobId = findNamedMobId(
        primaryNpcName,
        encounter.zoneName
      )

      if (namedMobId === null && encounter.targetNames?.length) {
        for (const targetName of encounter.targetNames) {
          const candidateId = findNamedMobId(
            targetName,
            encounter.zoneName
          )
          if (candidateId !== null) {
            primaryNpcName = targetName
            namedMobId = candidateId
            break
          }
        }
      }

      const encounterTitle =
        namedMobId !== null &&
        encounter.targetNames &&
        encounter.targetNames.length > 1
          ? `${primaryNpcName} + ${encounter.targetNames.length - 1} add${
              encounter.targetNames.length === 2 ? '' : 's'
            }`
          : encounter.encounterTitle

      const payload = {
        sessionId,
        zoneName: encounter.zoneName ?? null,
        encounterTitle,
        primaryNpcName,
        namedMobId,
        startedAt: encounter.startedAt,
        endedAt: encounter.endedAt,
        durationMs: encounter.durationMs,
        totalDamage: encounter.totalDamage,
        dps: encounter.dps,
        mobKillCount: encounter.mobKillCount,
        isBossEncounter: namedMobId === null ? 0 : 1,
        sourceKey: encounter.sourceKey,
        endReason: encounter.endReason,
        outcome: encounter.outcome,
        playerDamage: encounter.playerDamage,
        petDamage: encounter.petDamage,
        bestHit: encounter.bestHit,
        zoneDetail: encounter.zoneDetail ?? null,
        actionsJson: JSON.stringify(encounter.actions),
        mobBreakdownJson: JSON.stringify(encounter.mobs)
      }

      // Hot reloads or reconnects can occasionally produce a short partial
      // record and a later full replay for the exact same kill. Reconcile
      // same-NPC/same-zone/same-ended-at victories and retain the richer row.
      if (encounter.outcome === 'victory') {
        const existing = findEquivalentVictory.all(
          sessionId,
          primaryNpcName,
          encounter.zoneName ?? null,
          encounter.endedAt
        ) as Array<{
          id: number
          source_key: string | null
          duration_ms: number
          total_damage: number
          player_damage: number
          pet_damage: number
          actions_json: string | null
        }>

        if (existing.length > 0) {
          const incomingScore =
            encounter.totalDamage * 1000 +
            encounter.durationMs +
            encounter.actions.length

          const bestExisting = existing
            .map((row) => {
              let actionCount = 0
              try {
                actionCount = JSON.parse(row.actions_json ?? '[]').length
              } catch {
                actionCount = 0
              }

              return {
                row,
                score:
                  Number(row.total_damage ?? 0) * 1000 +
                  Number(row.duration_ms ?? 0) +
                  actionCount
              }
            })
            .sort((a, b) => b.score - a.score)[0]

          const keepIncoming =
            mode === 'replay' || incomingScore > bestExisting.score
          const keeperId = bestExisting.row.id

          if (keepIncoming) {
            updateEncounter.run({
              ...payload,
              id: keeperId
            })
            changed += 1
          }

          for (const duplicate of existing) {
            if (duplicate.id !== keeperId) {
              changed += deleteEncounter.run(duplicate.id).changes
            }
          }

          continue
        }
      }

      changed += insert.run(payload).changes
    }

    return changed
  })

  return saveAll(encounters)
}

export function listEncounters(limit = 500): EncounterRecord[] {
  if (!database) throw new Error('PEQL database is not initialized.')

  const safeLimit = Math.max(1, Math.min(5000, Math.trunc(limit)))

  const rows = database
    .prepare(`
      SELECT
        e.*,
        nm.title AS named_title,
        nm.wiki_url AS wiki_url,
        CASE
          WHEN e.primary_named_mob_id IS NULL THEN 1
          ELSE (
            SELECT COUNT(*)
            FROM encounters prior
            WHERE prior.primary_named_mob_id = e.primary_named_mob_id
              AND LOWER(COALESCE(prior.zone_name, '')) =
                  LOWER(COALESCE(e.zone_name, ''))
              AND (
                prior.started_at < e.started_at
                OR (prior.started_at = e.started_at AND prior.id <= e.id)
              )
              AND prior.started_at > COALESCE((
                SELECT MAX(victory.started_at)
                FROM encounters victory
                WHERE victory.primary_named_mob_id = e.primary_named_mob_id
                  AND LOWER(COALESCE(victory.zone_name, '')) =
                      LOWER(COALESCE(e.zone_name, ''))
                  AND victory.outcome = 'victory'
                  AND (
                    victory.started_at < e.started_at
                    OR (victory.started_at = e.started_at AND victory.id < e.id)
                  )
              ), '')
          )
        END AS attempt_number
      FROM encounters e
      LEFT JOIN named_mobs nm ON nm.id = e.primary_named_mob_id
      ORDER BY e.started_at DESC, e.id DESC
      LIMIT ?
    `)
    .all(safeLimit)

  return rows.map((row: unknown) => {
    const value = row as Record<string, unknown>

    let actions = []
    let mobs = []
    try {
      actions = JSON.parse(String(value.actions_json ?? '[]'))
    } catch {
      actions = []
    }
    try {
      mobs = JSON.parse(String(value.mob_breakdown_json ?? '[]'))
    } catch {
      mobs = []
    }

    return {
      id: Number(value.id),
      sessionId: Number(value.session_id),
      sourceKey: String(value.source_key ?? ''),
      encounterTitle: String(value.encounter_title),
      primaryNpcName: String(value.primary_npc_name ?? value.encounter_title),
      zoneName: value.zone_name ? String(value.zone_name) : undefined,
      zoneDetail: value.zone_detail ? String(value.zone_detail) : undefined,
      startedAt: String(value.started_at),
      endedAt: String(value.ended_at),
      durationMs: Number(value.duration_ms ?? 0),
      totalDamage: Number(value.total_damage ?? 0),
      playerDamage: Number(value.player_damage ?? 0),
      petDamage: Number(value.pet_damage ?? 0),
      dps: Number(value.dps ?? 0),
      bestHit: Number(value.best_hit ?? 0),
      mobKillCount: Number(value.mob_kill_count ?? 0),
      endReason: String(value.end_reason ?? 'timeout'),
      outcome: value.outcome === 'victory' ? 'victory' : 'failed',
      actions,
      mobs,
      attemptNumber: Number(value.attempt_number ?? 1),
      namedMobId: value.primary_named_mob_id
        ? Number(value.primary_named_mob_id)
        : null,
      namedTitle: value.named_title ? String(value.named_title) : null,
      wikiUrl: value.wiki_url ? String(value.wiki_url) : null
    } as EncounterRecord
  })
}

export function closeDatabase() {
  database?.close()
  database = null
}


export function savePlayerNote(input: PlayerNoteInput): PlayerNoteRecord {
  if (!database) throw new Error('PEQL database is not initialized.')

  const noteText = input.noteText.trim()
  if (!noteText) throw new Error('Player note cannot be empty.')

  const sessionId = ensureJournalSession(input.logFilePath, input.createdAt)

  const result = database
    .prepare(
      `INSERT INTO player_notes (
         session_id,
         encounter_source_key,
         created_at,
         zone_name,
         note_text
       ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      input.encounterSourceKey ?? null,
      input.createdAt,
      input.zoneName ?? null,
      noteText
    )

  const saved = database
    .prepare(
      `SELECT
         pn.id,
         pn.session_id AS sessionId,
         pn.encounter_source_key AS encounterSourceKey,
         pn.created_at AS createdAt,
         pn.zone_name AS zoneName,
         pn.note_text AS noteText,
         e.encounter_title AS encounterTitle,
         e.primary_npc_name AS primaryNpcName
       FROM player_notes pn
       LEFT JOIN encounters e
         ON e.session_id = pn.session_id
        AND e.source_key = pn.encounter_source_key
       WHERE pn.id = ?`
    )
    .get(Number(result.lastInsertRowid)) as PlayerNoteRecord | undefined

  if (!saved) throw new Error('Saved player note could not be reloaded.')
  return saved
}

export function listPlayerNotes(
  limit = 100
): PlayerNoteRecord[] {
  if (!database) throw new Error('PEQL database is not initialized.')

  return database
    .prepare(
      `SELECT
         pn.id,
         pn.session_id AS sessionId,
         pn.encounter_source_key AS encounterSourceKey,
         pn.created_at AS createdAt,
         pn.zone_name AS zoneName,
         pn.note_text AS noteText,
         e.encounter_title AS encounterTitle,
         e.primary_npc_name AS primaryNpcName
       FROM player_notes pn
       LEFT JOIN encounters e
         ON e.session_id = pn.session_id
        AND e.source_key = pn.encounter_source_key
       ORDER BY pn.created_at DESC, pn.id DESC
       LIMIT ?`
    )
    .all(Math.max(1, Math.min(limit, 1000))) as PlayerNoteRecord[]
}
