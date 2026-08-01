import { useMemo, useState } from 'react'
import { useSession } from '../session/SessionContext'

type JournalFilter =
  | 'all'
  | 'fights'
  | 'named'
  | 'loot'
  | 'incidents'

type JournalEntryType =
  | 'fight'
  | 'named'
  | 'loot'
  | 'incident'
  | 'level'
  | 'zone'
  | 'death'

type JournalEntry = {
  id: string
  timestamp: number
  timeLabel: string
  type: JournalEntryType
  icon: string
  title: string
  detail: string
}

const filters: Array<{ id: JournalFilter; label: string }> = [
  { id: 'all', label: 'All Activity' },
  { id: 'fights', label: 'Fights' },
  { id: 'named', label: 'Named Mobs' },
  { id: 'loot', label: 'Loot' },
  { id: 'incidents', label: 'OH SHIT!' }
]

function getTimestamp(line: string): number {
  const logTimestamp = line.match(/^\[([^\]]+)\]/)?.[1]
  const markerTimestamp = line.match(
    /PEQL (?:OH SHIT!|SESSION START) :: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
  )?.[1]
  const value = Date.parse(logTimestamp ?? markerTimestamp ?? '')

  return Number.isNaN(value) ? 0 : value
}

function getTimeLabel(timestamp: number): string {
  if (!timestamp) return '--:--:--'

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function lineToEntry(line: string, index: number): JournalEntry | null {
  const timestamp = getTimestamp(line)
  const id = `${timestamp}-${index}`
  const timeLabel = getTimeLabel(timestamp)
  let match: RegExpMatchArray | null

  if (line.includes('===== PEQL OH SHIT!')) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'incident',
      icon: '🚨',
      title: 'OH SHIT combat bookmark',
      detail: 'Marked for later review.'
    }
  }

  match = line.match(/You have entered (.+?)\.?$/i)
  if (match) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'zone',
      icon: '🗺️',
      title: `Entered ${match[1]}`,
      detail: 'Zone transition recorded.'
    }
  }

  match = line.match(/You have gained a level! Welcome to level (\d+)!/i)
  if (match) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'level',
      icon: '⬆️',
      title: `Reached level ${match[1]}`,
      detail: 'Level gain recorded.'
    }
  }

  match = line.match(/(.+?) has been slain by YOU!/i)
  if (match) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'fight',
      icon: '⚔️',
      title: `Defeated ${match[1]}`,
      detail: 'Confirmed personal kill.'
    }
  }

  match = line.match(/You have slain (.+?)[!.]?$/i)
  if (match) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'fight',
      icon: '⚔️',
      title: `Defeated ${match[1]}`,
      detail: 'Confirmed personal kill.'
    }
  }

  if (/You have been slain|You have died|You died/i.test(line)) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'death',
      icon: '☠️',
      title: 'Character death',
      detail: 'Death recorded in the session.'
    }
  }

  match = line.match(/You have looted (.+?) from .+?['’]s corpse/i)
  if (!match) match = line.match(/You have looted (.+?)(?:[.!]|--)?$/i)
  if (!match) match = line.match(/You loot (.+?)[.!]?$/i)
  if (!match) match = line.match(/(.+?) has been added to your inventory/i)
  if (match) {
    return {
      id,
      timestamp,
      timeLabel,
      type: 'loot',
      icon: '🎒',
      title: match[1].replace(/^--/, '').trim(),
      detail: 'Loot recorded.'
    }
  }

  return null
}

export default function AdventureJournalPage() {
  const [activeFilter, setActiveFilter] =
    useState<JournalFilter>('all')
  const { selectedLog, sessionLines, isConnected } = useSession()

  const entries = useMemo(() => {
    return sessionLines
      .map(lineToEntry)
      .filter((entry): entry is JournalEntry => entry !== null)
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [sessionLines])

  const visibleEntries = useMemo(() => {
    if (activeFilter === 'all') return entries
    if (activeFilter === 'fights') {
      return entries.filter((entry) => entry.type === 'fight')
    }
    if (activeFilter === 'named') {
      return entries.filter((entry) => entry.type === 'named')
    }
    if (activeFilter === 'loot') {
      return entries.filter((entry) => entry.type === 'loot')
    }

    return entries.filter((entry) => entry.type === 'incident')
  }, [activeFilter, entries])

  const lootCount = entries.filter((entry) => entry.type === 'loot').length
  const incidentCount = entries.filter(
    (entry) => entry.type === 'incident'
  ).length
  const namedCount = entries.filter((entry) => entry.type === 'named').length

  return (
    <main className="journal-page">
      <header className="journal-hero">
        <div>
          <h2>Adventure Journal</h2>
          <p>
            Live session history from the same connected log used by
            the Dashboard.
          </p>
          <small className="journal-source">
            {selectedLog || 'Select an EverQuest Legends log on Dashboard.'}
          </small>
        </div>

        <span className={`journal-badge ${isConnected ? 'connected' : ''}`}>
          {isConnected ? 'Live Session' : 'Not Connected'}
        </span>
      </header>

      <section className="journal-summary">
        <article className="journal-stat">
          <span>Journal Entries</span>
          <strong>{entries.length.toLocaleString()}</strong>
        </article>
        <article className="journal-stat">
          <span>Named Encounters</span>
          <strong>{namedCount}</strong>
        </article>
        <article className="journal-stat">
          <span>Loot Recorded</span>
          <strong>{lootCount.toLocaleString()}</strong>
        </article>
        <article className="journal-stat">
          <span>OH SHIT Moments</span>
          <strong>{incidentCount}</strong>
        </article>
      </section>

      <nav className="journal-toolbar" aria-label="Journal filters">
        {filters.map((filter) => (
          <button
            className={`journal-filter ${
              activeFilter === filter.id ? 'active' : ''
            }`}
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </nav>

      <section className="journal-grid">
        <article className="journal-card">
          <h3>Session Timeline</h3>

          {visibleEntries.length === 0 ? (
            <div className="journal-empty">
              <div>
                <strong>No matching entries yet</strong>
                <p>
                  Keep PEQL connected while you play. Zones, personal
                  kills, loot, level gains, deaths, and OH SHIT markers
                  will appear here automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="journal-timeline">
              {visibleEntries.slice(0, 250).map((entry) => (
                <div className={`journal-entry entry-${entry.type}`} key={entry.id}>
                  <time>{entry.timeLabel}</time>
                  <span className="journal-entry-icon">{entry.icon}</span>
                  <div>
                    <strong>{entry.title}</strong>
                    <p>{entry.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <aside className="journal-card">
          <h3>Session Status</h3>
          <div className="journal-roadmap">
            <div><span>🔌</span><span><strong>Connection</strong><br />{isConnected ? 'Watching the selected log' : 'No active log watch'}</span></div>
            <div><span>📄</span><span><strong>Session lines</strong><br />{sessionLines.length.toLocaleString()} lines since New Sesh</span></div>
            <div><span>⚔️</span><span><strong>Fight details</strong><br />Full DPS snapshots remain on Dashboard</span></div>
            <div><span>⭐</span><span><strong>Named detection</strong><br />Ready for the EQL Wiki database pass</span></div>
            <div><span>🚨</span><span><strong>Combat bookmarks</strong><br />OH SHIT markers are counted and shown here</span></div>
          </div>
        </aside>
      </section>
    </main>
  )
}
