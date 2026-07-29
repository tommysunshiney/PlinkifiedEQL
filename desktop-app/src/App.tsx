import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

import { EventType, parseLine } from './parser'

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

type DamageEvent = {
  timestamp: number
  damage: number
}

const FIGHT_TIMEOUT_MS = 8_000
const ROLLING_WINDOW_MS = 10_000

function getTimestamp(line: string): number | null {
  const timestampMatch = line.match(/^\[([^\]]+)\]/)

  if (!timestampMatch) {
    return null
  }

  const timestamp = Date.parse(timestampMatch[1])

  return Number.isNaN(timestamp) ? null : timestamp
}

function getPlayerDamage(line: string): number | null {
  /*
   * Examples:
   * You pierce a spider for 12 points of damage.
   * You hit a spider for 8 points of fire damage.
   */
  const directDamage = line.match(
    /\]\s+You .*? for (\d+) points?(?: of [a-z]+)? damage/i
  )

  if (directDamage) {
    return Number(directDamage[1])
  }

  /*
   * Example:
   * A spider has taken 2 damage from your Flame Lick.
   */
  const damageOverTime = line.match(
    /\]\s+.* has taken (\d+) damage from your /i
  )

  if (damageOverTime) {
    return Number(damageOverTime[1])
  }

  return null
}

function App() {
  const [selectedLog, setSelectedLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [clock, setClock] = useState(Date.now())

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
    const timer = window.setInterval(() => {
      setClock(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
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

  const playerDamageEvents = useMemo<DamageEvent[]>(() => {
    const events: DamageEvent[] = []

    for (const line of logLines) {
      const damage = getPlayerDamage(line)
      const timestamp = getTimestamp(line)

      if (damage !== null && timestamp !== null) {
        events.push({
          timestamp,
          damage
        })
      }
    }

    return events
  }, [logLines])

  const fightStats = useMemo(() => {
    if (playerDamageEvents.length === 0) {
      return {
        active: false,
        totalDamage: 0,
        fightDps: 0,
        rollingDps: 0,
        bestHit: 0,
        durationSeconds: 0
      }
    }

    /*
     * Work backward from the newest damage event.
     * A gap longer than eight seconds starts a new fight.
     */
    const currentFight: DamageEvent[] = [
      playerDamageEvents[playerDamageEvents.length - 1]
    ]

    for (let index = playerDamageEvents.length - 2; index >= 0; index -= 1) {
      const currentEvent = playerDamageEvents[index]
      const nextEvent = playerDamageEvents[index + 1]

      if (
        nextEvent.timestamp - currentEvent.timestamp >
        FIGHT_TIMEOUT_MS
      ) {
        break
      }

      currentFight.unshift(currentEvent)
    }

    const firstEvent = currentFight[0]
    const lastEvent = currentFight[currentFight.length - 1]

    const durationMilliseconds = Math.max(
      1000,
      lastEvent.timestamp - firstEvent.timestamp
    )

    const durationSeconds = durationMilliseconds / 1000

    const totalDamage = currentFight.reduce(
      (total, event) => total + event.damage,
      0
    )

    const rollingStart = lastEvent.timestamp - ROLLING_WINDOW_MS

    const rollingDamage = currentFight
      .filter((event) => event.timestamp >= rollingStart)
      .reduce((total, event) => total + event.damage, 0)

    const rollingDurationSeconds = Math.min(
      ROLLING_WINDOW_MS / 1000,
      durationSeconds
    )

    const active = clock - lastEvent.timestamp <= FIGHT_TIMEOUT_MS

    return {
      active,
      totalDamage,
      fightDps: totalDamage / durationSeconds,
      rollingDps: rollingDamage / Math.max(1, rollingDurationSeconds),
      bestHit: Math.max(...currentFight.map((event) => event.damage)),
      durationSeconds
    }
  }, [playerDamageEvents, clock])

  /*
   * Initial visual scale:
   * 50 DPS fills the whole bar.
   * We can make this adaptive later.
   */
  const dpsBarPercent = Math.min(
    100,
    Math.max(0, fightStats.rollingDps * 2)
  )

  async function handleSelectLog() {
    try {
      const filePath = await window.electronAPI.selectLogFile()

      if (!filePath) {
        return
      }

      const lines = await window.electronAPI.readLogFile(filePath)

      setSelectedLog(filePath)
      setLogLines(lines.slice(-500))

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

        <section className="dps-panel">
          <div className="dps-heading">
            <div>
              <span className="dps-label">CURRENT FIGHT</span>
              <strong className="dps-value">
                {fightStats.rollingDps.toFixed(1)}
                <small> DPS</small>
              </strong>
            </div>

            <span
              className={`fight-status ${
                fightStats.active ? 'fight-active' : ''
              }`}
            >
              {fightStats.active ? 'Fighting' : 'Waiting'}
            </span>
          </div>

          <div className="dps-bar-track">
            <div
              className="dps-bar-fill"
              style={{ width: `${dpsBarPercent}%` }}
            />
          </div>

          <div className="dps-breakdown">
            <div>
              <span>Fight DPS</span>
              <strong>{fightStats.fightDps.toFixed(1)}</strong>
            </div>

            <div>
              <span>Damage</span>
              <strong>{fightStats.totalDamage.toLocaleString()}</strong>
            </div>

            <div>
              <span>Best Hit</span>
              <strong>{fightStats.bestHit}</strong>
            </div>

            <div>
              <span>Duration</span>
              <strong>{fightStats.durationSeconds.toFixed(1)}s</strong>
            </div>
          </div>
        </section>

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