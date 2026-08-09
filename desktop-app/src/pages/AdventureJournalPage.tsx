import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../session/SessionContext'
import type {
  BossRecord,
  DatabaseStatus,
  JournalRecord
} from '../types/database'

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
  | 'instance'
  | 'death'

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

export default function AdventureJournalPage() {
  const [activeFilter, setActiveFilter] = useState<JournalFilter>('all')
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(null)
  const [entries, setEntries] = useState<JournalRecord[]>([])
  const [journalMessage, setJournalMessage] = useState('')
  const [bossQuery, setBossQuery] = useState('')
  const [bossResults, setBossResults] = useState<BossRecord[]>([])
  const [bossSearchMessage, setBossSearchMessage] = useState('')
  const {
    selectedLog,
    sessionLines,
    isConnected,
    journalRevision
  } = useSession()

  async function refreshJournal() {
    try {
      const [status, savedEntries] = await Promise.all([
        window.electronAPI.getDatabaseStatus(),
        window.electronAPI.listJournalEntries(5000)
      ])

      setDatabaseStatus(status)
      setEntries(savedEntries)
      setJournalMessage('')
    } catch (error) {
      console.error('Unable to load persistent Adventure Journal:', error)
      setJournalMessage('Unable to load saved Adventure Journal history.')
    }
  }

  useEffect(() => {
    void refreshJournal()
  }, [journalRevision])

  useEffect(() => {
    if (!isConnected) return

    const timer = window.setTimeout(() => {
      void refreshJournal()
    }, 250)

    return () => window.clearTimeout(timer)
  }, [sessionLines.length, isConnected])

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
          <span>Zones Visited</span>
          <strong>{zoneCount}</strong>
        </article>
        <article className="journal-stat">
          <span>Instances Created</span>
          <strong>{instanceCount}</strong>
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
              {visibleEntries.map((entry) => (
                <div
                  className={`journal-entry entry-${entry.entryType}`}
                  key={entry.id}
                >
                  <time>{getTimeLabel(entry.occurredAt)}</time>
                  <span className="journal-entry-icon">
                    {getIcon(entry.entryType)}
                  </span>
                  <div>
                    <strong>{entry.title}</strong>
                    <p>{entry.narrative}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <aside className="journal-card">
          <h3>Journal Status</h3>
          <div className="journal-roadmap">
            <div><span>💾</span><span><strong>Persistent history</strong><br />{entries.length.toLocaleString()} saved entries loaded</span></div>
            <div><span>🔌</span><span><strong>Connection</strong><br />{isConnected ? 'Watching the selected log' : 'Offline browsing available'}</span></div>
            <div><span>📄</span><span><strong>Live session lines</strong><br />{sessionLines.length.toLocaleString()} lines since New Sesh</span></div>
            <div><span>🗺️</span><span><strong>Travel history</strong><br />{zoneCount} zone{zoneCount === 1 ? '' : 's'} · {instanceCount} instance{instanceCount === 1 ? '' : 's'} saved</span></div>
            <div><span>⭐</span><span><strong>Boss catalog</strong><br />{databaseStatus?.bossCount.toLocaleString() ?? '...'} named mobs loaded</span></div>
            <div><span>🗄️</span><span><strong>Journal database</strong><br />{databaseStatus?.ready ? `Schema v${databaseStatus.schemaVersion} · ${databaseStatus.journalCount.toLocaleString()} stored` : 'Starting local database...'}</span></div>
            <div><span>🚨</span><span><strong>Combat bookmarks</strong><br />{incidentCount} saved OH SHIT marker{incidentCount === 1 ? '' : 's'}</span></div>
          </div>

          <div className="boss-catalog-tool">
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
