import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChangeEvent } from 'react'
import '../App.css'
import { EventType, parseLine } from '../parser'
import { useSession } from '../session/SessionContext'
import { QuickPlayerNote } from '../journal/QuickPlayerNote'
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
const ALARM_ENABLED_KEY = 'peql:auto-attack-alarm-enabled'

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

  const [selectedFightIndex, setSelectedFightIndex] = useState<number | null>(null)
  const [ohShitStatus, setOhShitStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [ohShitToast, setOhShitToast] = useState('')
  const [alarmSoundUrl, setAlarmSoundUrl] = useState(
    () => localStorage.getItem(ALARM_SOUND_DATA_KEY) ?? autoAttackFartUrl
  )
  const [alarmSoundName, setAlarmSoundName] = useState(
    () => localStorage.getItem(ALARM_SOUND_NAME_KEY) ?? 'Fart Sounds.mp3'
  )
  const [alarmEnabled, setAlarmEnabled] = useState(
    () => localStorage.getItem(ALARM_ENABLED_KEY) !== 'false'
  )

  const logOutputRef = useRef<HTMLDivElement>(null)
  const activeFightIdRef = useRef<string | null>(null)
  const ohShitResetTimerRef = useRef<number | null>(null)
  const autoAttackAudioRef = useRef<HTMLAudioElement | null>(null)
  const fartMarkerWrittenRef = useRef(false)
  const alarmSoundInputRef = useRef<HTMLInputElement>(null)

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

  function handleSelectAlarmSound(event: ChangeEvent<HTMLInputElement>) {
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
        console.warn('Alarm sound selected for this run but could not be saved:', error)
      }
    })
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  function toggleAlarm() {
    setAlarmEnabled((enabled) => {
      const next = !enabled
      localStorage.setItem(ALARM_ENABLED_KEY, String(next))
      return next
    })
  }

  useEffect(() => {
    const output = logOutputRef.current
    if (output) output.scrollTop = output.scrollHeight
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

    for (const event of parsedEvents) counts[event.type] += 1
    counts.spell = sessionLines.filter(isOwnSpellLine).length
    return counts
  }, [parsedEvents, sessionLines])

  const levelsEarned = useMemo(
    () => sessionLines.filter((line) =>
      /You have gained a level! Welcome to level \d+!/i.test(line)
    ).length,
    [sessionLines]
  )
  const latestZoneName = useMemo(() => {
    for (let index = sessionLines.length - 1; index >= 0; index -= 1) {
      const line = sessionLines[index]
      const match =
        line.match(/\]\s+You have entered (.+?) \d+ \(.+?\)\.?$/i) ??
        line.match(/\]\s+You have entered (.+?) - Solo\.?$/i) ??
        line.match(/\]\s+You have entered (.+?)\.?$/i)

      if (match) return match[1].trim().replace(/\.$/, '')
    }

    return null
  }, [sessionLines])

  const fightHistory = fightState.fights
  const newestFight = fightState.currentFight ?? fightHistory[fightHistory.length - 1] ?? null

  useEffect(() => {
    const activeFightId = newestFight?.active ? newestFight.id : null
    if (activeFightId !== null && activeFightIdRef.current !== activeFightId) {
      activeFightIdRef.current = activeFightId
      setSelectedFightIndex(null)
    }
    if (activeFightId === null) activeFightIdRef.current = null
  }, [newestFight?.id, newestFight?.active])

  useEffect(() => {
    if (selectedFightIndex !== null && selectedFightIndex >= fightHistory.length) {
      setSelectedFightIndex(null)
    }
  }, [fightHistory.length, selectedFightIndex])

  const displayedFight = selectedFightIndex === null
    ? newestFight
    : fightHistory[selectedFightIndex] ?? newestFight

  const displayedFightNumber = displayedFight === null
    ? 0
    : selectedFightIndex === null
      ? fightHistory.length
      : selectedFightIndex + 1

  const isViewingLive = selectedFightIndex === null
  const canGoOlder = fightHistory.length > 1 &&
    (selectedFightIndex === null || selectedFightIndex > 0)
  const canGoNewer = selectedFightIndex !== null

  function handleOlderFight() {
    if (!canGoOlder) return
    setSelectedFightIndex((currentIndex) => {
      if (currentIndex === null) return Math.max(0, fightHistory.length - 2)
      return Math.max(0, currentIndex - 1)
    })
  }

  function handleNewerFight() {
    if (!canGoNewer) return
    setSelectedFightIndex((currentIndex) => {
      if (currentIndex === null) return null
      const newerIndex = currentIndex + 1
      return newerIndex >= fightHistory.length - 1 ? null : newerIndex
    })
  }

  const displayedFightDps = displayedFight?.fightDps ?? 0
  const dpsBarValue = displayedFight === null
    ? 0
    : isViewingLive && displayedFight.active
      ? displayedFight.displayDps
      : displayedFight.fightDps
  const dpsBarCeiling = Math.max(10, displayedFightDps * 1.75)
  const dpsBarPercent = Math.min(100, Math.max(0, (dpsBarValue / dpsBarCeiling) * 100))

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
    if (!window.confirm('Start a New Sesh?\n\nCurrent session statistics will reset.')) return

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
    if (ohShitStatus === 'saving' || ohShitStatus === 'success') return

    if (ohShitResetTimerRef.current !== null) {
      window.clearTimeout(ohShitResetTimerRef.current)
    }

    setOhShitStatus('saving')
    setOhShitToast('Dropping combat bookmark...')

    try {
      const result = await markOhShit()
      const markerTime = result.marker.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)?.[1]
      setOhShitStatus('success')
      setOhShitToast(markerTime ? `OH SHIT marker added Â· ${markerTime}` : 'OH SHIT marker added')
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
    'xp', 'loot', 'kill', 'death', 'spell', 'combat', 'system', 'tell'
  ]
  const visibleParsedEvents = parsedEvents
    .filter((event) => !/\]\s+Auto attack is (?:on|off)\./i.test(event.text))
    .slice(-MAX_VISIBLE_LOG_LINES)

  const engineAutoAttackWarning = fightState.combatState.autoAttackWarning
  const autoAttackWarning = alarmEnabled && engineAutoAttackWarning

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
      if (autoAttackAudioRef.current === audio) autoAttackAudioRef.current = null
    }
  }, [alarmSoundUrl, autoAttackWarning, selectedLog])

  const petCombatants = displayedFight?.combatants.filter((combatant) => combatant.type === 'pet') ?? []
  const petLabel = petCombatants.length === 1 ? petCombatants[0].name : 'Pet(s)'

  return (
    <div className="dashboard-page">
      <section className="log-panel">
        <div className="panel-heading">
          <div>
            <h2>Live Log Monitor</h2>
            <p>Select your EverQuest Legends log file to begin.</p>
          </div>
          <span className={`status-badge ${isConnected ? 'connected' : ''}`}>
            {isConnected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        {connectionError && (
          <div className="connection-warning">
            Last log reconnect failed: {connectionError}
          </div>
        )}

        {autoAttackWarning && (
          <div className="autoattack-warning" role="alert">
            âš  AUTO ATTACK IS NOT ON â€” SWING, PECK!
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button className="select-button" onClick={handleSelectLog}>
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
            onClick={toggleAlarm}
            aria-pressed={alarmEnabled}
            title="Turn the Swing / Auto Attack alarm on or off"
            style={{
              background: alarmEnabled ? '#2d78b7' : '#4a5360'
            }}
          >
            Swing Alarm: {alarmEnabled ? 'ON' : 'OFF'}
          </button>

          <button className="select-button" onClick={handleNewSession}>
            New Sesh
          </button>

          <button
            className={`oh-shit-button oh-shit-${ohShitStatus}`}
            onClick={handleOhShit}
            disabled={ohShitStatus === 'saving' || ohShitStatus === 'success'}
            title="Drop a timestamped combat bookmark into the log"
          >
            {ohShitStatus === 'saving'
              ? 'MARKING...'
              : ohShitStatus === 'success'
                ? 'âœ“ MARKED!'
                : ohShitStatus === 'error'
                  ? 'âœ• TRY AGAIN'
                  : 'OH SHIT!'}
          </button>
        </div>

        {ohShitToast && (
          <div className={`peql-toast toast-${ohShitStatus}`} role="status" aria-live="polite">
            <strong>
              {ohShitStatus === 'success'
                ? 'ðŸš¨ Combat bookmark recorded'
                : ohShitStatus === 'error'
                  ? 'Marker failed'
                  : 'Recording marker'}
            </strong>
            <span>{ohShitToast}</span>
          </div>
        )}

        <QuickPlayerNote
          selectedLog={selectedLog}
          zoneName={latestZoneName}
          activeEncounterId={fightState.currentFight?.id}
          activeEncounterTarget={fightState.currentFight?.target}
          onSaved={() => {
            // Adventure Journal reads persisted notes from SQLite.
          }}
        />
        <div className="selected-file-line">
          <strong>Log:</strong>
          <span title={selectedLog || undefined}>
            {selectedLog ? selectedLog.split(/[\\/]/).pop() : 'No log file selected.'}
          </span>
          <span className="log-line-counts">
            {logLines.length.toLocaleString()} total Â· {sessionLines.length.toLocaleString()} this sesh
          </span>
          <span className="alarm-sound-name" title={alarmSoundName}>
            Alarm: {alarmEnabled ? alarmSoundName : 'OFF'}
          </span>
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
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '12px', marginBottom: '12px'
          }}>
            <button
              className="select-button"
              onClick={handleOlderFight}
              disabled={!canGoOlder}
              title="Previous fight"
              style={{ minWidth: '44px', opacity: canGoOlder ? 1 : 0.45 }}
            >â—€</button>

            <strong style={{ textAlign: 'center', flex: 1 }}>
              {fightHistory.length === 0
                ? 'No fights recorded'
                : isViewingLive
                  ? `Live Â· Fight ${displayedFightNumber} of ${fightHistory.length}`
                  : `Fight ${displayedFightNumber} of ${fightHistory.length}`}
            </strong>

            <button
              className="select-button"
              onClick={handleNewerFight}
              disabled={!canGoNewer}
              title="Next fight"
              style={{ minWidth: '44px', opacity: canGoNewer ? 1 : 0.45 }}
            >â–¶</button>
          </div>

          <div className="dps-heading">
            <div>
              <span className="dps-label">
                {isViewingLive ? 'CURRENT FIGHT' : 'FIGHT HISTORY'}
                {displayedFight?.target && (
                  <strong className="fight-target"> Â· {displayedFight.target}</strong>
                )}
              </span>
              <strong className="dps-value">
                {displayedFightDps.toFixed(1)}<small> DPS</small>
              </strong>
            </div>

            <span className={`fight-status ${displayedFight?.active && isViewingLive ? 'fight-active' : ''}`}>
              {displayedFight === null
                ? 'Waiting'
                : isViewingLive && displayedFight.active
                  ? 'Fighting'
                  : 'Completed'}
            </span>
          </div>

          <div className="dps-bar-track">
            <div className="dps-bar-fill" style={{ width: `${dpsBarPercent}%` }} />
          </div>

          <div className="dps-breakdown">
            <div><span>Total DPS</span><strong>{displayedFightDps.toFixed(1)}</strong></div>
            <div><span>Total Damage</span><strong>{(displayedFight?.totalDamage ?? 0).toLocaleString()}</strong></div>
            <div><span>Your Damage</span><strong>{(displayedFight?.playerDamage ?? 0).toLocaleString()}</strong></div>
            <div><span>{petLabel}</span><strong>{(displayedFight?.petDamage ?? 0).toLocaleString()}</strong></div>
            <div><span>Best Hit</span><strong>{displayedFight?.bestHit ?? 0}</strong></div>
            <div><span>Duration</span><strong>{(displayedFight?.durationSeconds ?? 0).toFixed(1)}s</strong></div>
            <div><span>Levels Earned</span><strong>{levelsEarned}</strong></div>
          </div>
        </section>

        <div className="log-output" ref={logOutputRef}>
          {visibleParsedEvents.length === 0 ? (
            <p>Parsed events will appear here.</p>
          ) : (
            visibleParsedEvents.map((event, index) => (
              <div
                className={`log-line event-${event.type} ${
                  event.text.includes('PEQL OH SHIT!') ? 'oh-shit-log-marker' : ''
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

