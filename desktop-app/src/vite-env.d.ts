/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    selectLogFile: () => Promise<string | null>
    readLogFile: (filePath: string) => Promise<string[]>
    startLogWatch: (filePath: string) => Promise<void>
    stopLogWatch: () => Promise<void>
    onLogLines: (callback: (lines: string[]) => void) => void
  }
}