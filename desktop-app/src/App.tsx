import { useState } from 'react'
import './App.css'

function App() {
  const [selectedLog, setSelectedLog] = useState<string>('')
  const [logLines, setLogLines] = useState<string[]>([])

async function handleSelectLog() {
  try {
    const filePath = await window.electronAPI.selectLogFile()

    if (!filePath) {
      return
    }

    setSelectedLog(filePath)

    const lines = await window.electronAPI.readLogFile(filePath)
    setLogLines(lines)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)

    console.error(error)
    setSelectedLog(`Error: ${message}`)
  }
}

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

          <span className="status-badge">Not Connected</span>
        </div>

        <button className="select-button" onClick={handleSelectLog}>
          Select EQL Log File
        </button>

        <div className="selected-file">
          <strong>Selected file</strong>
          <span>{selectedLog || 'No log file selected.'}</span>
        </div>

        <div className="log-output">
          {logLines.map((line, index) => (
            <div key={index}>{line}</div>
         ))}
        </div>  
      </section>
    </main>
  )
}

export default App