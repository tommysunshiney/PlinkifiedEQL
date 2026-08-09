import type { JournalEntryInput } from '../types/database'

function getTimestamp(line: string): number {
  const logTimestamp = line.match(/^\[([^\]]+)\]/)?.[1]
  const markerTimestamp = line.match(
    /PEQL (?:OH SHIT!|SESSION START) :: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
  )?.[1]
  const value = Date.parse(logTimestamp ?? markerTimestamp ?? '')

  return Number.isNaN(value) ? 0 : value
}

function cleanZoneName(value: string): string {
  return value.trim().replace(/\.$/, '').trim()
}

function makeEntry(
  line: string,
  entry: Omit<JournalEntryInput, 'occurredAt' | 'sourceKey'>
): JournalEntryInput | null {
  const timestamp = getTimestamp(line)
  if (!timestamp) return null

  return {
    ...entry,
    occurredAt: new Date(timestamp).toISOString(),
    sourceKey: line
  }
}

export function lineToJournalEntry(
  line: string
): JournalEntryInput | null {
  let match: RegExpMatchArray | null

  if (line.includes('===== PEQL OH SHIT!')) {
    return makeEntry(line, {
      entryType: 'incident',
      title: 'OH SHIT combat bookmark',
      narrative: 'Marked for later review.'
    })
  }

  match = line.match(/Player (.+?) creating instance (.+?) (\d+)\.?$/i)
  if (match) {
    const character = match[1].trim()
    const zoneName = cleanZoneName(match[2])
    const instanceId = match[3]

    return makeEntry(line, {
      entryType: 'instance',
      title: `${character} created an instance of ${zoneName}`,
      narrative: `Instance #${instanceId} requested.`,
      zoneName,
      metadata: {
        instanceId: Number(instanceId),
        character
      }
    })
  }

  match = line.match(/You have entered (.+?) (\d+) \((.+?)\)\.?$/i)
  if (match) {
    const zoneName = cleanZoneName(match[1])
    const tier = match[2]
    const difficulty = match[3].trim()

    return makeEntry(line, {
      entryType: 'zone',
      title: `Ventured into ${zoneName}`,
      narrative: `${difficulty} tier (+${tier}).`,
      zoneName,
      metadata: {
        tier: Number(tier),
        difficulty
      }
    })
  }

  match = line.match(/You have entered (.+?) - Solo\.?$/i)
  if (match) {
    const zoneName = cleanZoneName(match[1])

    return makeEntry(line, {
      entryType: 'zone',
      title: `Ventured into ${zoneName}`,
      narrative: 'Solo instance.',
      zoneName,
      metadata: {
        difficulty: 'Solo'
      }
    })
  }

  match = line.match(/You have entered (.+?)\.?$/i)
  if (match) {
    const zoneName = cleanZoneName(match[1])

    return makeEntry(line, {
      entryType: 'zone',
      title: `Ventured into ${zoneName}`,
      narrative: 'Zone transition recorded.',
      zoneName
    })
  }

  match = line.match(/You have gained a level! Welcome to level (\d+)!/i)
  if (match) {
    return makeEntry(line, {
      entryType: 'level',
      title: `Reached level ${match[1]}`,
      narrative: 'Level gain recorded.',
      metadata: {
        level: Number(match[1])
      }
    })
  }

  match = line.match(/(.+?) has been slain by YOU!/i)
  if (match) {
    return makeEntry(line, {
      entryType: 'fight',
      title: `Defeated ${match[1]}`,
      narrative: 'Confirmed personal kill.'
    })
  }

  match = line.match(/You have slain (.+?)[!.]?$/i)
  if (match) {
    return makeEntry(line, {
      entryType: 'fight',
      title: `Defeated ${match[1]}`,
      narrative: 'Confirmed personal kill.'
    })
  }

  if (/You have been slain|You have died|You died/i.test(line)) {
    return makeEntry(line, {
      entryType: 'death',
      title: 'Character death',
      narrative: 'Death recorded.'
    })
  }

  match = line.match(/You have looted (.+?) from .+?['’]s corpse/i)
  if (!match) match = line.match(/You have looted (.+?)(?:[.!]|--)?$/i)
  if (!match) match = line.match(/You loot (.+?)[.!]?$/i)
  if (!match) match = line.match(/(.+?) has been added to your inventory/i)
  if (match) {
    return makeEntry(line, {
      entryType: 'loot',
      title: match[1].replace(/^--/, '').trim(),
      narrative: 'Loot recorded.'
    })
  }

  return null
}

export function journalEntriesFromLines(
  lines: string[]
): JournalEntryInput[] {
  return lines
    .map(lineToJournalEntry)
    .filter((entry): entry is JournalEntryInput => entry !== null)
}
