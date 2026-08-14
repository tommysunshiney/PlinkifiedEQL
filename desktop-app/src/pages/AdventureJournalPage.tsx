import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../session/SessionContext'
import type {
  BossRecord,
  DatabaseStatus,
  EncounterRecord,
  JournalRecord,
  PlayerNoteRecord
} from '../types/database'

type JournalFilter =
  | 'all'
  | 'fights'
  | 'named'
  | 'loot'
  | 'incidents'

const filters: Array<{ id: JournalFilter; label: string }> = [
  { id: 'all', label: 'All Activity' },
  { id: 'fights', label: 'Fights' },
  { id: 'named', label: 'Named Mobs' },
  { id: 'loot', label: 'Loot' },
  { id: 'incidents', label: 'OH SHIT!' }
]

function getTimeLabel(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return '--'

  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getDayLabel(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'Unknown date'

  return new Date(timestamp).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

function getIcon(type: string): string {
  if (type === 'incident') return '🚨'
  if (type === 'instance') return '🧭'
  if (type === 'zone') return '🗺️'
  if (type === 'level') return '⬆️'
  if (type === 'fight' || type === 'named') return '⚔️'
  if (type === 'death') return '☠️'
  if (type === 'loot') return '🎒'
  return '•'
}

function normalizeNpcName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^defeated\s+/i, '')
    .replace(/^an?\s+|^the\s+/i, '')
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
}

function formatDuration(milliseconds: number): string {
  const safeMilliseconds = Math.max(0, milliseconds)
  if (safeMilliseconds < 1000) return '<1 sec'

  const seconds = safeMilliseconds / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} sec`

  const minutes = Math.floor(seconds / 60)
  const remaining = seconds - minutes * 60
  return `${minutes}m ${remaining.toFixed(1)}s`
}

function formatActionOffset(milliseconds: number): string {
  return `+${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`
}

function formatAttemptSummary(encounter: EncounterRecord): string {
  if (encounter.namedMobId === null) {
    return encounter.outcome === 'victory' ? 'Victory' : 'Failed encounter'
  }

  if (encounter.outcome === 'victory') {
    return encounter.attemptNumber === 1
      ? 'Victory · 1 and done'
      : `Victory · Attempt ${encounter.attemptNumber}`
  }

  return `Failed attempt ${encounter.attemptNumber}`
}

function compactActionSequence(encounter: EncounterRecord): string[] {
  const compacted: Array<{ label: string; count: number }> = []

  for (const action of encounter.actions) {
    const label = `${formatActionOffset(action.offsetMs)} ${action.name}`
    const previous = compacted[compacted.length - 1]

    if (previous?.label === label) {
      previous.count += 1
    } else {
      compacted.push({ label, count: 1 })
    }
  }

  return compacted.map((item) =>
    item.count > 1 ? `${item.label} ×${item.count}` : item.label
  )
}

function humanizeTimelineText(value: string): string {
  const match = value.match(/^(\+\d+(?:\.\d+)?s)\s+(.+)$/)
  if (!match) return value

  const [, time, raw] = match

  let text = raw
  if (/^(on|off)(?: ×\d+)?$/i.test(raw)) {
    text = `Auto Attack turned ${raw.toUpperCase()}`
  } else if (/^backstab(?: ×\d+)?$/i.test(raw)) {
    text = `You used ${raw.replace(/^backstab/i, 'Backstab')}`
  } else if (raw.includes(' → ') && / interrupted(?: ×\d+)?$/i.test(raw)) {
    text = raw
      .replace(' → ', ' — ')
      .replace(/ interrupted/i, ' was interrupted')
  } else if (raw.includes(' → ') && /\+\d+(?: ×\d+)?$/.test(raw)) {
    const heal = raw.match(/^(.+?) → (.+?) \+(\d+)(.*)$/)
    if (heal) {
      text = `${heal[1]}'s ${heal[2]} landed — healed ${heal[3]} HP${heal[4]}`
    }
  } else if (raw.includes(' → ') && /stunned/i.test(raw)) {
    text = raw.replace(' → stunned', ' was stunned')
  } else if (raw.includes(' → ') && /CC ended/i.test(raw)) {
    text = raw.replace(' → CC ended', ' — crowd control ended')
  } else if (raw.includes(' → ')) {
    const [mob, spell] = raw.split(' → ')
    text = `${mob} began casting ${spell}`
  } else if (/^[A-Za-z].*/.test(raw)) {
    text = `You cast/used ${raw}`
  }

  return `${time} ${text}`
}

function findEncounterForEntry(
  entry: JournalRecord,
  encounters: EncounterRecord[]
): EncounterRecord | null {
  if (entry.entryType !== 'fight' && entry.entryType !== 'named') {
    return null
  }

  const target = normalizeNpcName(entry.title)
  const occurredAt = Date.parse(entry.occurredAt)

  const candidates = encounters.filter((encounter) => {
    if (encounter.outcome !== 'victory') return false

    const primary = normalizeNpcName(encounter.primaryNpcName)
    const title = normalizeNpcName(encounter.encounterTitle)
    return primary === target || title === target || title.startsWith(`${target} +`)
  })

  if (candidates.length === 0 || Number.isNaN(occurredAt)) return null

  return candidates
    .map((encounter) => ({
      encounter,
      distance: Math.abs(Date.parse(encounter.endedAt) - occurredAt)
    }))
    .filter((candidate) => candidate.distance <= 30_000)
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance
      if (a.encounter.totalDamage !== b.encounter.totalDamage) {
        return b.encounter.totalDamage - a.encounter.totalDamage
      }
      return b.encounter.durationMs - a.encounter.durationMs
    })[0]?.encounter ?? null
}

export default function AdventureJournalPage() {
  const [playerNotes, setPlayerNotes] = useState<PlayerNoteRecord[]>([])

  const [activeFilter, setActiveFilter] = useState<JournalFilter>('all')
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null)
  const [entries, setEntries] = useState<JournalRecord[]>([])
  const [encounters, setEncounters] = useState<EncounterRecord[]>([])
  const [selectedEncounter, setSelectedEncounter] = useState<EncounterRecord | null>(null)
  const [journalMessage, setJournalMessage] = useState('')
  const [bossQuery, setBossQuery] = useState('')
  const [bossResults, setBossResults] = useState<BossRecord[]>([])
  const [bossSearchMessage, setBossSearchMessage] = useState('')
  const {
	selectedLog,
	sessionLines,
	isConnected,
	journalRevision,
	encounterRevision,
		} = useSession()

  async function refreshJournal() {
    try {
      const [status, savedEntries, savedEncounters, savedPlayerNotes] =
        await Promise.all([
          window.electronAPI.getDatabaseStatus(),
          window.electronAPI.listJournalEntries(5000),
          window.electronAPI.listEncounters(2000),
          window.electronAPI.listPlayerNotes(100)
        ])

      setDatabaseStatus(status)
      setEntries(savedEntries)
      setEncounters(savedEncounters)
      setPlayerNotes(savedPlayerNotes)
      setJournalMessage('')
    } catch (error) {
      console.error('Unable to load persistent Adventure Journal:', error)
      setJournalMessage('Unable to load saved Adventure Journal history.')
    }
  }

  useEffect(() => {
    void refreshJournal()
  }, [journalRevision, encounterRevision])

  async function handleBossSearch() {
    const query = bossQuery.trim()
    if (!query) {
      setBossResults([])
      setBossSearchMessage('Type an NPC name or title first.')
      return
    }

    try {
      const results = await window.electronAPI.searchBosses(query)
      setBossResults(results)
      setBossSearchMessage(
        results.length
          ? `${results.length} boss${results.length === 1 ? '' : 'es'} found.`
          : 'No matching bosses are in the local catalog yet.'
      )
    } catch (error) {
      console.error(error)
      setBossSearchMessage('Boss search failed.')
    }
  }

  const visibleEntries = useMemo(() => {
    if (activeFilter === 'all') return entries
    if (activeFilter === 'fights') {
      return entries.filter((entry) => entry.entryType === 'fight')
    }
    if (activeFilter === 'named') {
      return entries.filter((entry) => entry.entryType === 'named')
    }
    if (activeFilter === 'loot') {
      return entries.filter((entry) => entry.entryType === 'loot')
    }

    return entries.filter((entry) => entry.entryType === 'incident')
  }, [activeFilter, entries])

  const groupedVisibleEntries = useMemo(() => {
    const groups: Array<{ label: string; entries: JournalRecord[] }> = []

    for (const entry of visibleEntries) {
      const label = getDayLabel(entry.occurredAt)
      const current = groups[groups.length - 1]

      if (!current || current.label !== label) {
        groups.push({ label, entries: [entry] })
      } else {
        current.entries.push(entry)
      }
    }

    return groups
  }, [visibleEntries])

  const encounterForEntryId = useMemo(() => {
    const matches = new Map<number, EncounterRecord>()

    for (const entry of entries) {
      if (entry.entryType !== 'fight' && entry.entryType !== 'named') continue
      const encounter = encounterForEntryId.get(entry.id) ?? null
      if (encounter) matches.set(entry.id, encounter)
    }

    return matches
  }, [entries, encounters])

  const lootCount = entries.filter(
    (entry) => entry.entryType === 'loot'
  ).length
  const incidentCount = entries.filter(
    (entry) => entry.entryType === 'incident'
  ).length
  const zoneCount = new Set(
    entries
      .filter((entry) => entry.entryType === 'zone' && entry.zoneName)
      .map((entry) => entry.zoneName)
  ).size
  const instanceCount = entries.filter(
    (entry) => entry.entryType === 'instance'
  ).length

  function handleEntryClick(entry: JournalRecord) {
    const encounter = findEncounterForEntry(entry, encounters)
    if (!encounter) return

    setSelectedEncounter((current) =>
      current?.id === encounter.id ? null : encounter
    )
  }

  return (
    <main className="journal-page">
      <header className="journal-hero">
        <div>
          <h2>Adventure Journal</h2>
          <p>
            Permanent PEQL history. Saved adventures remain available
            even when no game log is connected.
          </p>
          <small className="journal-source">
            {isConnected
              ? `Live capture: ${selectedLog}`
              : 'Offline history mode — no active log required.'}
          </small>
        </div>

        <span className={`journal-badge ${isConnected ? 'connected' : ''}`}>
          {isConnected ? 'Live + Saved' : 'Saved History'}
        </span>
      </header>

      <section className="journal-summary">
        <article className="journal-stat">
          <span>Journal Entries</span>
          <strong>{entries.length.toLocaleString()}</strong>
        </article>
        <article className="journal-stat">
          <span>Encounters Stored</span>
          <strong>{encounters.length.toLocaleString()}</strong>
        </article>
        <article className="journal-stat">
          <span>Zones Visited</span>
          <strong>{zoneCount}</strong>
        </article>
        <article className="journal-stat">
          <span>Loot Recorded</span>
          <strong>{lootCount.toLocaleString()}</strong>
        </article>
      </section>

      <nav className="journal-toolbar" aria-label="Journal filters">
        {filters.map((filter) => (
          <button
            className={`journal-filter ${activeFilter === filter.id ? 'active' : ''}`}
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </nav>

      <section className="journal-grid">
        <article className="journal-card">
          <h3>Adventure History</h3>

          {journalMessage && (
            <div className="journal-empty">
              <div>
                <strong>Journal database unavailable</strong>
                <p>{journalMessage}</p>
              </div>
            </div>
          )}

          {!journalMessage && visibleEntries.length === 0 ? (
            <div className="journal-empty">
              <div>
                <strong>No matching saved entries yet</strong>
                <p>
                  Connect an EQL log once and PEQL will import recognized
                  adventures into its local database. After that, this page
                  works even when the log is disconnected.
                </p>
              </div>
            </div>
          ) : !journalMessage ? (
            <div className="journal-timeline">
              {groupedVisibleEntries.map((group) => (
                <section className="journal-day-group" key={group.label}>
                  <h4 className="journal-day-heading">{group.label}</h4>
                  {group.entries.map((entry) => {
                    const encounter = encounterForEntryId.get(entry.id) ?? null
                    const clickable = encounter !== null
                    const selected = selectedEncounter?.id === encounter?.id

                    return (
                      <div key={entry.id}>
                        <div
                          className={`journal-entry entry-${entry.entryType}`}
                          onClick={() => handleEntryClick(entry)}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          onKeyDown={(event) => {
                            if (!clickable) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              handleEntryClick(entry)
                            }
                          }}
                          style={{
                            cursor: clickable ? 'pointer' : 'default',
                            outline: selected ? '1px solid currentColor' : undefined
                          }}
                          title={clickable ? 'Open saved encounter details' : undefined}
                        >
                          <time>{getTimeLabel(entry.occurredAt)}</time>
                          <span className="journal-entry-icon">
                            {getIcon(entry.entryType)}
                          </span>
                          <div>
                            <strong>
                              {entry.title}
                              {clickable ? '  ›' : ''}
                            </strong>
                            <p>{entry.narrative}</p>
                          </div>
                        </div>

                        {selected && encounter && (
                          <div
                            className="journal-roadmap"
                            style={{
                              margin: '0 0 12px 0',
                              padding: '12px 14px'
                            }}
                          >
                            <div>
                              <span>{encounter.outcome === 'victory' ? '🏆' : '☠️'}</span>
                              <span>
                                <strong>
                                  {encounter.namedTitle || encounter.primaryNpcName}
                                </strong>
                                <br />
                                {formatAttemptSummary(encounter)}
                              </span>
                            </div>

                            <div>
                              <span>🗺️</span>
                              <span>
                                <strong>Location</strong>
                                <br />
                                {encounter.zoneName || 'Unknown zone'}
                                {encounter.zoneDetail
                                  ? ` · ${encounter.zoneDetail}`
                                  : ''}
                              </span>
                            </div>

                            <div>
                              <span>⏱️</span>
                              <span>
                                <strong>Fight</strong>
                                <br />
                                {formatDuration(encounter.durationMs)} ·{' '}
                                {encounter.dps.toFixed(1)} DPS ·{' '}
                                {encounter.totalDamage.toLocaleString()} damage
                              </span>
                            </div>

                            <div>
                              <span>🗡️</span>
                              <span>
                                <strong>Damage split</strong>
                                <br />
                                You {encounter.playerDamage.toLocaleString()} · Pet{' '}
                                {encounter.petDamage.toLocaleString()} · Best hit{' '}
                                {encounter.bestHit.toLocaleString()}
                              </span>
                            </div>

                            <div>
                              <span>🏁</span>
                              <span>
                                <strong>End reason</strong>
                                <br />
                                {encounter.endReason}
                              </span>
                            </div>

                            {encounter.wikiUrl && (
                              <div>
                                <span>⭐</span>
                                <span>
                                  <strong>Named mob</strong>
                                  <br />
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void window.electronAPI.openExternal(
                                        encounter.wikiUrl as string
                                      )
                                    }}
                                  >
                                    Open EQL Wiki ↗
                                  </button>
                                </span>
                              </div>
                            )}

                            {encounter.mobs.length > 0 && (
                              <div>
                                <span>⚔️</span>
                                <span style={{ width: '100%' }}>
                                  <strong>Encounter mobs</strong>
                                  <br />
                                  <span
                                    style={{
                                      display: 'grid',
                                      gap: '4px',
                                      marginTop: '6px'
                                    }}
                                  >
                                    {encounter.mobs.map((mob, index) => (
                                      <span
                                        key={`${encounter.id}-mob-${index}`}
                                        style={{
                                          display: 'grid',
                                          gridTemplateColumns:
                                            'minmax(150px, 1fr) auto',
                                          gap: '10px'
                                        }}
                                      >
                                        <span>
                                          {mob.name}
                                          {mob.joinedLater
                                            ? ` · joined +${(
                                                mob.joinedOffsetMs / 1000
                                              ).toFixed(0)}s`
                                            : ' · initial pull'}
                                        </span>
                                        <span>
                                          {(mob.activeDamage ?? mob.totalDamage).toLocaleString()} active dmg ·{' '}
                                          {mob.dps.toFixed(1)} active DPS ·{' '}
                                          {mob.burnDurationMs > 0
                                            ? `${(
                                                mob.burnDurationMs / 1000
                                              ).toFixed(1)}s active`
                                            : 'no active burn'}
                                          {mob.elapsedTtkMs > 0
                                            ? ` · ${(mob.elapsedTtkMs / 1000).toFixed(1)}s elapsed TTK`
                                            : ''}
                                        </span>
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              </div>
                            )}

                            <div>
                              <span>🧠</span>
                              <span style={{ width: '100%' }}>
                                <strong>
                                  Fight Timeline —{' '}
                                  {encounter.namedTitle ||
                                    encounter.primaryNpcName}
                                </strong>
                                <br />
                                {encounter.actions.length === 0 ? (
                                  'No Fight Timeline events captured for this encounter.'
                                ) : (
                                  <span
                                    style={{
                                      display: 'grid',
                                      gap: '2px',
                                      marginTop: '6px',
                                      maxHeight: '300px',
                                      overflowY: 'auto'
                                    }}
                                  >
                                    {compactActionSequence(encounter).map(
                                      (item, index) => {
                                        const human =
                                          humanizeTimelineText(item)
                                        const match = human.match(
                                          /^(\+\d+(?:\.\d+)?s)\s+(.+)$/
                                        )

                                        return (
                                          <span
                                            key={`${encounter.id}-timeline-${index}`}
                                            style={{
                                              display: 'grid',
                                              gridTemplateColumns:
                                                '58px minmax(0, 1fr)',
                                              gap: '8px'
                                            }}
                                          >
                                            <span>
                                              {match?.[1] ?? ''}
                                            </span>
                                            <span>
                                              {match?.[2] ?? human}
                                            </span>
                                          </span>
                                        )
                                      }
                                    )}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          ) : null}
        </article>

        <aside className="journal-card">
          <h3>Journal Status</h3>
          <div className="journal-roadmap">
            <div><span>💾</span><span><strong>Persistent history</strong><br />{entries.length.toLocaleString()} saved entries loaded</span></div>
            <div><span>⚔️</span><span><strong>Encounter history</strong><br />{databaseStatus?.encounterCount.toLocaleString() ?? encounters.length.toLocaleString()} completed fights stored</span></div>
            <div><span>🔌</span><span><strong>Connection</strong><br />{isConnected ? 'Watching the selected log' : 'Offline browsing available'}</span></div>
            <div><span>📄</span><span><strong>Live session lines</strong><br />{sessionLines.length.toLocaleString()} lines since New Sesh</span></div>
            <div><span>🗺️</span><span><strong>Travel history</strong><br />{zoneCount} zone{zoneCount === 1 ? '' : 's'} · {instanceCount} instance{instanceCount === 1 ? '' : 's'} saved</span></div>
            <div><span>⭐</span><span><strong>Boss catalog</strong><br />{databaseStatus?.bossCount.toLocaleString() ?? '...'} named mobs loaded</span></div>
            <div><span>🗄️</span><span><strong>Journal database</strong><br />{databaseStatus?.ready ? `Schema v${databaseStatus.schemaVersion} · ${databaseStatus.journalCount.toLocaleString()} stored` : 'Starting local database...'}</span></div>
            <div><span>🚨</span><span><strong>Combat bookmarks</strong><br />{incidentCount} saved OH SHIT marker{incidentCount === 1 ? '' : 's'}</span></div>
          </div>

          <div className="boss-catalog-tool">
            <div style={{ marginTop: '18px', marginBottom: '18px' }}>
              <h4>📝 Recent Player Notes</h4>
              <div
                style={{
                  display: 'grid',
                  gap: '7px',
                  maxHeight: '190px',
                  overflowY: 'auto'
                }}
              >
                {playerNotes.length === 0 ? (
                  <span style={{ opacity: 0.75 }}>
                    No player notes saved yet.
                  </span>
                ) : (
                  playerNotes.slice(0, 12).map((note) => (
                    <div
                      key={note.id}
                      style={{
                        paddingBottom: '7px',
                        borderBottom: '1px solid #18364a'
                      }}
                    >
                      <strong>
                        {new Date(note.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </strong>
                      {note.zoneName ? ` · ${note.zoneName}` : ''}
                      {note.encounterTitle
                        ? ` · ${note.encounterTitle}`
                        : note.encounterSourceKey
                          ? ' · active encounter'
                          : ' · session note'}
                      <br />
                      {note.noteText}
                    </div>
                  ))
                )}
              </div>
            </div>

            <h4>Boss Wiki Lookup</h4>
            <p>
              Search the bundled named-mob catalog and open its EQL Wiki
              page in your default browser.
            </p>
            <div className="boss-search-row">
              <input
                value={bossQuery}
                onChange={(event) => setBossQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleBossSearch()
                }}
                placeholder="NPC name or title"
              />
              <button onClick={() => void handleBossSearch()}>Search</button>
            </div>
            {bossSearchMessage && (
              <small className="boss-search-message">{bossSearchMessage}</small>
            )}
            <div className="boss-search-results">
              {bossResults.slice(0, 8).map((boss) => (
                <article key={boss.id}>
                  <div>
                    <strong>{boss.title || boss.npcName}</strong>
                    {boss.title && <span>{boss.npcName}</span>}
                    {boss.zone && <small>{boss.zone}</small>}
                  </div>
                  <button onClick={() => void window.electronAPI.openExternal(boss.wikiUrl)}>
                    Wiki ↗
                  </button>
                </article>
              ))}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
