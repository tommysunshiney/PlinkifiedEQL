import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { encountersFromFights } from '../encounters/encounterHistory'
import { FightEngine } from '../fight-engine'
import type {
  FightEngineSnapshot,
  FightSnapshot
} from '../fight-engine'
import { journalEntriesFromLines } from '../journal/journalEntries'

const SESSION_MARKER = '===== PEQL SESSION START'
const LAST_LOG_KEY = 'peql:last-selected-log'

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
  const [selectedLog, setSelectedLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [fightState, setFightState] = useState<FightEngineSnapshot>(() =>
    fightEngineRef.current.snapshot()
  )
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [journalRevision, setJournalRevision] = useState(0)
  const [encounterRevision, setEncounterRevision] = useState(0)

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

    const encounters = encountersFromFights(lines, fights)
    if (encounters.length === 0) return

    try {
      const inserted = await window.electronAPI.saveEncounters(
        filePath,
        encounters,
        mode
      )

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

      fightEngineRef.current.ingestLines(newLines)
      const nextFightState = fightEngineRef.current.snapshot()
      setFightState(nextFightState)

      const filePath = selectedLogRef.current
      if (filePath) {
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
      const nextFightState = fightEngineRef.current.snapshot()
      setFightState(nextFightState)

      const filePath = selectedLogRef.current
      if (filePath) {
        void persistCompletedFights(
          filePath,
          getSessionLines(logLinesRef.current),
          nextFightState.fights
        )
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [])

  const sessionLines = useMemo(
    () => getSessionLines(logLines),
    [logLines]
  )

  async function connectToLog(filePath: string) {
    const lines = await window.electronAPI.readLogFile(filePath)
    await window.electronAPI.startLogWatch(filePath)

    const currentSessionLines = getSessionLines(lines)
    fightEngineRef.current.reset()
    fightEngineRef.current.ingestLines(currentSessionLines)
    const nextFightState = fightEngineRef.current.snapshot()

    selectedLogRef.current = filePath
    logLinesRef.current = lines
    setSelectedLog(filePath)
    setLogLines(lines)
    setFightState(nextFightState)
    setIsConnected(true)
    setConnectionError('')
    window.localStorage.setItem(LAST_LOG_KEY, filePath)

    void persistJournalLines(filePath, lines)
    void persistCompletedFights(
      filePath,
      currentSessionLines,
      nextFightState.fights,
      'replay'
    )
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
    fightEngineRef.current.ingestLines(currentSessionLines)
    const nextFightState = fightEngineRef.current.snapshot()

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
