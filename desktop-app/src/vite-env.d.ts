/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    selectLogFile(): Promise<string | null>
    readLogFile(filePath: string): Promise<string[]>
  }
}