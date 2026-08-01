import { useState } from 'react'

type JournalFilter =
  | 'all'
  | 'fights'
  | 'named'
  | 'loot'
  | 'incidents'

const filters: Array<{
  id: JournalFilter
  label: string
}> = [
  { id: 'all', label: 'All Activity' },
  { id: 'fights', label: 'Fights' },
  { id: 'named', label: 'Named Mobs' },
  { id: 'loot', label: 'Loot' },
  { id: 'incidents', label: 'OH SHIT!' }
]

export default function AdventureJournalPage() {
  const [activeFilter, setActiveFilter] =
    useState<JournalFilter>('all')

  return (
    <main className="journal-page">
      <header className="journal-hero">
        <div>
          <h2>Adventure Journal</h2>
          <p>
            Your session history will grow here: fights,
            named mobs, loot, level gains, deaths, zones,
            and every OH SHIT combat bookmark.
          </p>
        </div>

        <span className="journal-badge">
          Framework Online
        </span>
      </header>

      <section className="journal-summary">
        <article className="journal-stat">
          <span>Journal Entries</span>
          <strong>0</strong>
        </article>

        <article className="journal-stat">
          <span>Named Encounters</span>
          <strong>0</strong>
        </article>

        <article className="journal-stat">
          <span>Loot Recorded</span>
          <strong>0</strong>
        </article>

        <article className="journal-stat">
          <span>OH SHIT Moments</span>
          <strong>0</strong>
        </article>
      </section>

      <nav
        className="journal-toolbar"
        aria-label="Journal filters"
      >
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

          <div className="journal-empty">
            <div>
              <strong>
                No journal entries recorded yet
              </strong>
              <p>
                This is the display framework. Next we will
                feed it shared session data from the Dashboard
                and turn fights, kills, loot, zoning, and combat
                bookmarks into real timeline entries.
              </p>
            </div>
          </div>
        </article>

        <aside className="journal-card">
          <h3>Framework Hooks</h3>

          <div className="journal-roadmap">
            <div>
              <span>⚔️</span>
              <span>
                <strong>Fight snapshots</strong><br />
                DPS, damage, duration, target, best hit
              </span>
            </div>

            <div>
              <span>⭐</span>
              <span>
                <strong>Named detection</strong><br />
                EQL Wiki-backed mob and drop details
              </span>
            </div>

            <div>
              <span>🎒</span>
              <span>
                <strong>Loot history</strong><br />
                Personal item and currency records
              </span>
            </div>

            <div>
              <span>🚨</span>
              <span>
                <strong>Combat bookmarks</strong><br />
                Review activity surrounding OH SHIT markers
              </span>
            </div>

            <div>
              <span>🗺️</span>
              <span>
                <strong>Zone progress</strong><br />
                First visits, named kills, and completion
              </span>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
