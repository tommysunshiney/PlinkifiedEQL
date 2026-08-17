import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  encountersFromFights,
  zoneContextFromLine
} from '../encounters/encounterHistory'
import type { ZoneContext } from '../encounters/encounterHistory'
import { FightEngine } from '../fight-engine'
import type {
  FightEngineSnapshot,
  FightSnapshot
} from '../fight-engine'
import { journalEntriesFromLines } from '../journal/journalEntries'

const SESSION_MARKER = '===== PEQL SESSION START'
const LAST_LOG_KEY = 'peql:last-selected-log'
const LAST_ZONE_KEY_PREFIX = 'peql:last-known-zone:'

function lastZoneKey(filePath: string): string {
  return `${LAST_ZONE_KEY_PREFIX}${filePath.toLocaleLowerCase()}`
}

function readLastKnownZone(filePath: string): ZoneContext | undefined {
  if (!filePath) return undefined

  try {
    const raw = window.localStorage.getItem(lastZoneKey(filePath))
    if (!raw) return undefined

    const parsed = JSON.parse(raw) as ZoneContext
    return parsed?.zoneName ? parsed : undefined
  } catch {
    return undefined
  }
}

function rememberLastKnownZone(
  filePath: string,
  lines: string[]
): ZoneContext | undefined {
  if (!filePath || lines.length === 0) return readLastKnownZone(filePath)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const context = zoneContextFromLine(lines[index])
    if (!context?.zoneName) continue

    window.localStorage.setItem(
      lastZoneKey(filePath),
      JSON.stringify(context)
    )
    return context
  }

  return readLastKnownZone(filePath)
}

export type MarkerResult = {
  success: boolean
  marker: string
}

type SessionContextValue = {
  selectedLog: string
  logLines: string[]
  sessionLines: string[]
  fightState: FightEngineSnapshot
  isConnected: boolean
  connectionError: string
  journalRevision: number
  encounterRevision: number
  selectLog: () => Promise<void>
  reconnectLastLog: () => Promise<void>
  startNewSession: () => Promise<void>
  markOhShit: () => Promise<MarkerResult>
}

const SessionContext = createContext<SessionContextValue | null>(null)

function getSessionLines(logLines: string[]): string[] {
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
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const fightEngineRef = useRef(new FightEngine())
  const selectedLogRef = useRef('')
  const logLinesRef = useRef<string[]>([])
  const replayInProgressRef = useRef(false)
  const queuedLiveLinesRef = useRef<string[]>([])
  const persistedFightIdsRef = useRef(new Set<string>())
  const latestLogTimestampRef = useRef(0)
  const latestLogTimestampSeenAtRef = useRef(Date.now())
  const [selectedLog, setSelectedLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [fightState, setFightState] = useState<FightEngineSnapshot>(() =>
    fightEngineRef.current.snapshot()
  )
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [journalRevision, setJournalRevision] = useState(0)
  const [encounterRevision, setEncounterRevision] = useState(0)

  function rememberLatestLogTimestamp(lines: string[]) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const match = lines[index].match(/^\[([^\]]+)\]/)
      if (!match) continue

      const timestamp = Date.parse(match[1])
      if (!Number.isFinite(timestamp)) continue

      latestLogTimestampRef.current = Math.max(
        latestLogTimestampRef.current,
        timestamp
      )
      latestLogTimestampSeenAtRef.current = Date.now()
      return
    }
  }

  function liveSnapshotClock(): number {
    if (latestLogTimestampRef.current <= 0) {
      return Date.now()
    }

    return (
      latestLogTimestampRef.current +
      Math.max(0, Date.now() - latestLogTimestampSeenAtRef.current)
    )
  }

  async function ingestReplayInChunks(lines: string[]) {
    const chunkSize = 2_000

    fightEngineRef.current.reset()

    for (let index = 0; index < lines.length; index += chunkSize) {
      fightEngineRef.current.ingestLines(
        lines.slice(index, index + chunkSize)
      )

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
    }
  }

  async function persistJournalLines(
    filePath: string,
    lines: string[]
  ) {
    if (!filePath || lines.length === 0) return

    const entries = journalEntriesFromLines(lines)
    if (entries.length === 0) return

    try {
      const inserted = await window.electronAPI.saveJournalEntries(
        filePath,
        entries
      )

      if (inserted > 0) {
        setJournalRevision((revision) => revision + inserted)
      }
    } catch (error) {
      console.error('Unable to save Adventure Journal entries:', error)
    }
  }

  async function persistCompletedFights(
    filePath: string,
    lines: string[],
    fights: FightSnapshot[],
    mode: 'live' | 'replay' = 'live'
  ) {
    if (!filePath || fights.length === 0) return

    const completed = fights.filter(
      (fight) =>
        !fight.active &&
        fight.endedAt !== null &&
        fight.endReason !== null
    )

    const candidates =
      mode === 'replay'
        ? completed
        : completed.filter(
            (fight) => !persistedFightIdsRef.current.has(fight.id)
          )

    if (candidates.length === 0) return

    const encounters = encountersFromFights(
      lines,
      candidates,
      readLastKnownZone(filePath)
    )
    if (encounters.length === 0) return

    try {
      const inserted = await window.electronAPI.saveEncounters(
        filePath,
        encounters,
        mode
      )

      for (const fight of candidates) {
        persistedFightIdsRef.current.add(fight.id)
      }

      if (inserted > 0) {
        setEncounterRevision((revision) => revision + inserted)
      }
    } catch (error) {
      console.error('Unable to save encounter history:', error)
    }
  }

  useEffect(() => {
    window.electronAPI.onLogLines((newLines) => {
      const nextLines = [...logLinesRef.current, ...newLines]
      logLinesRef.current = nextLines
      setLogLines(nextLines)

      if (replayInProgressRef.current) {
        queuedLiveLinesRef.current.push(...newLines)
        return
      }

      rememberLatestLogTimestamp(newLines)
      fightEngineRef.current.ingestLines(newLines)
      const nextFightState = fightEngineRef.current.snapshot(
        liveSnapshotClock()
      )
      setFightState(nextFightState)

      const filePath = selectedLogRef.current
      if (filePath) {
        rememberLastKnownZone(filePath, newLines)
        void persistJournalLines(filePath, newLines)
        void persistCompletedFights(
          filePath,
          getSessionLines(nextLines),
          nextFightState.fights
        )
      }
    })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextFightState = fightEngineRef.current.snapshot(
        liveSnapshotClock()
      )
      setFightState(nextFightState)
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  const sessionLines = useMemo(
    () => getSessionLines(logLines),
    [logLines]
  )

  async function connectToLog(filePath: string) {
    replayInProgressRef.current = true
    queuedLiveLinesRef.current = []
    persistedFightIdsRef.current.clear()
    latestLogTimestampRef.current = 0
    latestLogTimestampSeenAtRef.current = Date.now()

    try {
      // log:read is now a bounded recent-tail read, never a full-file load.
      const recentLines = await window.electronAPI.readLogFile(filePath)
      rememberLatestLogTimestamp(recentLines)
      rememberLastKnownZone(filePath, recentLines)

      selectedLogRef.current = filePath
      logLinesRef.current = recentLines
      setSelectedLog(filePath)
      setLogLines(recentLines)
      setConnectionError('')
      window.localStorage.setItem(LAST_LOG_KEY, filePath)

      // Connected means the live watcher is attached. Historical warmup no
      // longer blocks the Connected state.
      await window.electronAPI.startLogWatch(filePath)
      setIsConnected(true)

      const recentSessionLines = getSessionLines(recentLines)
      await ingestReplayInChunks(recentSessionLines)

      const queuedLines = queuedLiveLinesRef.current
      queuedLiveLinesRef.current = []

      if (queuedLines.length > 0) {
        rememberLatestLogTimestamp(queuedLines)
        fightEngineRef.current.ingestLines(queuedLines)
        logLinesRef.current = [...logLinesRef.current, ...queuedLines]
        setLogLines(logLinesRef.current)
      }

      const nextFightState = fightEngineRef.current.snapshot(
        liveSnapshotClock()
      )
      setFightState(nextFightState)
      replayInProgressRef.current = false

      // SQLite owns durable history. Persist only the bounded recent tail.
      window.setTimeout(() => {
        void persistJournalLines(
          filePath,
          getSessionLines(logLinesRef.current)
        )
        void persistCompletedFights(
          filePath,
          getSessionLines(logLinesRef.current),
          nextFightState.fights,
          'replay'
        )
      }, 250)
    } catch (error) {
      replayInProgressRef.current = false
      queuedLiveLinesRef.current = []
      setIsConnected(false)
      throw error
    }
  }

  async function selectLog() {
    const filePath = await window.electronAPI.selectLogFile()
    if (!filePath) return

    try {
      await connectToLog(filePath)
    } catch (error) {
      setIsConnected(false)
      setConnectionError(
        error instanceof Error ? error.message : String(error)
      )
      throw error
    }
  }

  async function reconnectLastLog() {
    const lastLog = window.localStorage.getItem(LAST_LOG_KEY)
    if (!lastLog) return

    try {
      await connectToLog(lastLog)
    } catch (error) {
      setIsConnected(false)
      setConnectionError(
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  useEffect(() => {
    void reconnectLastLog()
  }, [])

  async function startNewSession() {
    if (!selectedLog) {
      throw new Error('No log file selected.')
    }

    await window.electronAPI.startNewSession(selectedLog)
    const lines = await window.electronAPI.readLogFile(selectedLog)
    const currentSessionLines = getSessionLines(lines)

    fightEngineRef.current.reset()
    persistedFightIdsRef.current.clear()
    latestLogTimestampRef.current = 0
    latestLogTimestampSeenAtRef.current = Date.now()
    rememberLatestLogTimestamp(currentSessionLines)
    fightEngineRef.current.ingestLines(currentSessionLines)
    const nextFightState = fightEngineRef.current.snapshot(
      liveSnapshotClock()
    )

    logLinesRef.current = lines
    setLogLines(lines)
    setFightState(nextFightState)

    void persistJournalLines(selectedLog, lines)
    void persistCompletedFights(
      selectedLog,
      currentSessionLines,
      nextFightState.fights,
      'replay'
    )
  }

  async function markOhShit(): Promise<MarkerResult> {
    if (!selectedLog) {
      throw new Error('No log file selected.')
    }

    return window.electronAPI.markOhShit(selectedLog)
  }

  return (
    <SessionContext.Provider
      value={{
        selectedLog,
        logLines,
        sessionLines,
        fightState,
        isConnected,
        connectionError,
        journalRevision,
        encounterRevision,
        selectLog,
        reconnectLastLog,
        startNewSession,
        markOhShit
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)

  if (!context) {
    throw new Error('useSession must be used inside SessionProvider.')
  }

  return context
}
