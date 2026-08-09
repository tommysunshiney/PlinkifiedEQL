export type BossSeedRecord = {
  npcName: string
  title: string | null
  zone: string | null
  aliases: string[]
  knownDrops: string[]
  wikiPageTitle: string
  wikiUrl: string
  sourceRevision: number | null
}

export type DatabaseStatus = {
  ready: boolean
  path: string
  schemaVersion: number
  bossCount: number
  journalCount: number
}

export type BossRecord = BossSeedRecord & {
  id: number
}

export type JournalEntryInput = {
  entryType: string
  occurredAt: string
  title: string
  narrative: string
  sourceKey: string
  zoneName?: string
  metadata?: Record<string, unknown>
}

export type JournalRecord = {
  id: number
  sessionId: number
  entryType: string
  occurredAt: string
  title: string
  narrative: string
  zoneName: string | null
  metadata: Record<string, unknown>
}
