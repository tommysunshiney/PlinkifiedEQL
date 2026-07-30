import { useEffect, useMemo, useRef, useState } from 'react'
import '../App.css'
import { EventType, parseLine } from '../parser'


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
  target: string
}

type DamageResult = {
  damage: number
  target: string
}

const FIGHT_TIMEOUT_MS = 8_000
const ROLLING_WINDOW_MS = 10_000
const MAX_VISIBLE_LOG_LINES = 500
const SESSION_MARKER = '===== PEQL SESSION START'

function getTimestamp(line: string): number | null {
  const timestampMatch = line.match(/^\[([^\]]+)\]/)

  if (!timestampMatch) {
    return null
  }

  const timestamp = Date.parse(timestampMatch[1])

  return Number.isNaN(timestamp) ? null : timestamp
}

function getPlayerDamage(line: string): DamageResult | null {
  /*
   * Player melee and direct attacks.
   *
   * Examples:
   * You slash a skeletal excavator for 28 points of damage.
   * You backstab skeleton L`rodd for 76 points of damage.
   * You reave a large plague rat for 48 points of damage.
   * You hit a lesser mummy for 12 points of damage.
   */
  const directDamage = line.match(
    /\]\s+You\s+(?:hit|slash|pierce|crush|punch|kick|bash|cleave|backstab|reave|maul|bite|claw|strike)\s+(.+?)\s+for\s+(\d+)\s+points?(?:\s+of\s+[\w-]+)?\s+damage/i
  )

  if (directDamage) {
    return {
      target: directDamage[1].trim(),
      damage: Number(directDamage[2])
    }
  }

  /*
   * Player spell damage.
   *
   * Example:
   * You hit a skeletal excavator for 46 points of magic damage
   * by Reaving Strike.
   */
  const spellDamage = line.match(
    /\]\s+You hit\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+[\w-]+\s+damage\s+by\s+/i
  )

  if (spellDamage) {
    return {
      target: spellDamage[1].trim(),
      damage: Number(spellDamage[2])
    }
  }

  /*
   * Player damage-over-time effects.
   *
   * Example:
   * A skeletal excavator has taken 31 damage from your
   * Stinging Swarm.
   */
  const damageOverTime = line.match(
    /\]\s+(.+?)\s+has taken\s+(\d+)\s+damage from your\s+/i
  )

  if (damageOverTime) {
    return {
      target: damageOverTime[1].trim(),
      damage: Number(damageOverTime[2])
    }
  }

  /*
   * Player damage-shield damage.
   *
   * Example:
   * Skeleton L`rodd is pierced by YOUR thorns for 7 points
   * of non-melee damage.
   */
  const thornDamage = line.match(
    /\]\s+(.+?)\s+is pierced by YOUR thorns for\s+(\d+)\s+points?\s+of non-melee damage/i
  )

  if (thornDamage) {
    return {
      target: thornDamage[1].trim(),
      damage: Number(thornDamage[2])
    }
  }

  return null
}

export default function DashboardPage() {
  const [selectedLog, setSelectedLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [clock, setClock] = useState(Date.now())

  const logOutputRef = useRef<HTMLDivElement>(null)

  /*
   * Parse the complete loaded log.
   *
   * We keep all lines for statistics, but only render the newest
   * 500 lines in the raw-log window.
   */
const sessionLines = useMemo(() => {
  let latestMarkerIndex = -1

  for (let index = logLines.length - 1; index >= 0; index -= 1) {
    if (logLines[index].includes(SESSION_MARKER)) {
      latestMarkerIndex = index
      break
    }
  }

  return latestMarkerIndex >= 0
    ? logLines.slice(latestMarkerIndex + 1)
    : logLines
}, [logLines])

const parsedEvents = useMemo(
  () => sessionLines.map((line) => parseLine(line)),
  [sessionLines]
)

  /*
   * Receive new lines from Electron without deleting older lines.
   *
   * Previously, slice(-500) here caused all displayed statistics
   * to represent only the newest 500 lines instead of the complete
   * selected log.
   */
  useEffect(() => {
    window.electronAPI.onLogLines((newLines) => {
      setLogLines((currentLines) => [
        ...currentLines,
        ...newLines
      ])
    })
  }, [])

  /*
   * Update once per second so fight duration and DPS decay continue
   * moving even when no new log line arrives.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now())
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  /*
   * Keep the raw-log display scrolled to the newest visible event.
   */
  useEffect(() => {
    const output = logOutputRef.current

    if (output) {
      output.scrollTop = output.scrollHeight
    }
  }, [logLines])

  /*
   * Parser-category counts for the complete selected log.
   *
   * We will tighten the individual category rules in parser.ts next.
   */
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

  /*
   * Count explicit character-level gains.
   *
   * Example:
   * You have gained a level! Welcome to level 15!
   */
  const levelsEarned = useMemo(() => {
    return sessionLines.filter((line) =>
      /You have gained a level! Welcome to level \d+!/i.test(line)
    ).length
  }, [sessionLines])

  /*
   * Convert recognized player-damage lines into structured events.
   */
  const playerDamageEvents = useMemo<DamageEvent[]>(() => {
    const events: DamageEvent[] = []

   for (const line of sessionLines) {
      const damageResult = getPlayerDamage(line)
      const timestamp = getTimestamp(line)

      if (damageResult !== null && timestamp !== null) {
        events.push({
          timestamp,
          damage: damageResult.damage,
          target: damageResult.target
        })
      }
    }

    return events
  }, [sessionLines])

  /*
   * Build the current fight by walking backward through the damage
   * events until an eight-second gap is found.
   */
  const fightStats = useMemo(() => {
    if (playerDamageEvents.length === 0) {
      return {
        active: false,
        target: '',
        totalDamage: 0,
        fightDps: 0,
        rollingDps: 0,
        displayDps: 0,
        bestHit: 0,
        durationSeconds: 0
      }
    }

    const newestDamageEvent =
      playerDamageEvents[playerDamageEvents.length - 1]

    const currentFight: DamageEvent[] = [newestDamageEvent]

    for (
      let index = playerDamageEvents.length - 2;
      index >= 0;
      index -= 1
    ) {
      const currentEvent = playerDamageEvents[index]
      const nextEvent = playerDamageEvents[index + 1]

const gapMilliseconds =
  nextEvent.timestamp - currentEvent.timestamp

const targetChanged =
  currentEvent.target.toLowerCase() !==
  newestDamageEvent.target.toLowerCase()

if (
  gapMilliseconds > FIGHT_TIMEOUT_MS ||
  targetChanged
) {
  break
}

currentFight.unshift(currentEvent)
    }

    const firstEvent = currentFight[0]
    const lastEvent = currentFight[currentFight.length - 1]

    const fightDurationMilliseconds = Math.max(
      1000,
      lastEvent.timestamp - firstEvent.timestamp
    )

    const durationSeconds =
      fightDurationMilliseconds / 1000

    const totalDamage = currentFight.reduce(
      (total, event) => total + event.damage,
      0
    )

    /*
     * Use the live clock for the rolling window.
     *
     * This lets recent damage naturally fall out of the window,
     * causing the displayed DPS to move downward instead of
     * remaining frozen at its previous value.
     */
    const rollingStart = clock - ROLLING_WINDOW_MS

    const rollingEvents = currentFight.filter(
      (event) => event.timestamp >= rollingStart
    )

    const rollingDamage = rollingEvents.reduce(
      (total, event) => total + event.damage,
      0
    )

    const rollingDps =
      rollingDamage / (ROLLING_WINDOW_MS / 1000)

    const timeSinceLastDamage = Math.max(
      0,
      clock - lastEvent.timestamp
    )

    const active =
      timeSinceLastDamage <= FIGHT_TIMEOUT_MS

    /*
     * Add a smooth decay during the eight-second fight timeout.
     *
     * The display reaches zero when the fight becomes inactive.
     */
    const decayMultiplier = active
      ? Math.max(
          0,
          1 - timeSinceLastDamage / FIGHT_TIMEOUT_MS
        )
      : 0

    const displayDps = rollingDps * decayMultiplier

    return {
      active,
      target: lastEvent.target,
      totalDamage,
      fightDps: totalDamage / durationSeconds,
      rollingDps,
      displayDps,
      bestHit: Math.max(
        ...currentFight.map((event) => event.damage)
      ),
      durationSeconds
    }
  }, [playerDamageEvents, clock])

  /*
   * Adaptive DPS-bar scale.
   *
   * Sustained fight DPS should sit around the middle of the bar,
   * while short bursts can push it toward full.
   */
  const dpsBarCeiling = Math.max(
    10,
    fightStats.fightDps * 1.75
  )

  const dpsBarPercent = Math.min(
    100,
    Math.max(
      0,
      (fightStats.displayDps / dpsBarCeiling) * 100
    )
  )

  async function handleSelectLog() {
    try {
      const filePath =
        await window.electronAPI.selectLogFile()

      if (!filePath) {
        return
      }

      const lines =
        await window.electronAPI.readLogFile(filePath)

      setSelectedLog(filePath)

      /*
       * Keep the complete log for accurate totals.
       */
      setLogLines(lines)

      await window.electronAPI.startLogWatch(filePath)

      setIsConnected(true)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error)

      console.error(error)
      setSelectedLog(`Error: ${message}`)
      setIsConnected(false)
    }
  }

  async function handleNewSession() {
  if (!selectedLog) {
    alert('Please select a log file first.')
    return
  }

  const confirmed = window.confirm(
    'Start a New Sesh?\n\nCurrent session statistics will reset.'
  )

  if (!confirmed) {
    return
  }

  try {
    await window.electronAPI.startNewSession(selectedLog)

    const lines =
      await window.electronAPI.readLogFile(selectedLog)

    setLogLines(lines)
  } catch (error) {
    console.error(error)
    alert('Unable to create new session.')
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

  const visibleParsedEvents = parsedEvents.slice(
    -MAX_VISIBLE_LOG_LINES
  )

  return (
    <div className="dashboard-page">


      <section className="log-panel">
        <div className="panel-heading">
          <div>
            <h2>Live Log Monitor</h2>
            <p>
              Select your EverQuest Legacy log file to begin.
            </p>
          </div>

          <span
            className={`status-badge ${
              isConnected ? 'connected' : ''
            }`}
          >
            {isConnected
              ? 'Connected'
              : 'Not Connected'}
          </span>
        </div>

<div
  style={{
    display: 'flex',
    gap: '10px'
  }}
>
  <button
    className="select-button"
    onClick={handleSelectLog}
  >
    Select EQL Log File
  </button>

  <button
    className="select-button"
    onClick={handleNewSession}
  >
    New Sesh
  </button>
</div>

<div className="selected-file">
  <strong>Selected file</strong>
  <span>{selectedLog || 'No log file selected.'}</span>
  <span><p>Total Log Lines: {logLines.length.toLocaleString()}</p></span>
</div>

        <div className="parser-summary">
          {visibleCategories.map((category) => (
            <div
              className="parser-stat"
              key={category}
            >
              <span>{categoryLabels[category]}</span>
              <strong>{categoryCounts[category]}</strong>
            </div>
          ))}
        </div>

        <section className="dps-panel">
          <div className="dps-heading">
            <div>
              <span className="dps-label">
                CURRENT FIGHT
                {fightStats.target && (
                  <strong className="fight-target">
                    {' '}
                    · {fightStats.target}
                  </strong>
                )}
              </span>

              <strong className="dps-value">
                {fightStats.displayDps.toFixed(1)}
                <small> DPS</small>
              </strong>
            </div>

            <span
              className={`fight-status ${
                fightStats.active
                  ? 'fight-active'
                  : ''
              }`}
            >
              {fightStats.active
                ? 'Fighting'
                : 'Waiting'}
            </span>
          </div>

          <div className="dps-bar-track">
            <div
              className="dps-bar-fill"
              style={{
                width: `${dpsBarPercent}%`
              }}
            />
          </div>

          <div className="dps-breakdown">
            <div>
              <span>Fight DPS</span>
              <strong>
                {fightStats.fightDps.toFixed(1)}
              </strong>
            </div>

            <div>
              <span>Damage</span>
              <strong>
                {fightStats.totalDamage.toLocaleString()}
              </strong>
            </div>

            <div>
              <span>Best Hit</span>
              <strong>{fightStats.bestHit}</strong>
            </div>

            <div>
              <span>Duration</span>
              <strong>
                {fightStats.durationSeconds.toFixed(1)}s
              </strong>
            </div>

            <div>
              <span>Levels Earned</span>
              <strong>{levelsEarned}</strong>
            </div>
          </div>
        </section>

        <div
          className="log-output"
          ref={logOutputRef}
        >
          {visibleParsedEvents.length === 0 ? (
            <p>Parsed events will appear here.</p>
          ) : (
            visibleParsedEvents.map((event, index) => (
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
    </div>
  )
}
