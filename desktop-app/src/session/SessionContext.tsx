import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'

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
  isConnected: boolean
  connectionError: string
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
  const [selectedLog, setSelectedLog] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [connectionError, setConnectionError] = useState('')

  useEffect(() => {
    window.electronAPI.onLogLines((newLines) => {
      setLogLines((currentLines) => [...currentLines, ...newLines])
    })
  }, [])

  const sessionLines = useMemo(
    () => getSessionLines(logLines),
    [logLines]
  )

  async function connectToLog(filePath: string) {
    const lines = await window.electronAPI.readLogFile(filePath)
    await window.electronAPI.startLogWatch(filePath)

    setSelectedLog(filePath)
    setLogLines(lines)
    setIsConnected(true)
    setConnectionError('')
    window.localStorage.setItem(LAST_LOG_KEY, filePath)
  }

  async function selectLog() {
    const filePath = await window.electronAPI.selectLogFile()

    if (!filePath) {
      return
    }

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

    if (!lastLog) {
      return
    }

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
    setLogLines(lines)
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
        isConnected,
        connectionError,
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
