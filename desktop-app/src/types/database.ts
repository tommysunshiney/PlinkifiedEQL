export type DatabaseStatus = {
  ready: boolean
  path: string
  schemaVersion: number
  bossCount: number
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
