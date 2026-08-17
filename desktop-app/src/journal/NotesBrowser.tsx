import { useEffect, useMemo, useState } from 'react'
import type { EncounterRecord, PlayerNoteRecord } from '../types/database'

type NotesBrowserProps = {
  journalRevision: number
  encounterRevision: number
}

type NoteFilter = 'all' | 'fight' | 'session' | 'zone'

function formatWhen(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return value
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function durationLabel(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${(seconds - minutes * 60).toFixed(1)}s`
}

export function NotesBrowser({
  journalRevision,
  encounterRevision
}: NotesBrowserProps) {
  const [notes, setNotes] = useState<PlayerNoteRecord[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NoteFilter>('all')
  const [zoneFilter, setZoneFilter] = useState('all')
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null)
  const [selectedEncounter, setSelectedEncounter] =
    useState<EncounterRecord | null>(null)
  const [message, setMessage] = useState('')
  const [exportStatus, setExportStatus] = useState('')

  useEffect(() => {
    let cancelled = false

    void window.electronAPI
      .listPlayerNotes(1000)
      .then((savedNotes) => {
        if (cancelled) return
        setNotes(savedNotes)
        setMessage('')
      })
      .catch((error) => {
        console.error('Unable to load Notes Browser:', error)
        if (!cancelled) setMessage('Unable to load saved notes.')
      })

    return () => {
      cancelled = true
    }
  }, [journalRevision, encounterRevision])

  const zones = useMemo(
    () =>
      Array.from(
        new Set(
          notes
            .map((note) => note.zoneName?.trim())
            .filter((zone): zone is string => Boolean(zone))
        )
      ).sort((a, b) => a.localeCompare(b)),
    [notes]
  )

  const visibleNotes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()

    return notes.filter((note) => {
      const linked = Boolean(note.encounterSourceKey)
      if (filter === 'fight' && !linked) return false
      if (filter === 'session' && linked) return false
      if (filter === 'zone' && !note.zoneName) return false
      if (zoneFilter !== 'all' && note.zoneName !== zoneFilter) return false

      if (!normalizedQuery) return true

      return [
        note.noteText,
        note.zoneName ?? '',
        note.encounterTitle ?? '',
        note.primaryNpcName ?? ''
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    })
  }, [notes, filter, zoneFilter, query])

  const selectedNote =
    visibleNotes.find((note) => note.id === selectedNoteId) ??
    notes.find((note) => note.id === selectedNoteId) ??
    null

  useEffect(() => {
    let cancelled = false
    setSelectedEncounter(null)

    if (!selectedNote?.encounterSourceKey) {
      return () => {
        cancelled = true
      }
    }

    void window.electronAPI
      .getEncounterBySourceKey(selectedNote.encounterSourceKey)
      .then((encounter) => {
        if (!cancelled) setSelectedEncounter(encounter)
      })
      .catch((error) => {
        console.error('Unable to load note encounter details:', error)
      })

    return () => {
      cancelled = true
    }
  }, [selectedNote?.id, selectedNote?.encounterSourceKey])

  async function exportNotes() {
    setExportStatus('Exporting…')

    try {
      const result = await window.electronAPI.exportPlayerNotes()

      if (result.canceled) {
        setExportStatus('Export canceled')
        return
      }

      setExportStatus(
        `Saved ${result.count.toLocaleString()} notes · ${result.filePath ?? 'text file'}`
      )
    } catch (error) {
      console.error('Unable to export player notes:', error)
      setExportStatus('Export failed')
    }
  }

  return (
    <section
      style={{
        border: '1px solid #294b64',
        borderRadius: '14px',
        padding: '14px 16px',
        marginBottom: '18px',
        background: 'rgba(5, 20, 31, 0.72)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          alignItems: 'start',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>📝 Notes Notebook</h3>
          <p style={{ margin: '5px 0 0', opacity: 0.78 }}>
            Every saved breadcrumb in one place. Click a note to inspect its linked fight.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ opacity: 0.78 }}>
            {visibleNotes.length.toLocaleString()} / {notes.length.toLocaleString()} notes
          </strong>
          <button type="button" onClick={() => void exportNotes()}>
            Export Notes .txt
          </button>
        </div>
      </div>

      {exportStatus && (
        <div style={{ marginTop: '8px', fontSize: '0.85em', opacity: 0.76 }}>
          {exportStatus}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(180px, 1fr) repeat(2, minmax(150px, auto))',
          gap: '8px',
          marginTop: '12px'
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes, mobs, zones..."
          style={{
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid #365a73',
            background: '#081a28',
            color: 'inherit'
          }}
        />
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as NoteFilter)}
          style={{
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid #365a73',
            background: '#081a28',
            color: 'inherit'
          }}
        >
          <option value="all">All Notes</option>
          <option value="fight">Fight-linked</option>
          <option value="session">Session / General</option>
          <option value="zone">Notes with Zone</option>
        </select>
        <select
          value={zoneFilter}
          onChange={(event) => setZoneFilter(event.target.value)}
          style={{
            padding: '8px 10px',
            borderRadius: '8px',
            border: '1px solid #365a73',
            background: '#081a28',
            color: 'inherit'
          }}
        >
          <option value="all">All Zones</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>{zone}</option>
          ))}
        </select>
      </div>

      {message ? (
        <p>{message}</p>
      ) : notes.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No saved notes yet.</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 0.95fr) minmax(300px, 1.05fr)',
            gap: '12px',
            marginTop: '12px'
          }}
        >
          <div
            style={{
              maxHeight: '430px',
              overflowY: 'auto',
              border: '1px solid #18364a',
              borderRadius: '10px'
            }}
          >
            {visibleNotes.map((note) => {
              const selected = selectedNoteId === note.id

              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => setSelectedNoteId(note.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    border: 0,
                    borderBottom: '1px solid #18364a',
                    background: selected
                      ? 'rgba(45, 120, 183, 0.24)'
                      : 'transparent',
                    color: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '8px',
                      alignItems: 'baseline'
                    }}
                  >
                    <strong>{formatWhen(note.createdAt)}</strong>
                    <small style={{ opacity: 0.7 }}>
                      {note.encounterSourceKey ? '⚔️ Fight' : '📌 Note'}
                    </small>
                  </div>
                  <div style={{ marginTop: '4px' }}>{note.noteText}</div>
                  <small style={{ display: 'block', marginTop: '5px', opacity: 0.72 }}>
                    {note.zoneName ?? 'No zone context'}
                    {note.encounterTitle ? ` · ${note.encounterTitle}` : ''}
                  </small>
                </button>
              )
            })}
          </div>

          <div
            style={{
              minHeight: '210px',
              maxHeight: '430px',
              overflowY: 'auto',
              border: '1px solid #18364a',
              borderRadius: '10px',
              padding: '12px 14px'
            }}
          >
            {!selectedNote ? (
              <div style={{ opacity: 0.68 }}>
                Pick a note on the left. Fight-linked notes open their encounter details here.
              </div>
            ) : (
              <>
                <h4 style={{ margin: 0 }}>Selected Note</h4>
                <p style={{ margin: '6px 0 4px' }}>{selectedNote.noteText}</p>
                <small style={{ opacity: 0.72 }}>
                  {formatWhen(selectedNote.createdAt)}
                  {selectedNote.zoneName ? ` · ${selectedNote.zoneName}` : ''}
                </small>

                <hr style={{ border: 0, borderTop: '1px solid #18364a', margin: '14px 0' }} />

                {selectedEncounter ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: '10px',
                        alignItems: 'start'
                      }}
                    >
                      <div>
                        <strong>⚔️ {selectedEncounter.encounterTitle}</strong>
                        <div style={{ opacity: 0.75, marginTop: '3px' }}>
                          {selectedEncounter.zoneName ?? 'Unknown zone'}
                          {selectedEncounter.zoneDetail
                            ? ` · ${selectedEncounter.zoneDetail}`
                            : ''}
                        </div>
                      </div>
                      <strong>
                        {selectedEncounter.outcome === 'victory' ? 'VICTORY' : 'FAILED'}
                      </strong>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        gap: '8px',
                        marginTop: '12px'
                      }}
                    >
                      <div><small>Damage</small><br /><strong>{selectedEncounter.totalDamage.toLocaleString()}</strong></div>
                      <div><small>DPS</small><br /><strong>{selectedEncounter.dps.toFixed(1)}</strong></div>
                      <div><small>Duration</small><br /><strong>{durationLabel(selectedEncounter.durationMs)}</strong></div>
                      <div><small>Player</small><br /><strong>{selectedEncounter.playerDamage.toLocaleString()}</strong></div>
                      <div><small>Pet</small><br /><strong>{selectedEncounter.petDamage.toLocaleString()}</strong></div>
                      <div><small>Best Hit</small><br /><strong>{selectedEncounter.bestHit.toLocaleString()}</strong></div>
                    </div>

                    {selectedEncounter.abilities.length > 0 && (
                      <div style={{ marginTop: '14px' }}>
                        <strong>Top Damage Sources</strong>
                        <div style={{ marginTop: '6px', display: 'grid', gap: '4px' }}>
                          {selectedEncounter.abilities.slice(0, 8).map((ability, index) => (
                            <div
                              key={`${ability.actor}-${ability.ability}-${index}`}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: '8px'
                              }}
                            >
                              <span>{ability.ability}{ability.actorType === 'pet' ? ` · ${ability.actor}` : ''}</span>
                              <span>{ability.damage.toLocaleString()} · {ability.hits} hits</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : selectedNote.encounterSourceKey ? (
                  <div style={{ opacity: 0.75 }}>
                    Loading linked fight details…
                  </div>
                ) : (
                  <div style={{ opacity: 0.75 }}>
                    Session / general note — no fight is attached.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
