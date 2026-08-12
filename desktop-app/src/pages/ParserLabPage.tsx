import { useMemo, useState } from 'react'
import { parseLine } from '../parser'
import { parseCombatLine } from '../fight-engine/parseCombatLine'
import '../App.css'

const examples = [
  '[Tue Aug 11 10:58:56 2026] You backstab a yun ghoul wizard for 1159 points of damage. (Slay Undead)',
  '[Tue Aug 11 10:59:44 2026] You slash a wan ghoul knight for 314 points of damage. (Slay Undead)',
  '[Tue Aug 11 11:01:18 2026] You slash a zol ghoul knight pet for 60 points of damage. (Riposte)',
  '[Mon Aug 10 07:51:34 2026] ice boned skeleton has been charmed.',
  '[Tue Aug 11 14:32:02 2026] Your Cajoling Whispers spell has worn off of a zol ghoul knight.',
  '[Tue Aug 11 11:05:09 2026] You slash a ghoul sentinel for 157 points of damage. (Riposte Critical)',
  '[Tue Aug 11 11:05:10 2026] You pierce a ghoul sentinel for 194 points of damage. (Finishing Blow)'
]

function combatLooking(line: string) {
  return /damage|hit|miss|slash|pierce|crush|bash|kick|backstab|reave|slay|charm|mesmer|interrupt|casting|auto attack/i.test(line)
}

export default function ParserLabPage() {
  const [raw, setRaw] = useState(examples[0])

  const result = useMemo(() => {
    const line = raw.trim()
    if (!line) return null
    const general = parseLine(line)
    const combat = parseCombatLine(line)
    return { general, combat, suspicious: !combat && combatLooking(line) }
  }, [raw])

  const entries = result?.combat
    ? Object.entries(result.combat).filter(([key]) => key !== 'timestamp')
    : []

  return (
    <div className="analytics-page">
      <div className="analytics-heading">
        <div>
          <span className="analytics-kicker">PEQL QA TOOL</span>
          <h2>Parser Lab</h2>
          <p>Paste one EQL log line and inspect exactly how PEQL understands it.</p>
        </div>
        <span className="analytics-version">1.0 RC</span>
      </div>

      <section className="analytics-card">
        <h3>Raw Log Line</h3>
        <textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={4}
          spellCheck={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            borderRadius: '8px',
            padding: '12px',
            background: '#081a28',
            color: 'inherit',
            border: '1px solid #365a73',
            fontFamily: 'monospace'
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
          {examples.map((example, index) => (
            <button
              key={index}
              className="select-button"
              type="button"
              onClick={() => setRaw(example)}
            >
              Example {index + 1}
            </button>
          ))}
        </div>
      </section>

      {result && (
        <>
          <div className="analytics-summary-grid">
            <div className="analytics-stat">
              <span>General Category</span>
              <strong>{result.general.type}</strong>
            </div>
            <div className="analytics-stat">
              <span>Fight Engine</span>
              <strong>{result.combat ? 'Recognized' : 'No event'}</strong>
            </div>
            <div className="analytics-stat">
              <span>Combat Event</span>
              <strong>{result.combat?.kind ?? '—'}</strong>
            </div>
          </div>

          {result.suspicious && (
            <div className="connection-warning">
              ⚠ Combat-looking line was not recognized by the Fight Engine. This is a Parser Lab audit candidate.
            </div>
          )}

          <div className="analytics-columns">
            <section className="analytics-card">
              <h3>Structured Interpretation</h3>
              {result.combat ? (
                <div className="analytics-source-list">
                  {entries.map(([key, value]) => (
                    <div className="analytics-source-row" key={key}>
                      <strong>{key}</strong>
                      <span style={{ textAlign: 'right' }}>
                        {value === null ? 'null' : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ opacity: 0.72 }}>No Fight Engine event produced.</p>
              )}
            </section>

            <section className="analytics-card">
              <h3>Raw Event JSON</h3>
              <pre style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                margin: 0,
                fontSize: '0.85em',
                opacity: 0.88
              }}>
                {result.combat ? JSON.stringify(result.combat, null, 2) : 'null'}
              </pre>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
