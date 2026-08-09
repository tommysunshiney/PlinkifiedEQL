import type { FightSnapshot } from '../fight-engine'
import type {
  EncounterAction,
  EncounterInput
} from '../types/database'

type ZoneContext = {
  zoneName?: string
  zoneDetail?: string
}

function lineTimestamp(line: string): number | null {
  const text = line.match(/^\[([^\]]+)\]/)?.[1]
  if (!text) return null

  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? null : timestamp
}

function normalizeCombatName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^an?\s+|^the\s+/i, '')
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
}

function cleanZone(value: string): string {
  return value.trim().replace(/\.$/, '').trim()
}

function zoneContextAt(lines: string[], timestamp: number): ZoneContext {
  let zoneName: string | undefined
  let zoneDetail: string | undefined
  let recentInstance:
    | { zoneName: string; instanceId: string; timestamp: number }
    | undefined

  for (const line of lines) {
    const lineTime = lineTimestamp(line)
    if (lineTime === null || lineTime > timestamp) continue

    let match = line.match(
      /Player .+? creating instance (.+?) (\d+)\.?$/i
    )
    if (match) {
      recentInstance = {
        zoneName: cleanZone(match[1]),
        instanceId: match[2],
        timestamp: lineTime
      }
      continue
    }

    match = line.match(/You have entered (.+?) (\d+) \((.+?)\)\.?$/i)
    if (match) {
      zoneName = cleanZone(match[1])
      zoneDetail = `${match[3].trim()} tier (+${match[2]})`
      continue
    }

    match = line.match(/You have entered (.+?) - Solo\.?$/i)
    if (match) {
      zoneName = cleanZone(match[1])
      zoneDetail = 'Solo'
      continue
    }

    match = line.match(/You have entered (.+?)\.?$/i)
    if (match) {
      zoneName = cleanZone(match[1])
      zoneDetail = undefined
    }
  }

  if (
    zoneName &&
    recentInstance &&
    recentInstance.zoneName.toLocaleLowerCase() === zoneName.toLocaleLowerCase() &&
    timestamp - recentInstance.timestamp <= 10 * 60 * 1000
  ) {
    zoneDetail = zoneDetail
      ? `${zoneDetail} · Instance #${recentInstance.instanceId}`
      : `Instance #${recentInstance.instanceId}`
  }

  return { zoneName, zoneDetail }
}

function encounterActions(
  lines: string[],
  startedAt: number,
  endedAt: number,
  fightTargets: string[]
): EncounterAction[] {
  const actions: EncounterAction[] = []
  const targets = new Set(fightTargets.map(normalizeCombatName))

  function isFightTarget(value: string): boolean {
    return targets.has(normalizeCombatName(value))
  }

  for (const line of lines) {
    const timestamp = lineTimestamp(line)
    if (timestamp === null || timestamp < startedAt || timestamp > endedAt) {
      continue
    }

    let match = line.match(/\]\s+You begin casting (.+?)\.\s*$/i)
    if (match) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'spell',
        name: match[1].trim()
      })
      continue
    }

    match = line.match(/\]\s+You activate (.+?)\.\s*$/i)
    if (match) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'ability',
        name: match[1].trim()
      })
      continue
    }

    match = line.match(/\]\s+Auto attack is (on|off)\.\s*$/i)
    if (match) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'auto-attack',
        name: match[1].toLowerCase()
      })
      continue
    }

    match = line.match(
      /\]\s+You (backstab|reave|bash|kick|strike|maul|bite|claw) .+?(?: for \d+ points? of damage| for \d+ points? damage|, but)/i
    )
    if (match) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'special-attack',
        name: match[1].toLowerCase()
      })
      continue
    }

    match = line.match(/\]\s+Your (.+?) spell is interrupted\.\s*$/i)
    if (match) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'player-interrupt',
        name: `Your ${match[1].trim()} interrupted`
      })
      continue
    }

    match = line.match(/\]\s+(.+?) begins casting (.+?)\.\s*$/i)
    if (match && isFightTarget(match[1])) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'enemy-cast',
        name: `${match[1].trim()} → ${match[2].trim()}`
      })
      continue
    }

    match = line.match(/\]\s+(.+?)'s (.+?) spell is interrupted\.\s*$/i)
    if (match && isFightTarget(match[1])) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'enemy-interrupt',
        name: `${match[1].trim()} → ${match[2].trim()} interrupted`
      })
      continue
    }

    match = line.match(
      /\]\s+(.+?) healed (?:itself|himself|herself|.+?) for (?:\d+ \()?(\d+)\)? hit points by (.+?)\.\s*$/i
    )
    if (match && isFightTarget(match[1])) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'enemy-heal',
        name: `${match[1].trim()} → ${match[3].trim()} +${match[2]}`
      })
      continue
    }

    match = line.match(
      /\]\s+(.+?) has been (mesmerized|entranced|enthralled)\.\s*$/i
    )
    if (match && isFightTarget(match[1])) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'crowd-control',
        name: `${match[1].trim()} → ${match[2].toLowerCase()}`
      })
      continue
    }

    match = line.match(
      /\]\s+(.+?) (is stunned by scintillating colors|begins to sway!)\s*$/i
    )
    if (match && isFightTarget(match[1])) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'crowd-control',
        name: `${match[1].trim()} → stunned`
      })
      continue
    }

    match = line.match(
      /\]\s+Your (?:Mesmerization|Entrance|Enthrall) spell has worn off of (.+?)\.\s*$/i
    )
    if (!match) {
      match = line.match(/\]\s+(.+?) has been awakened by Whittler\.\s*$/i)
    }
    if (match && isFightTarget(match[1])) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'crowd-control-end',
        name: `${match[1].trim()} → CC ended`
      })
      continue
    }

    if (/\]\s+(?:You have been slain|You have died|You died)/i.test(line)) {
      actions.push({
        offsetMs: timestamp - startedAt,
        kind: 'death',
        name: 'death'
      })
    }
  }

  return actions.slice(0, 300)
}

export function encountersFromFights(
  lines: string[],
  fights: FightSnapshot[]
): EncounterInput[] {
  return fights
    .filter(
      (fight) =>
        !fight.active &&
        fight.endedAt !== null &&
        fight.endReason !== null
    )
    .map((fight) => {
      const endedAt = fight.endedAt ?? fight.lastActivityAt
      const context = zoneContextAt(lines, fight.startedAt)

      const primaryNpcName =
        fight.targets.find((target) => !/\spet$/i.test(target)) ??
        fight.targets[0] ??
        fight.target
      const encounterTitle =
        fight.targets.length <= 1
          ? primaryNpcName
          : `${primaryNpcName} + ${fight.targets.length - 1} add${
              fight.targets.length === 2 ? '' : 's'
            }`

      return {
        sourceKey: fight.id,
        encounterTitle,
        primaryNpcName,
        targetNames: fight.targets,
        mobs: fight.mobs.map((mob) => ({
          name: mob.name,
          joinedOffsetMs: mob.joinedOffsetMs,
          burnStartedOffsetMs:
            mob.burnStartedAt === null
              ? null
              : Math.max(0, mob.burnStartedAt - fight.startedAt),
          burnDurationMs: Math.round(mob.burnDurationSeconds * 1000),
          burnSegments: mob.burnSegments.map((segment) => ({
            startedOffsetMs: Math.max(
              0,
              segment.startedAt - fight.startedAt
            ),
            endedOffsetMs: Math.max(
              0,
              segment.endedAt - fight.startedAt
            ),
            durationMs: Math.round(segment.durationSeconds * 1000),
            damage: Math.round(segment.damage)
          })),
          activeDamage: Math.round(mob.activeDamage),
          elapsedTtkMs: Math.round(mob.elapsedTtkSeconds * 1000),
          killedOffsetMs:
            mob.killedAt === null
              ? null
              : Math.max(0, mob.killedAt - fight.startedAt),
          totalDamage: Math.round(mob.totalDamage),
          playerDamage: Math.round(mob.playerDamage),
          petDamage: Math.round(mob.petDamage),
          dps: mob.dps,
          bestHit: Math.round(mob.bestHit),
          defeated: mob.defeated,
          joinedLater: mob.joinedLater
        })),
        zoneName: context.zoneName,
        zoneDetail: context.zoneDetail,
        startedAt: new Date(fight.startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationMs: Math.max(0, endedAt - fight.startedAt),
        totalDamage: Math.round(fight.totalDamage),
        playerDamage: Math.round(fight.playerDamage),
        petDamage: Math.round(fight.petDamage),
        dps: fight.fightDps,
        bestHit: Math.round(fight.bestHit),
        mobKillCount: fight.defeatedTargets.length,
        endReason: fight.endReason,
        outcome: fight.endReason === 'victory' ? 'victory' : 'failed',
        actions: encounterActions(
          lines,
          fight.startedAt,
          endedAt,
          fight.targets
        )
      }
    })
    .sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)
    )
}
