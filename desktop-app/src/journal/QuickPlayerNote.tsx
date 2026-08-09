import { memo, useState } from 'react'
import type { PlayerNoteRecord } from '../types/database'

type QuickPlayerNoteProps = {
  selectedLog: string
  zoneName: string | null
  activeEncounterId?: string
  activeEncounterTarget?: string
  onSaved: (note: PlayerNoteRecord) => void
}

function QuickPlayerNoteComponent({
  selectedLog,
  zoneName,
  activeEncounterId,
  activeEncounterTarget,
  onSaved
}: QuickPlayerNoteProps) {
  const [noteText, setNoteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  async function saveNote() {
    const trimmed = noteText.trim()
    if (!trimmed || !selectedLog || saving) return

    setSaving(true)
    setStatus('')

    try {
      const saved = await window.electronAPI.savePlayerNote({
        logFilePath: selectedLog,
        createdAt: new Date().toISOString(),
        zoneName: zoneName ?? undefined,
        noteText: trimmed,
        encounterSourceKey: activeEncounterId
      })

      setNoteText('')
      setStatus(
        activeEncounterTarget
          ? `Saved to active encounter: ${activeEncounterTarget}`
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
      <strong>📝 Quick Player Note</strong>
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
        {activeEncounterTarget
          ? `Active encounter: ${activeEncounterTarget}`
          : 'No active encounter — note will be session-level.'}
        {zoneName ? ` · ${zoneName}` : ''}
        {status ? ` · ${status}` : ''}
      </div>
    </div>
  )
}

export const QuickPlayerNote = memo(QuickPlayerNoteComponent)
