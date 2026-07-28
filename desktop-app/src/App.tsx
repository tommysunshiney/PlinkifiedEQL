import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { EventType, parseLine } from "./parser"

const categoryLabels: Record<EventType, string> = {
  xp: 'XP',
  loot: 'Loot',
  kill: 'Kills',
  death: 'Deaths',
  spell: 'Spells',
  combat: 'Combat',
  system: 'System',
  tell: 'Tells',
  other: 'Other'
}


function App() {
  const [selectedLog, setSelectedLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)

  const logOutputRef = useRef<HTMLDivElement>(null)

  const parsedEvents = useMemo(
  () => logLines.map((line) => parseLine(line)),
  [logLines]
 )

  useEffect(() => {
    window.electronAPI.onLogLines((newLines) => {
      setLogLines((currentLines) =>
        [...currentLines, ...newLines].slice(-500)
      )
    })
  }, [])

  useEffect(() => {
    const output = logOutputRef.current

    if (output) {
      output.scrollTop = output.scrollHeight
    }
  }, [logLines])

  const categoryCounts = useMemo(() => {
    const counts: Record<EventType, number> = {
      xp: 0,
      loot: 0,
      kill: 0,
      death: 0,
      spell: 0,
      combat: 0,
      system: 0,
      tell: 0,
      other: 0
    }

    for (const event of parsedEvents) {
  counts[event.type] += 1
    }

    return counts
  }, [parsedEvents])

  async function handleSelectLog() {
    try {
      const filePath = await window.electronAPI.selectLogFile()

      if (!filePath) {
        return
      }

      const lines = await window.electronAPI.readLogFile(filePath)

      setSelectedLog(filePath)
      setLogLines(lines)

      await window.electronAPI.startLogWatch(filePath)
      setIsConnected(true)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error)

      console.error(error)
      setSelectedLog(`Error: ${message}`)
      setIsConnected(false)
    }
  }

const visibleCategories: EventType[] = [
    'xp',
    'loot',
    'kill',
    'death',
    'spell',
    'combat',
    'system',
    'tell'
  ]

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">PLINKIFIED EQL</p>
          <h1>Command Center</h1>
        </div>

        <span className="version">v0.8a</span>
      </header>

      <section className="log-panel">
        <div className="panel-heading">
          <div>
            <h2>Live Log Monitor</h2>
            <p>Select your EverQuest Legacy log file to begin.</p>
          </div>

          <span className={`status-badge ${isConnected ? 'connected' : ''}`}>
            {isConnected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        <button className="select-button" onClick={handleSelectLog}>
          Select EQL Log File
        </button>

        <div className="selected-file">
          <strong>Selected file</strong>
          <span>{selectedLog || 'No log file selected.'}</span>
        </div>

        <div className="parser-summary">
          {visibleCategories.map((category) => (
            <div className="parser-stat" key={category}>
              <span>{categoryLabels[category]}</span>
              <strong>{categoryCounts[category]}</strong>
            </div>
          ))}
        </div>

        <div className="log-output" ref={logOutputRef}>
          {parsedEvents.length === 0 ? (
            <p>Parsed events will appear here.</p>
           ) : (
             parsedEvents.map((event, index) => (
               <div
                  className={`log-line event-${event.type}`}
                  key={`${index}-${event.text}`}
            >
             {event.text}
          </div>
              ))
            )}
        </div>
      </section>
    </main>
  )
}

export default App