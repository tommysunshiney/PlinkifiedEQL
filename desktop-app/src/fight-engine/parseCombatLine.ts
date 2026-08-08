import type {
  CombatantType,
  DamageSource,
  FightDamageEvent
} from './types.ts'

export type CombatLogEvent =
  | ({ kind: 'player-damage' } & FightDamageEvent)
  | ({ kind: 'actor-damage' } & FightDamageEvent)
  | { kind: 'player-miss'; timestamp: number; target: string }
  | { kind: 'actor-miss'; timestamp: number; actor: string; target: string }
  | { kind: 'incoming-damage'; timestamp: number; attacker: string }
  | { kind: 'incoming-miss'; timestamp: number; attacker: string }
  | { kind: 'kill'; timestamp: number; target: string; killer: string | null }
  | { kind: 'death'; timestamp: number }
  | { kind: 'zone'; timestamp: number }
  | { kind: 'auto-attack'; timestamp: number; enabled: boolean }
  | { kind: 'feign'; timestamp: number; successful: boolean }
  | { kind: 'player-spell-cast'; timestamp: number }
  | { kind: 'crowd-control'; timestamp: number; target: string }
  | { kind: 'pet-identity'; timestamp: number; pet: string }

function cleanName(value: string): string {
  return value.trim().replace(/[.!]+$/, '').trim()
}

export function getLogTimestamp(line: string): number | null {
  const timestampText = line.match(/^\[([^\]]+)\]/)?.[1]

  if (!timestampText) return null

  const timestamp = Date.parse(timestampText)
  return Number.isNaN(timestamp) ? null : timestamp
}

function damageEvent(
  match: RegExpMatchArray,
  timestamp: number,
  source: DamageSource,
  actor: string,
  actorType: CombatantType
): FightDamageEvent {
  return {
    timestamp,
    target: cleanName(match[1]),
    damage: Number(match[2]),
    source,
    actor,
    actorType
  }
}

export function parseCombatLine(line: string): CombatLogEvent | null {
  const timestamp = getLogTimestamp(line)

  if (timestamp === null) return null

  let match = line.match(/\]\s+(.+?) told you, '.*\bMaster\.'\s*$/i)
  if (match) {
    return {
      kind: 'pet-identity',
      timestamp,
      pet: cleanName(match[1])
    }
  }

  if (/\]\s+You begin casting .+\.\s*$/i.test(line)) {
    return { kind: 'player-spell-cast', timestamp }
  }

  match = line.match(/\]\s+(.+?) has been (?:mesmerized|enthralled)\.\s*$/i)
  if (match) {
    return {
      kind: 'crowd-control',
      timestamp,
      target: cleanName(match[1])
    }
  }

  match = line.match(
    /\]\s+You\s+(?:hit|slash|pierce|crush|punch|kick|bash|cleave|backstab|reave|maul|bite|claw|strike)\s+(.+?)\s+for\s+(\d+)\s+points?(?:\s+of\s+(?:[\w-]+\s+)?)?damage/i
  )
  if (match) {
    return {
      kind: 'player-damage',
      ...damageEvent(match, timestamp, 'melee', 'You', 'player')
    }
  }

  match = line.match(
    /\]\s+You hit\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+[\w-]+\s+damage\s+by\s+/i
  )
  if (match) {
    return {
      kind: 'player-damage',
      ...damageEvent(match, timestamp, 'spell', 'You', 'player')
    }
  }

  match = line.match(
    /\]\s+(.+?)\s+has taken\s+(\d+)\s+damage from your\s+/i
  )
  if (match) {
    return {
      kind: 'player-damage',
      ...damageEvent(match, timestamp, 'dot', 'You', 'player')
    }
  }

  match = line.match(
    /\]\s+(.+?)\s+is pierced by YOUR thorns for\s+(\d+)\s+points?\s+of non-melee damage/i
  )
  if (match) {
    return {
      kind: 'player-damage',
      ...damageEvent(match, timestamp, 'damage-shield', 'You', 'player')
    }
  }

  match = line.match(
    /\]\s+You try to (?:hit|slash|pierce|crush|punch|kick|bash|cleave|backstab|reave|maul|bite|claw|strike)\s+(.+?),?\s+but (?:miss|.+?\s+(?:dodges|parries|blocks))/i
  )
  if (!match) match = line.match(/\]\s+You miss\s+(.+?)[.!]?$/i)
  if (match) {
    return { kind: 'player-miss', timestamp, target: cleanName(match[1]) }
  }

  // Generic actor spell damage. The FightEngine only accepts it if the actor
  // has been positively identified as the player's pet.
  match = line.match(
    /\]\s+(.+?) hit\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+[\w-]+\s+damage\s+by\s+/i
  )
  if (match && !/^you$/i.test(match[1])) {
    return {
      kind: 'actor-damage',
      timestamp,
      actor: cleanName(match[1]),
      actorType: 'pet',
      target: cleanName(match[2]),
      damage: Number(match[3]),
      source: 'spell'
    }
  }

  match = line.match(
    /\]\s+(.+?)\s+(?:hits|slashes|pierces|crushes|punches|kicks|bashes|cleaves|backstabs|reaves|mauls|bites|claws|strikes)\s+(.+?)\s+for\s+(\d+)\s+points?(?:\s+of\s+(?:[\w-]+\s+)?)?damage/i
  )
  if (match && !/^you$/i.test(match[1]) && !/^YOU$/i.test(match[2])) {
    return {
      kind: 'actor-damage',
      timestamp,
      actor: cleanName(match[1]),
      actorType: 'pet',
      target: cleanName(match[2]),
      damage: Number(match[3]),
      source: 'melee'
    }
  }

  match = line.match(
    /\]\s+(.+?)\s+is pierced by\s+(.+?)'s thorns for\s+(\d+)\s+points?\s+of non-melee damage/i
  )
  if (match && !/^YOUR$/i.test(match[2])) {
    return {
      kind: 'actor-damage',
      timestamp,
      actor: cleanName(match[2]),
      actorType: 'pet',
      target: cleanName(match[1]),
      damage: Number(match[3]),
      source: 'damage-shield'
    }
  }

  match = line.match(
    /\]\s+(.+?) tries to (?:hit|slash|pierce|crush|punch|kick|bash|cleave|backstab|reave|maul|bite|claw|strike)\s+(.+?),?\s+but (?:misses|.+?\s+(?:dodges|parries|blocks))/i
  )
  if (match && !/^you$/i.test(match[1]) && !/^YOU$/i.test(match[2])) {
    return {
      kind: 'actor-miss',
      timestamp,
      actor: cleanName(match[1]),
      target: cleanName(match[2])
    }
  }

  match = line.match(
    /\]\s+(.+?)\s+(?:hits|slashes|pierces|crushes|punches|cleaves|kicks|bashes|bites|claws|backstabs|reaves|strikes)\s+YOU\s+for\s+\d+\s+points?/i
  )
  if (!match) {
    match = line.match(
      /\]\s+(.+?)\s+hit you for\s+\d+\s+points?\s+of\s+[\w-]+\s+damage\s+by\s+/i
    )
  }
  if (!match) {
    match = line.match(
      /\]\s+You have taken\s+\d+\s+damage from\s+.+?\s+by\s+(.+?)[.!]?$/i
    )
  }
  if (!match) {
    match = line.match(
      /\]\s+YOU are (?:pierced by|burned by)\s+(.+?)'s\s+(?:thorns|flames)\s+for\s+\d+\s+points?/i
    )
  }
  if (match) {
    return {
      kind: 'incoming-damage',
      timestamp,
      attacker: cleanName(match[1])
    }
  }

  match = line.match(
    /\]\s+(.+?)\s+tries to .+? YOU,?\s+but (?:misses|YOU (?:dodge|parry|riposte|block))/i
  )
  if (!match) match = line.match(/\]\s+(.+?)\s+misses YOU[.!]?$/i)
  if (match) {
    return {
      kind: 'incoming-miss',
      timestamp,
      attacker: cleanName(match[1])
    }
  }

  match = line.match(/\]\s+(.+?) has been slain by (.+?)!/i)
  if (match) {
    return {
      kind: 'kill',
      timestamp,
      target: cleanName(match[1]),
      killer: cleanName(match[2])
    }
  }

  match = line.match(/\]\s+You have slain (.+?)[!.]?$/i)
  if (!match) match = line.match(/\]\s+You have killed (.+?)[!.]?$/i)
  if (match) {
    return {
      kind: 'kill',
      timestamp,
      target: cleanName(match[1]),
      killer: 'You'
    }
  }

  if (/\]\s+(?:You have been slain|You have died|You died)/i.test(line)) {
    return { kind: 'death', timestamp }
  }

  if (/\]\s+You have entered\s+/i.test(line)) {
    return { kind: 'zone', timestamp }
  }

  match = line.match(/\]\s+Auto attack is (on|off)\./i)
  if (match) {
    return {
      kind: 'auto-attack',
      timestamp,
      enabled: match[1].toLowerCase() === 'on'
    }
  }

  if (
    /\]\s+.+? has fallen to the ground\./i.test(line) ||
    /\]\s+Your enemies have forgotten you!/i.test(line)
  ) {
    return { kind: 'feign', timestamp, successful: true }
  }

  if (
    /\]\s+Your Feign Death spell is interrupted\./i.test(line) ||
    /\]\s+You are no longer feigning death/i.test(line)
  ) {
    return { kind: 'feign', timestamp, successful: false }
  }

  return null
}
