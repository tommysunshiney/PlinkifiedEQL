export type DatabaseStatus = {
  ready: boolean
  path: string
  schemaVersion: number
  bossCount: number
  journalCount: number
  encounterCount: number
}

export type BossRecord = {
  id: number
  npcName: string
  title: string | null
  zone: string | null
  aliases: string[]
  knownDrops: string[]
  wikiPageTitle: string
  wikiUrl: string
  sourceRevision: number | null
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

export type EncounterAction = {
  offsetMs: number
  kind:
    | 'spell'
    | 'ability'
    | 'auto-attack'
    | 'special-attack'
    | 'death'
    | 'enemy-cast'
    | 'enemy-interrupt'
    | 'enemy-heal'
    | 'crowd-control'
    | 'crowd-control-end'
    | 'player-interrupt'
  name: string
}


export type EncounterAbilityBreakdown = {
  ability: string
  source: 'melee' | 'spell' | 'dot' | 'damage-shield'
  actor: string
  actorType: 'player' | 'pet'
  damage: number
  hits: number
  criticalHits: number
  bestHit: number
}

export type EncounterBurnSegment = {
  startedOffsetMs: number
  endedOffsetMs: number
  durationMs: number
  damage: number
}

export type EncounterMobBreakdown = {
  name: string
  joinedOffsetMs: number
  burnStartedOffsetMs: number | null
  burnDurationMs: number
  burnSegments: EncounterBurnSegment[]
  activeDamage: number
  elapsedTtkMs: number
  killedOffsetMs: number | null
  totalDamage: number
  playerDamage: number
  petDamage: number
  dps: number
  bestHit: number
  defeated: boolean
  joinedLater: boolean
}

export type EncounterInput = {
  sourceKey: string
  encounterTitle: string
  primaryNpcName: string
  targetNames?: string[]
  mobs: EncounterMobBreakdown[]
  abilities: EncounterAbilityBreakdown[]
  zoneName?: string
  zoneDetail?: string
  startedAt: string
  endedAt: string
  durationMs: number
  totalDamage: number
  playerDamage: number
  petDamage: number
  dps: number
  bestHit: number
  mobKillCount: number
  endReason: string
  outcome: 'victory' | 'failed'
  actions: EncounterAction[]
}

export type EncounterRecord = EncounterInput & {
  id: number
  sessionId: number
  attemptNumber: number
  namedMobId: number | null
  namedTitle: string | null
  wikiUrl: string | null
}


export type PlayerNoteInput = {
  logFilePath: string
  createdAt: string
  zoneName?: string
  noteText: string
  encounterSourceKey?: string
}

export type PlayerNoteRecord = {
  id: number
  sessionId: number
  encounterSourceKey: string | null
  createdAt: string
  zoneName: string | null
  noteText: string
  encounterTitle: string | null
  primaryNpcName: string | null
}
