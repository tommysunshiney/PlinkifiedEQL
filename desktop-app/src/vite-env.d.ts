/// <reference types="vite/client" />

import type {
  BossRecord,
  DatabaseStatus,
  JournalEntryInput,
  JournalRecord
} from './types/database'

declare global {
  interface Window {
    electronAPI: {
      getDatabaseStatus: () => Promise<DatabaseStatus>
      searchBosses: (query: string, zone?: string) => Promise<BossRecord[]>
      saveJournalEntries: (
        logFilePath: string,
        entries: JournalEntryInput[]
      ) => Promise<number>
      listJournalEntries: (limit?: number) => Promise<JournalRecord[]>
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

      markFart: (
        filePath: string
      ) => Promise<{
        success: boolean
        marker: string
      }>
    }
  }
}

export {}
