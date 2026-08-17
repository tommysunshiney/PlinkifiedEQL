import { useEffect, useMemo, useState } from 'react'
import PeqlLoading from '../components/PeqlLoading'
import { NotesBrowser } from '../journal/NotesBrowser'
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

const JOURNAL_RENDER_STEP = 100

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

export default function AdventureJournalPage() {
  const [playerNotes, setPlayerNotes] = useState<PlayerNoteRecord[]>([])

  const [activeFilter, setActiveFilter] = useState<JournalFilter>('all')
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null)
  const [entries, setEntries] = useState<JournalRecord[]>([])
  const [encounters, setEncounters] = useState<EncounterRecord[]>([])
  const [selectedEncounter, setSelectedEncounter] = useState<EncounterRecord | null>(null)
  const [journalMessage, setJournalMessage] = useState('')
  const [journalLoading, setJournalLoading] = useState(true)
  const [journalLoadingStage, setJournalLoadingStage] =
    useState('Opening saved history…')
  const [renderLimit, setRenderLimit] = useState(JOURNAL_RENDER_STEP)
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
      // Stage fast/light data first so the Journal becomes useful immediately.
      // Do not make notes/history wait for heavy encounter hydration.
      setJournalLoading(true)
      setJournalLoadingStage('Loading saved notes…')
      const savedPlayerNotes =
        await window.electronAPI.listPlayerNotes(1000)
      setPlayerNotes(savedPlayerNotes)

      setJournalLoadingStage('Loading adventure history…')
      const [status, savedEntries] = await Promise.all([
        window.electronAPI.getDatabaseStatus(),
        window.electronAPI.listJournalEntries(5000)
      ])
      setDatabaseStatus(status)
      setEntries(savedEntries)
      setJournalMessage('')

      // Encounter summaries intentionally omit large JSON payloads.
      setJournalLoadingStage('Matching recent encounters…')
      const savedEncounters =
        await window.electronAPI.listEncounterSummaries(2000)
      setEncounters(savedEncounters)
      setJournalLoading(false)
    } catch (error) {
      console.error('Unable to load persistent Adventure Journal:', error)
      setJournalMessage('Unable to load saved Adventure Journal history.')
      setJournalLoading(false)
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

  const renderedEntries = useMemo(
    () => visibleEntries.slice(0, renderLimit),
    [visibleEntries, renderLimit]
  )

  const groupedVisibleEntries = useMemo(() => {
    const groups: Array<{ label: string; entries: JournalRecord[] }> = []

    for (const entry of renderedEntries) {
      const label = getDayLabel(entry.occurredAt)
      const current = groups[groups.length - 1]

      if (!current || current.label !== label) {
        groups.push({ label, entries: [entry] })
      } else {
        current.entries.push(entry)
      }
    }

    return groups
  }, [renderedEntries])

  const encounterForEntryId = useMemo(() => {
    type IndexedEncounter = {
      encounter: EncounterRecord
      primary: string
      title: string
      endedAt: number
    }

    const exact = new Map<string, IndexedEncounter[]>()
    const indexed: IndexedEncounter[] = []

    function addExact(key: string, value: IndexedEncounter) {
      if (!key) return
      const existing = exact.get(key)
      if (existing) {
        existing.push(value)
      } else {
        exact.set(key, [value])
      }
    }

    for (const encounter of encounters) {
      if (encounter.outcome !== 'victory') continue

      const value: IndexedEncounter = {
        encounter,
        primary: normalizeNpcName(encounter.primaryNpcName),
        title: normalizeNpcName(encounter.encounterTitle),
        endedAt: Date.parse(encounter.endedAt)
      }

      indexed.push(value)
      addExact(value.primary, value)
      addExact(value.title, value)
    }

    const matches = new Map<number, EncounterRecord>()

    // Only rows that can actually be displayed/clicked need a match right now.
    // "Show more history" naturally expands this set in bounded chunks.
    for (const entry of renderedEntries) {
      if (entry.entryType !== 'fight' && entry.entryType !== 'named') {
        continue
      }

      const target = normalizeNpcName(entry.title)
      const occurredAt = Date.parse(entry.occurredAt)
      if (!target || Number.isNaN(occurredAt)) continue

      const candidates = new Map<number, IndexedEncounter>()

      for (const candidate of exact.get(target) ?? []) {
        candidates.set(candidate.encounter.id, candidate)
      }

      // Multi-add encounter titles are stored as "target + N adds".
      // This fallback is only used when exact lookup did not already give us
      // candidates, and it uses pre-normalized strings.
      if (candidates.size === 0) {
        for (const candidate of indexed) {
          if (candidate.title.startsWith(`${target} +`)) {
            candidates.set(candidate.encounter.id, candidate)
          }
        }
      }

      let best: IndexedEncounter | null = null
      let bestDistance = Number.POSITIVE_INFINITY

      for (const candidate of candidates.values()) {
        if (Number.isNaN(candidate.endedAt)) continue

        const distance = Math.abs(candidate.endedAt - occurredAt)
        if (distance > 30_000) continue

        if (
          best === null ||
          distance < bestDistance ||
          (
            distance === bestDistance &&
            candidate.encounter.totalDamage > best.encounter.totalDamage
          ) ||
          (
            distance === bestDistance &&
            candidate.encounter.totalDamage === best.encounter.totalDamage &&
            candidate.encounter.durationMs > best.encounter.durationMs
          )
        ) {
          best = candidate
          bestDistance = distance
        }
      }

      if (best) matches.set(entry.id, best.encounter)
    }
    return matches
  }, [renderedEntries, encounters])

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

  async function handleEntryClick(entry: JournalRecord) {
    const summary = encounterForEntryId.get(entry.id) ?? null
    if (!summary) return

    if (selectedEncounter?.id === summary.id) {
      setSelectedEncounter(null)
      return
    }

    try {
      const detailed =
        await window.electronAPI.getEncounterById(summary.id)
      setSelectedEncounter(detailed ?? summary)
    } catch (error) {
      console.error('Unable to load encounter details:', error)
      setSelectedEncounter(summary)
    }
  }

  async function handleNoteEncounter(note: PlayerNoteRecord) {
    if (!note.encounterSourceKey) return

    try {
      const encounter =
        await window.electronAPI.getEncounterBySourceKey(
          note.encounterSourceKey
        )

      if (!encounter) return

      setActiveFilter('all')
      setSelectedEncounter(encounter)

      window.setTimeout(() => {
        const row = document.querySelector(
          `[data-encounter-id="${encounter.id}"]`
        )
        row?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }, 50)
    } catch (error) {
      console.error('Unable to open note-linked encounter:', error)
    }
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
            onClick={() => {
              setActiveFilter(filter.id)
              setRenderLimit(JOURNAL_RENDER_STEP)
            }}
          >
            {filter.label}
          </button>
        ))}
      </nav>

      <NotesBrowser
        journalRevision={journalRevision}
        encounterRevision={encounterRevision}
      />

      {journalLoading && (
        <PeqlLoading
          title="Loading Adventure Journal"
          stage={journalLoadingStage}
          detail="Saved history is loading independently of the live EQL log."
        />
      )}

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
                          data-encounter-id={encounter?.id}
                          onClick={() => void handleEntryClick(entry)}
                          role={clickable ? 'button' : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          onKeyDown={(event) => {
                            if (!clickable) return
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              void handleEntryClick(entry)
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

          {!journalMessage && visibleEntries.length > renderLimit && (
            <div style={{ padding: '12px 0', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() =>
                  setRenderLimit((current) =>
                    Math.min(
                      visibleEntries.length,
                      current + JOURNAL_RENDER_STEP
                    )
                  )
                }
              >
                Show more history · {Math.min(
                  JOURNAL_RENDER_STEP,
                  visibleEntries.length - renderLimit
                )} more
              </button>
              <div style={{ marginTop: '5px', opacity: 0.65, fontSize: '0.82em' }}>
                Showing {Math.min(renderLimit, visibleEntries.length).toLocaleString()}
                {' '}of {visibleEntries.length.toLocaleString()} matching entries
              </div>
            </div>
          )}
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
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px'
                }}
              >
                <h4 style={{ margin: 0 }}>📝 Notes Center</h4>
                <small style={{ opacity: 0.7 }}>
                  {playerNotes.length} loaded
                </small>
              </div>
              <p style={{ marginTop: '6px', opacity: 0.78 }}>
                Your breadcrumbs. Encounter-linked notes can jump straight
                back to the saved fight.
              </p>
              <div
                style={{
                  display: 'grid',
                  gap: '9px',
                  maxHeight: '320px',
                  overflowY: 'auto'
                }}
              >
                {playerNotes.length === 0 ? (
                  <span style={{ opacity: 0.75 }}>
                    No player notes saved yet.
                  </span>
                ) : (
                  playerNotes.slice(0, 30).map((note) => {
                    const linkedEncounter = note.encounterSourceKey
                      ? encounters.find(
                          (encounter) =>
                            encounter.sourceKey === note.encounterSourceKey
                        ) ?? null
                      : null

                    return (
                      <div
                        key={note.id}
                        style={{
                          padding: '8px 0',
                          borderBottom: '1px solid #18364a'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: '8px',
                            alignItems: 'start'
                          }}
                        >
                          <span>
                            <strong>
                              {new Date(note.createdAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </strong>
                            {note.zoneName ? ` · ${note.zoneName}` : ''}
                            <br />
                            <small style={{ opacity: 0.78 }}>
                              {note.encounterTitle
                                ? note.encounterTitle
                                : note.encounterSourceKey
                                  ? 'Encounter-linked note'
                                  : 'Session / general note'}
                            </small>
                          </span>

                          {linkedEncounter && (
                            <button
                              type="button"
                              onClick={() => handleNoteEncounter(note)}
                              title="Open this note's saved encounter in Adventure History"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              Open Fight ›
                            </button>
                          )}
                        </div>
                        <div style={{ marginTop: '5px' }}>{note.noteText}</div>
                      </div>
                    )
                  })
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
