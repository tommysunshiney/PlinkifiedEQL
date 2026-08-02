/// <reference types="vite/client" />

import type { BossRecord, DatabaseStatus } from './types/database'

declare global {
  interface Window {
    electronAPI: {
      getDatabaseStatus: () => Promise<DatabaseStatus>
      searchBosses: (query: string, zone?: string) => Promise<BossRecord[]>
      openExternal: (url: string) => Promise<void>
      selectLogFile: () => Promise<string | null>
      readLogFile: (filePath: string) => Promise<string[]>
      startLogWatch: (filePath: string) => Promise<void>
      stopLogWatch: () => Promise<void>
      onLogLines: (callback: (lines: string[]) => void) => void

      startNewSession: (
        filePath: string
      ) => Promise<{
        success: boolean
        marker: string
      }>

      markOhShit: (
        filePath: string
      ) => Promise<{
        success: boolean
        marker: string
      }>
    }
  }
}

export {}
