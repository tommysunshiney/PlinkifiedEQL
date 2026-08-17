import { memo, useMemo, useState } from 'react'
import type { PlayerNoteRecord } from '../types/database'

export type NoteEncounterOption = {
  id: string
  target: string
  label: string
}

type QuickPlayerNoteProps = {
  selectedLog: string
  zoneName: string | null
  activeEncounterId?: string
  activeEncounterTarget?: string
  recentEncounters?: NoteEncounterOption[]
  onSaved: (note: PlayerNoteRecord) => void
}

type NoteContext = 'auto' | 'session' | 'general' | string

function QuickPlayerNoteComponent({
  selectedLog,
  zoneName,
  activeEncounterId,
  activeEncounterTarget,
  recentEncounters = [],
  onSaved
}: QuickPlayerNoteProps) {
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [noteContext, setNoteContext] = useState<NoteContext>('auto')

  const selectedEncounter = useMemo(() => {
    if (noteContext === 'auto') {
      if (!activeEncounterId) return null
      return {
        id: activeEncounterId,
        target: activeEncounterTarget ?? 'active encounter',
        label: 'Current Fight'
      }
    }

    if (noteContext === 'session' || noteContext === 'general') return null
    return recentEncounters.find((encounter) => encounter.id === noteContext) ?? null
  }, [
    noteContext,
    activeEncounterId,
    activeEncounterTarget,
    recentEncounters
  ])

  const contextLabel = useMemo(() => {
    if (noteContext === 'auto') {
      return activeEncounterTarget
        ? `Current Fight · ${activeEncounterTarget}`
        : 'Session · no active fight'
    }
    if (noteContext === 'session') {
      return zoneName ? `Session · ${zoneName}` : 'Session'
    }
    if (noteContext === 'general') return 'General / Other'
    return selectedEncounter
      ? `Recent Fight · ${selectedEncounter.target}`
      : 'Recent Fight'
  }, [noteContext, activeEncounterTarget, selectedEncounter, zoneName])

  async function saveNote() {
    const trimmed = noteText.trim()
    if (!trimmed || !selectedLog || saving) return

    setSaving(true)
    setStatus('')

    const encounterSourceKey = selectedEncounter?.id
    const includeZone = noteContext !== 'general'

    try {
      const saved = await window.electronAPI.savePlayerNote({
        logFilePath: selectedLog,
        createdAt: new Date().toISOString(),
        zoneName: includeZone ? zoneName ?? undefined : undefined,
        noteText: trimmed,
        encounterSourceKey
      })

      setNoteText('')
      setStatus(
        selectedEncounter
          ? `Saved to: ${selectedEncounter.target}`
          : noteContext === 'general'
            ? 'Saved as general note'
            : 'Saved as session note'
      )
      onSaved(saved)
    } catch (error) {
      console.error('Unable to save player note:', error)
      setStatus('Note save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid #294b64',
        borderRadius: '12px',
        padding: '12px 16px',
        marginBottom: '14px'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          flexWrap: 'wrap'
        }}
      >
        <strong>📝 Quick Player Note</strong>
        <select
          value={noteContext}
          onChange={(event) => {
            setNoteContext(event.target.value)
            setStatus('')
          }}
          disabled={!selectedLog || saving}
          title="Attach this note to the current fight, a recent fight, or the session"
          style={{
            minWidth: '210px',
            padding: '7px 9px',
            borderRadius: '8px',
            border: '1px solid #365a73',
            background: '#081a28',
            color: 'inherit'
          }}
        >
          <option value="auto">
            {activeEncounterTarget
              ? `Current Fight · ${activeEncounterTarget}`
              : 'Auto · Session (no active fight)'}
          </option>
          {recentEncounters.map((encounter) => (
            <option key={encounter.id} value={encounter.id}>
              {encounter.label} · {encounter.target}
            </option>
          ))}
          <option value="session">Session / Current Zone</option>
          <option value="general">General / Other</option>
        </select>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: '8px',
          marginTop: '8px'
        }}
      >
        <input
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void saveNote()
            }
          }}
          placeholder="What just happened? Enter to save..."
          disabled={!selectedLog || saving}
          style={{
            minWidth: 0,
            padding: '9px 11px',
            borderRadius: '8px',
            border: '1px solid #365a73',
            background: '#081a28',
            color: 'inherit'
          }}
        />
        <button
          type="button"
          onClick={() => void saveNote()}
          disabled={!selectedLog || saving || !noteText.trim()}
        >
          {saving ? 'Saving…' : 'Save Note'}
        </button>
      </div>

      <div
        style={{
          marginTop: '5px',
          fontSize: '0.85em',
          opacity: 0.8
        }}
      >
        Attach to: {contextLabel}
        {status ? ` · ${status}` : ''}
      </div>
    </div>
  )
}

export const QuickPlayerNote = memo(QuickPlayerNoteComponent)
