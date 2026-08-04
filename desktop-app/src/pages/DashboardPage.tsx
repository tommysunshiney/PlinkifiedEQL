import { useEffect, useMemo, useRef, useState } from 'react'
import '../App.css'
import { EventType, parseLine } from '../parser'
import { useSession } from '../session/SessionContext'
import autoAttackFartUrl from '../assets/auto-attack-fart.mp3'


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

const MAX_VISIBLE_LOG_LINES = 500
const ALARM_SOUND_DATA_KEY = 'peql:auto-attack-alarm-data'
const ALARM_SOUND_NAME_KEY = 'peql:auto-attack-alarm-name'

function isOwnSpellLine(line: string): boolean {
  return /\]\s+(?:You begin casting|You cast|Your .+ spell|You have finished memorizing|You have finished scribing|You forget )/i.test(line)
}

export default function DashboardPage() {
  const {
    selectedLog,
    logLines,
    sessionLines,
    fightState,
    isConnected,
    connectionError,
    selectLog,
    startNewSession,
    markOhShit
  } = useSession()

  const [selectedFightIndex, setSelectedFightIndex] =
    useState<number | null>(null)
  const [ohShitStatus, setOhShitStatus] =
    useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [ohShitToast, setOhShitToast] = useState('')
  const [alarmSoundUrl, setAlarmSoundUrl] = useState(
    () => localStorage.getItem(ALARM_SOUND_DATA_KEY) ?? autoAttackFartUrl
  )
  const [alarmSoundName, setAlarmSoundName] = useState(
    () => localStorage.getItem(ALARM_SOUND_NAME_KEY) ?? 'Fart Sounds.mp3'
  )

  const logOutputRef = useRef<HTMLDivElement>(null)
  const activeFightIdRef = useRef<string | null>(null)
  const ohShitResetTimerRef = useRef<number | null>(null)
  const autoAttackAudioRef = useRef<HTMLAudioElement | null>(null)
  const fartMarkerWrittenRef = useRef(false)
  const alarmSoundInputRef = useRef<HTMLInputElement>(null)

  /*
   * Parse the complete loaded log.
   *
   * We keep all lines for statistics, but only render the newest
   * 500 lines in the raw-log window.
   */
const parsedEvents = useMemo(
  () => sessionLines.map((line) => parseLine(line)),
  [sessionLines]
)

  useEffect(() => {
    return () => {
      if (ohShitResetTimerRef.current !== null) {
        window.clearTimeout(ohShitResetTimerRef.current)
      }
    }
  }, [])

  const handleSelectAlarmSound = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]

    if (!file) return

    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return

      setAlarmSoundUrl(reader.result)
      setAlarmSoundName(file.name)

      try {
        localStorage.setItem(ALARM_SOUND_DATA_KEY, reader.result)
        localStorage.setItem(ALARM_SOUND_NAME_KEY, file.name)
      } catch (error) {
        console.warn(
          'Alarm sound selected for this run but could not be saved:',
          error
        )
      }
    })

    reader.readAsDataURL(file)
    event.target.value = ''
  }

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

    counts.spell = sessionLines.filter(isOwnSpellLine).length

    return counts
  }, [parsedEvents, sessionLines])

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

  const fightHistory = fightState.fights
  const newestFight =
    fightState.currentFight ??
    fightHistory[fightHistory.length - 1] ??
    null

  /*
   * A genuinely new active fight automatically returns the panel
   * to Live. Additional hits in the same fight do not interrupt
   * the user while reviewing history.
   */
  useEffect(() => {
    const activeFightId =
      newestFight?.active ? newestFight.id : null

    if (
      activeFightId !== null &&
      activeFightIdRef.current !== activeFightId
    ) {
      activeFightIdRef.current = activeFightId
      setSelectedFightIndex(null)
    }

    if (activeFightId === null) {
      activeFightIdRef.current = null
    }
  }, [newestFight?.id, newestFight?.active])

  /*
   * Keep an old selection valid after changing logs or starting
   * a New Sesh.
   */
  useEffect(() => {
    if (
      selectedFightIndex !== null &&
      selectedFightIndex >= fightHistory.length
    ) {
      setSelectedFightIndex(null)
    }
  }, [fightHistory.length, selectedFightIndex])

  const displayedFight =
    selectedFightIndex === null
      ? newestFight
      : fightHistory[selectedFightIndex] ?? newestFight

  const displayedFightNumber =
    displayedFight === null
      ? 0
      : selectedFightIndex === null
        ? fightHistory.length
        : selectedFightIndex + 1

  const isViewingLive =
    selectedFightIndex === null

  const canGoOlder =
    fightHistory.length > 1 &&
    (
      selectedFightIndex === null ||
      selectedFightIndex > 0
    )

  const canGoNewer =
    selectedFightIndex !== null

  function handleOlderFight() {
    if (!canGoOlder) {
      return
    }

    setSelectedFightIndex((currentIndex) => {
      if (currentIndex === null) {
        return Math.max(0, fightHistory.length - 2)
      }

      return Math.max(0, currentIndex - 1)
    })
  }

  function handleNewerFight() {
    if (!canGoNewer) {
      return
    }

    setSelectedFightIndex((currentIndex) => {
      if (currentIndex === null) {
        return null
      }

      const newerIndex = currentIndex + 1

      return newerIndex >= fightHistory.length - 1
        ? null
        : newerIndex
    })
  }

  const displayedFightDps =
    displayedFight?.fightDps ?? 0

  /*
   * Live combat keeps the moving bar. Historical fights show the
   * final fight DPS so the bar remains stable while reviewing.
   */
  const dpsBarValue =
    displayedFight === null
      ? 0
      : isViewingLive && displayedFight.active
        ? displayedFight.displayDps
        : displayedFight.fightDps

  const dpsBarCeiling = Math.max(
    10,
    displayedFightDps * 1.75
  )

  const dpsBarPercent = Math.min(
    100,
    Math.max(
      0,
      (dpsBarValue / dpsBarCeiling) * 100
    )
  )

  async function handleSelectLog() {
    try {
      await selectLog()
      setSelectedFightIndex(null)
      activeFightIdRef.current = null
    } catch (error) {
      console.error(error)
      alert('Unable to connect to that log file.')
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
      await startNewSession()
      setSelectedFightIndex(null)
      activeFightIdRef.current = null
    } catch (error) {
      console.error(error)
      alert('Unable to create new session.')
    }
  }

  async function handleOhShit() {
    if (!selectedLog) {
      alert('Please select a log file first.')
      return
    }

    if (ohShitStatus === 'saving' || ohShitStatus === 'success') {
      return
    }

    if (ohShitResetTimerRef.current !== null) {
      window.clearTimeout(ohShitResetTimerRef.current)
    }

    setOhShitStatus('saving')
    setOhShitToast('Dropping combat bookmark...')

    try {
      const result =
        await markOhShit()

      const markerTime = result.marker.match(
        /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
      )?.[1]

      setOhShitStatus('success')
      setOhShitToast(
        markerTime
          ? `OH SHIT marker added · ${markerTime}`
          : 'OH SHIT marker added'
      )

      ohShitResetTimerRef.current = window.setTimeout(() => {
        setOhShitStatus('idle')
        setOhShitToast('')
        ohShitResetTimerRef.current = null
      }, 2200)
    } catch (error) {
      console.error(error)
      setOhShitStatus('error')
      setOhShitToast('OH SHIT marker failed')

      ohShitResetTimerRef.current = window.setTimeout(() => {
        setOhShitStatus('idle')
        setOhShitToast('')
        ohShitResetTimerRef.current = null
      }, 3000)
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

  const visibleParsedEvents = parsedEvents
    .filter((event) => !/\]\s+Auto attack is (?:on|off)\./i.test(event.text))
    .slice(-MAX_VISIBLE_LOG_LINES)

  const autoAttackWarning =
    fightState.combatState.autoAttackWarning

  useEffect(() => {
    if (!autoAttackWarning) {
      fartMarkerWrittenRef.current = false
      const audio = autoAttackAudioRef.current

      if (audio) {
        audio.pause()
        audio.currentTime = 0
      }

      return
    }

    if (selectedLog && !fartMarkerWrittenRef.current) {
      fartMarkerWrittenRef.current = true
      void window.electronAPI.markFart(selectedLog).catch((error) => {
        console.error('Auto-attack warning marker failed:', error)
      })
    }

    const audio = new Audio(alarmSoundUrl)
    audio.loop = true
    audio.volume = 1
    autoAttackAudioRef.current = audio

    void audio.play().catch((error) => {
      console.error('Auto-attack warning sound failed:', error)
    })

    return () => {
      audio.pause()
      audio.currentTime = 0

      if (autoAttackAudioRef.current === audio) {
        autoAttackAudioRef.current = null
      }
    }
  }, [alarmSoundUrl, autoAttackWarning, selectedLog])

  return (
    <div className="dashboard-page">


      <section className="log-panel">
        <div className="panel-heading">
          <div>
            <h2>Live Log Monitor</h2>
            <p>
              Select your EverQuest Legends log file to begin.
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

        {connectionError && (
          <div className="connection-warning">
            Last log reconnect failed: {connectionError}
          </div>
        )}

        {autoAttackWarning && (
          <div className="autoattack-warning" role="alert">
            ⚠ AUTO ATTACK IS NOT ON — SWING, PECK!
          </div>
        )}

<div
  style={{
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap'
  }}
>
  <button
    className="select-button"
    onClick={handleSelectLog}
  >
    Select EQL Log File
  </button>

  <input
    ref={alarmSoundInputRef}
    className="visually-hidden"
    type="file"
    accept="audio/*,.mp3,.wav,.ogg,.m4a"
    onChange={handleSelectAlarmSound}
  />

  <button
    className="select-button"
    onClick={() => alarmSoundInputRef.current?.click()}
    title={`Current alarm: ${alarmSoundName}`}
  >
    Alarm Sound
  </button>

  <button
    className="select-button"
    onClick={handleNewSession}
  >
    New Sesh
  </button>

  <button
    className={`oh-shit-button oh-shit-${ohShitStatus}`}
    onClick={handleOhShit}
    disabled={
      ohShitStatus === 'saving' ||
      ohShitStatus === 'success'
    }
    title="Drop a timestamped combat bookmark into the log"
  >
    {ohShitStatus === 'saving'
      ? 'MARKING...'
      : ohShitStatus === 'success'
        ? '✓ MARKED!'
        : ohShitStatus === 'error'
          ? '✕ TRY AGAIN'
          : 'OH SHIT!'}
  </button>
</div>

{ohShitToast && (
  <div
    className={`peql-toast toast-${ohShitStatus}`}
    role="status"
    aria-live="polite"
  >
    <strong>
      {ohShitStatus === 'success'
        ? '🚨 Combat bookmark recorded'
        : ohShitStatus === 'error'
          ? 'Marker failed'
          : 'Recording marker'}
    </strong>
    <span>{ohShitToast}</span>
  </div>
)}

<div className="selected-file-line">
  <strong>Log:</strong>
  <span title={selectedLog || undefined}>
    {selectedLog
      ? selectedLog.split(/[\\/]/).pop()
      : 'No log file selected.'}
  </span>
  <span className="log-line-counts">
    {logLines.length.toLocaleString()} total ·{' '}
    {sessionLines.length.toLocaleString()} this sesh
  </span>
  <span className="alarm-sound-name" title={alarmSoundName}>
    Alarm: {alarmSoundName}
  </span>
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '12px'
            }}
          >
            <button
              className="select-button"
              onClick={handleOlderFight}
              disabled={!canGoOlder}
              title="Previous fight"
              style={{
                minWidth: '44px',
                opacity: canGoOlder ? 1 : 0.45
              }}
            >
              ◀
            </button>

            <strong
              style={{
                textAlign: 'center',
                flex: 1
              }}
            >
              {fightHistory.length === 0
                ? 'No fights recorded'
                : isViewingLive
                  ? `Live · Fight ${displayedFightNumber} of ${fightHistory.length}`
                  : `Fight ${displayedFightNumber} of ${fightHistory.length}`}
            </strong>

            <button
              className="select-button"
              onClick={handleNewerFight}
              disabled={!canGoNewer}
              title="Next fight"
              style={{
                minWidth: '44px',
                opacity: canGoNewer ? 1 : 0.45
              }}
            >
              ▶
            </button>
          </div>

          <div className="dps-heading">
            <div>
              <span className="dps-label">
                {isViewingLive
                  ? 'CURRENT FIGHT'
                  : 'FIGHT HISTORY'}

                {displayedFight?.target && (
                  <strong className="fight-target">
                    {' '}
                    · {displayedFight.target}
                  </strong>
                )}
              </span>

              <strong className="dps-value">
                {displayedFightDps.toFixed(1)}
                <small> DPS</small>
              </strong>
            </div>

            <span
              className={`fight-status ${
                displayedFight?.active &&
                isViewingLive
                  ? 'fight-active'
                  : ''
              }`}
            >
              {displayedFight === null
                ? 'Waiting'
                : isViewingLive &&
                    displayedFight.active
                  ? 'Fighting'
                  : 'Completed'}
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
                {displayedFightDps.toFixed(1)}
              </strong>
            </div>

            <div>
              <span>Damage</span>
              <strong>
                {(displayedFight?.totalDamage ?? 0).toLocaleString()}
              </strong>
            </div>

            <div>
              <span>Best Hit</span>
              <strong>{displayedFight?.bestHit ?? 0}</strong>
            </div>

            <div>
              <span>Duration</span>
              <strong>
                {(displayedFight?.durationSeconds ?? 0).toFixed(1)}s
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
                className={`log-line event-${event.type} ${
                  event.text.includes('PEQL OH SHIT!')
                    ? 'oh-shit-log-marker'
                    : ''
                }`}
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
