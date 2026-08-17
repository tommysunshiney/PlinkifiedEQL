import { useEffect, useMemo, useRef, useState } from 'react'

type TimerRecord = {
  id: string
  label: string
  durationMs: number
  remainingMs: number
  running: boolean
  endsAt: number | null
  completed: boolean
}

const STORAGE_KEY = 'peql:timers:v1'

function loadTimers(): TimerRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TimerRecord[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((timer) => {
      if (timer.running && timer.endsAt !== null) {
        const remaining = Math.max(0, timer.endsAt - Date.now())
        return {
          ...timer,
          remainingMs: remaining,
          running: remaining > 0,
          completed: remaining === 0
        }
      }
      return timer
    })
  } catch {
    return []
  }
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function playTimerDone() {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioContextCtor) return

    const context = new AudioContextCtor()
    const now = context.currentTime

    for (const offset of [0, 0.22, 0.44]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 740
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.18)
    }

    window.setTimeout(() => {
      void context.close()
    }, 1000)
  } catch (error) {
    console.warn('Timer sound failed:', error)
  }
}

export default function TimersPage() {
  const [timers, setTimers] = useState<TimerRecord[]>(loadTimers)
  const [label, setLabel] = useState('')
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(6)
  const [seconds, setSeconds] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const completedRef = useRef(new Set<string>())

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
  }, [timers])

  useEffect(() => {
    const finished: string[] = []

    for (const timer of timers) {
      if (!timer.running || timer.endsAt === null) continue
      if (timer.endsAt > clock) continue
      if (completedRef.current.has(timer.id)) continue

      completedRef.current.add(timer.id)
      finished.push(timer.id)
      playTimerDone()
    }

    if (finished.length === 0) return

    setTimers((current) =>
      current.map((timer) =>
        finished.includes(timer.id)
          ? {
              ...timer,
              running: false,
              endsAt: null,
              remainingMs: 0,
              completed: true
            }
          : timer
      )
    )
  }, [clock, timers])

  const orderedTimers = useMemo(
    () =>
      timers.slice().sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1
        if (a.completed !== b.completed) return a.completed ? -1 : 1
        return a.label.localeCompare(b.label)
      }),
    [timers]
  )

  function addTimer() {
    const durationMs =
      Math.max(0, hours) * 60 * 60 * 1000 +
      Math.max(0, minutes) * 60 * 1000 +
      Math.max(0, seconds) * 1000

    if (durationMs <= 0) return

    const timer: TimerRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: label.trim() || 'Camp Timer',
      durationMs,
      remainingMs: durationMs,
      running: false,
      endsAt: null,
      completed: false
    }

    setTimers((current) => [timer, ...current])
    setLabel('')
  }

  function liveRemaining(timer: TimerRecord): number {
    return timer.running && timer.endsAt !== null
      ? Math.max(0, timer.endsAt - clock)
      : timer.remainingMs
  }

  function startTimer(id: string) {
    completedRef.current.delete(id)
    setTimers((current) =>
      current.map((timer) => {
        if (timer.id !== id) return timer
        const remaining =
          timer.remainingMs <= 0 ? timer.durationMs : timer.remainingMs
        return {
          ...timer,
          remainingMs: remaining,
          running: true,
          endsAt: Date.now() + remaining,
          completed: false
        }
      })
    )
  }

  function pauseTimer(id: string) {
    setTimers((current) =>
      current.map((timer) => {
        if (timer.id !== id) return timer
        const remaining =
          timer.running && timer.endsAt !== null
            ? Math.max(0, timer.endsAt - Date.now())
            : timer.remainingMs
        return {
          ...timer,
          remainingMs: remaining,
          running: false,
          endsAt: null
        }
      })
    )
  }

  function resetTimer(id: string) {
    completedRef.current.delete(id)
    setTimers((current) =>
      current.map((timer) =>
        timer.id === id
          ? {
              ...timer,
              remainingMs: timer.durationMs,
              running: false,
              endsAt: null,
              completed: false
            }
          : timer
      )
    )
  }

  function addMinute(id: string) {
    completedRef.current.delete(id)
    setTimers((current) =>
      current.map((timer) => {
        if (timer.id !== id) return timer
        const remaining = liveRemaining(timer) + 60_000
        return {
          ...timer,
          remainingMs: remaining,
          endsAt: timer.running ? Date.now() + remaining : null,
          completed: false
        }
      })
    )
  }

  function removeTimer(id: string) {
    completedRef.current.delete(id)
    setTimers((current) => current.filter((timer) => timer.id !== id))
  }

  return (
    <main style={{ padding: '16px 18px' }}>
      <header style={{ marginBottom: '16px' }}>
        <h2 style={{ marginBottom: '4px' }}>⏱️ Camp Timers</h2>
        <p style={{ margin: 0, opacity: 0.78 }}>
          Named camps, respawns, cooldowns, coffee, whatever keeps Whittler waiting.
          Timers survive page changes and app restarts.
        </p>
      </header>

      <section
        style={{
          border: '1px solid #294b64',
          borderRadius: '14px',
          padding: '14px',
          marginBottom: '16px'
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1fr) 86px 86px 86px auto',
            gap: '8px',
            alignItems: 'end'
          }}
        >
          <label>
            <small>Timer name</small>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTimer()
              }}
              placeholder="Frenzied ghoul respawn"
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label>
            <small>Hours</small>
            <input
              type="number"
              min="0"
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label>
            <small>Minutes</small>
            <input
              type="number"
              min="0"
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label>
            <small>Seconds</small>
            <input
              type="number"
              min="0"
              max="59"
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <button type="button" onClick={addTimer}>
            + Add Timer
          </button>
        </div>
      </section>

      {orderedTimers.length === 0 ? (
        <section
          style={{
            border: '1px dashed #365a73',
            borderRadius: '14px',
            padding: '28px',
            textAlign: 'center',
            opacity: 0.72
          }}
        >
          No timers yet. Add the camp you are staring at instead of remembering it yourself.
        </section>
      ) : (
        <section style={{ display: 'grid', gap: '10px' }}>
          {orderedTimers.map((timer) => {
            const remaining = liveRemaining(timer)

            return (
              <article
                key={timer.id}
                style={{
                  border: timer.completed
                    ? '2px solid currentColor'
                    : '1px solid #294b64',
                  borderRadius: '14px',
                  padding: '12px 14px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '1.05rem' }}>{timer.label}</strong>
                    <div style={{ opacity: 0.7, marginTop: '2px' }}>
                      {timer.completed
                        ? '🚨 TIMER DONE'
                        : timer.running
                          ? 'Running'
                          : 'Paused / ready'}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: '2rem',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 800
                    }}
                  >
                    {formatRemaining(remaining)}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {timer.running ? (
                      <button type="button" onClick={() => pauseTimer(timer.id)}>
                        Pause
                      </button>
                    ) : (
                      <button type="button" onClick={() => startTimer(timer.id)}>
                        {timer.completed ? 'Start Again' : 'Start'}
                      </button>
                    )}
                    <button type="button" onClick={() => resetTimer(timer.id)}>
                      Reset
                    </button>
                    <button type="button" onClick={() => addMinute(timer.id)}>
                      +1m
                    </button>
                    <button type="button" onClick={() => removeTimer(timer.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}
    </main>
  )
}
