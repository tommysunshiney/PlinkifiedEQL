import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import '../App.css'
import { EventType, parseLine } from '../parser'
import { useSession } from '../session/SessionContext'
import { QuickPlayerNote } from '../journal/QuickPlayerNote'
import type { NoteEncounterOption } from '../journal/QuickPlayerNote'
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

const DASH_TRIGGERED=new Set(['ykesha','blood siphon strike','blood draw strike','asp venom strike','cobra venom strike','weakening strike','hobbling strike','befuddling strike','concussive strike','clumsiness strike','banishing strike'])
const DASH_SPECIAL=new Set(['backstab','bash','kick','reave','slam','frenzy','gore','smash','rend','sting','maul','bite','claw'])
function dashboardAbilityCategory(a:{ability:string;source:string;actorType:string}){const n=a.ability.trim().toLowerCase();if(a.actorType==='pet')return'Pet';if(DASH_TRIGGERED.has(n))return'Triggered';if(a.source==='melee'&&DASH_SPECIAL.has(n))return'Special';if(a.source==='melee')return'Melee';if(a.source==='dot')return'DoT';if(a.source==='damage-shield')return'Damage Shield';return'Spell / Effect'}

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
  const [isSelectingLog, setIsSelectingLog] = useState(false)
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
  const [lastEqlInputActivityAt, setLastEqlInputActivityAt] = useState(0)

  const logOutputRef = useRef<HTMLDivElement>(null)
  const selectingLogRef = useRef(false)
  const activeFightIdRef = useRef<string | null>(null)
  const ohShitResetTimerRef = useRef<number | null>(null)
  const autoAttackAudioRef = useRef<HTMLAudioElement | null>(null)
  const alarmRetryTimerRef = useRef<number | null>(null)
  const alarmTestTimerRef = useRef<number | null>(null)
  const fartMarkerWrittenRef = useRef(false)

  const visibleParsedEvents = useMemo(
    () =>
      sessionLines
        .slice(-MAX_VISIBLE_LOG_LINES)
        .map((line) => parseLine(line))
        .filter(
          (event) =>
            !/\]\s+Auto attack is (?:on|off)\./i.test(event.text)
        ),
    [sessionLines]
  )

  useEffect(() => {
    window.electronAPI.onEqlInputActivity((timestamp) => {
      setLastEqlInputActivityAt(timestamp)
    })
  }, [])

  useEffect(() => {
    return () => {
      if (ohShitResetTimerRef.current !== null) {
        window.clearTimeout(ohShitResetTimerRef.current)
      }
      if (alarmRetryTimerRef.current !== null) {
        window.clearTimeout(alarmRetryTimerRef.current)
      }
      if (alarmTestTimerRef.current !== null) {
        window.clearTimeout(alarmTestTimerRef.current)
      }
    }
  }, [])

  async function handleSelectAlarmSound() {
    try {
      const selected = await window.electronAPI.selectAlarmSound()
      if (!selected) return

      setAlarmSoundUrl(selected.dataUrl)
      setAlarmSoundName(selected.name)

      try {
        localStorage.setItem(ALARM_SOUND_DATA_KEY, selected.dataUrl)
        localStorage.setItem(ALARM_SOUND_NAME_KEY, selected.name)
      } catch (error) {
        console.warn(
          'Alarm sound selected for this run but could not be saved:',
          error
        )
      }
    } catch (error) {
      console.error('Unable to select alarm sound:', error)
    }
  }

  useEffect(() => {
    const previous = autoAttackAudioRef.current
    if (previous) {
      previous.pause()
      previous.currentTime = 0
    }

    const audio = new Audio(alarmSoundUrl)
    audio.preload = 'auto'
    audio.loop = true
    audio.volume = 1
    audio.load()
    autoAttackAudioRef.current = audio

    return () => {
      audio.pause()
      audio.currentTime = 0
      if (autoAttackAudioRef.current === audio) {
        autoAttackAudioRef.current = null
      }
    }
  }, [alarmSoundUrl])

  function handleTestAlarmSound() {
    const audio = autoAttackAudioRef.current
    if (!audio) return

    if (alarmTestTimerRef.current !== null) {
      window.clearTimeout(alarmTestTimerRef.current)
    }

    audio.pause()
    audio.currentTime = 0

    void audio.play().catch((error) => {
      console.error('Alarm sound test failed:', error)
    })

    alarmTestTimerRef.current = window.setTimeout(() => {
      if (!fightState.combatState.autoAttackWarning) {
        audio.pause()
        audio.currentTime = 0
      }
      alarmTestTimerRef.current = null
    }, 2200)
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

  const emptyCategoryCounts = (): Record<EventType, number> => ({
    xp: 0,
    loot: 0,
    kill: 0,
    death: 0,
    spell: 0,
    combat: 0,
    system: 0,
    tell: 0,
    other: 0
  })

  const [categoryCounts, setCategoryCounts] = useState<Record<EventType, number>>(
    () => emptyCategoryCounts()
  )
  const countedSessionLengthRef = useRef(0)

  useEffect(() => {
    const previousLength = countedSessionLengthRef.current
    const mustRebuild =
      previousLength === 0 ||
      sessionLines.length < previousLength

    const startIndex = mustRebuild ? 0 : previousLength
    const additions = sessionLines.slice(startIndex)

    if (additions.length === 0 && !mustRebuild) return

    setCategoryCounts((current) => {
      const next = mustRebuild
        ? emptyCategoryCounts()
        : { ...current }

      for (const line of additions) {
        const event = parseLine(line)
        next[event.type] += 1
      }

      next.spell = mustRebuild
        ? sessionLines.filter(isOwnSpellLine).length
        : next.spell + additions.filter(isOwnSpellLine).length

      return next
    })

    countedSessionLengthRef.current = sessionLines.length
  }, [sessionLines])

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

  const noteEncounterOptions = useMemo<NoteEncounterOption[]>(() => {
    const options: NoteEncounterOption[] = []
    const seen = new Set<string>()

    const completed = fightHistory
      .filter((fight) => !fight.active)
      .slice()
      .reverse()

    for (const fight of completed) {
      if (seen.has(fight.id)) continue
      seen.add(fight.id)
      options.push({
        id: fight.id,
        target: fight.target,
        label: `Recent Fight ${options.length + 1}`
      })
      if (options.length >= 5) break
    }

    return options
  }, [fightHistory])

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
    if (selectingLogRef.current) return

    selectingLogRef.current = true
    setIsSelectingLog(true)

    try {
      await selectLog()
      setSelectedFightIndex(null)
      activeFightIdRef.current = null
    } catch (error) {
      console.error(error)
      alert('Unable to connect to that log file.')
    } finally {
      selectingLogRef.current = false
      setIsSelectingLog(false)
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
      setOhShitToast(markerTime ? `OH SHIT marker added · ${markerTime}` : 'OH SHIT marker added')
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

  const engineAutoAttackWarning = fightState.combatState.autoAttackWarning
  const focusedEqlInputGrace =
    lastEqlInputActivityAt > 0 &&
    Date.now() - lastEqlInputActivityAt < 4_000
  const autoAttackWarning =
    alarmEnabled &&
    engineAutoAttackWarning &&
    !focusedEqlInputGrace

  useEffect(() => {
    if (alarmRetryTimerRef.current !== null) {
      window.clearTimeout(alarmRetryTimerRef.current)
      alarmRetryTimerRef.current = null
    }

    const audio = autoAttackAudioRef.current

    if (!autoAttackWarning) {
      fartMarkerWrittenRef.current = false
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

    if (!audio) return

    audio.loop = true
    audio.volume = 1
    audio.currentTime = 0

    const tryPlay = () => {
      void audio.play().catch((error) => {
        console.error('Auto-attack warning sound failed:', error)
      })
    }

    tryPlay()

    // One short retry handles an Audio element that was still decoding/loading
    // when the warning transition occurred. Visual state remains authoritative.
    alarmRetryTimerRef.current = window.setTimeout(() => {
      if (audio.paused) tryPlay()
      alarmRetryTimerRef.current = null
    }, 350)

    return () => {
      if (alarmRetryTimerRef.current !== null) {
        window.clearTimeout(alarmRetryTimerRef.current)
        alarmRetryTimerRef.current = null
      }
    }
  }, [autoAttackWarning, selectedLog])

  const displayedAbilityRows = displayedFight?.abilities.slice().sort((a,b)=>b.damage-a.damage) ?? []
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
            ⚠ AUTO ATTACK IS NOT ON — SWING, PECK!
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className="select-button"
            onClick={handleSelectLog}
            disabled={isSelectingLog}
          >
            {isSelectingLog ? 'Selecting Log...' : 'Select EQL Log File'}
          </button>
<button
            className="select-button"
            onClick={() => void handleSelectAlarmSound()}
            title={`Current alarm: ${alarmSoundName}`}
          >
            Alarm Sound
          </button>

          <button
            className="select-button"
            onClick={handleTestAlarmSound}
            title="Play the currently selected alarm sound for about two seconds"
          >
            Test Alarm
          </button>

          <button
            className="select-button"
            onClick={toggleAlarm}
            aria-pressed={alarmEnabled}
            title={
              alarmEnabled
                ? 'Swing warning is ARMED. Click to mute it.'
                : 'Swing warning is MUTED. Click to arm it.'
            }
            style={{
              background: alarmEnabled ? '#2d78b7' : '#4a5360',
              fontWeight: 800
            }}
          >
            Alarm: {alarmEnabled ? '🟢 ARMED' : '🔇 MUTED'}
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
                ? '✓ MARKED!'
                : ohShitStatus === 'error'
                  ? '✕ TRY AGAIN'
                  : 'OH SHIT!'}
          </button>
        </div>

        {ohShitToast && (
          <div className={`peql-toast toast-${ohShitStatus}`} role="status" aria-live="polite">
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

        <QuickPlayerNote
          selectedLog={selectedLog}
          zoneName={latestZoneName}
          activeEncounterId={fightState.currentFight?.id}
          activeEncounterTarget={fightState.currentFight?.target}
          recentEncounters={noteEncounterOptions}
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
            {logLines.length.toLocaleString()} recent lines loaded
          </span>
          <span className="alarm-sound-name" title={alarmSoundName}>
            Alarm: {alarmEnabled ? `ARMED · ${alarmSoundName}` : 'MUTED'}
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
            >◀</button>

            <strong style={{ textAlign: 'center', flex: 1 }}>
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
              style={{ minWidth: '44px', opacity: canGoNewer ? 1 : 0.45 }}
            >▶</button>
          </div>

          <div className="dps-heading">
            <div>
              <span className="dps-label">
                {isViewingLive ? 'CURRENT FIGHT' : 'FIGHT HISTORY'}
                {displayedFight?.target && (
                  <strong className="fight-target"> · {displayedFight.target}</strong>
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
          {displayedAbilityRows.length>0&&<div className="fight-details-analytics"><div className="fight-details-heading"><div><strong>Fight Details</strong><span>Damage by ability / triggered effect</span></div><span>{displayedAbilityRows.length} sources</span></div><div className="fight-ability-list">{displayedAbilityRows.slice(0,12).map(x=>{const pct=(displayedFight?.totalDamage??0)>0?x.damage/(displayedFight?.totalDamage??1)*100:0;const cat=dashboardAbilityCategory(x);return <div className="fight-ability-row" key={x.actorType+'-'+x.actor+'-'+x.source+'-'+x.ability}><div className="fight-ability-main"><strong>{x.ability}</strong><span>{cat}{x.actorType==='pet'?' · '+x.actor:''}</span></div><div className="fight-ability-numbers"><strong>{x.damage.toLocaleString()}</strong><span>{x.hits} {cat==='Triggered'?'triggers':'hits'}{x.criticalHits?' · '+x.criticalHits+' crit'+(x.criticalHits===1?'':'s'):''} · {pct.toFixed(1)}%</span></div></div>})}</div></div>}
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

