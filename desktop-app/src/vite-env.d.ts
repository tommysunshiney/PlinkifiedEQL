/// <reference types="vite/client" />

import type {
  BossRecord,
  DatabaseStatus,
  EncounterInput,
  EncounterRecord,
  JournalEntryInput,
  JournalRecord,
  PlayerNoteInput,
  PlayerNoteRecord
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
      savePlayerNote: (
        input: PlayerNoteInput
      ) => Promise<PlayerNoteRecord>
      listPlayerNotes: (
        limit?: number
      ) => Promise<PlayerNoteRecord[]>
      exportPlayerNotes: () => Promise<{
        canceled: boolean
        filePath?: string
        count: number
      }>
      saveEncounters: (
        logFilePath: string,
        encounters: EncounterInput[],
        mode?: 'live' | 'replay'
      ) => Promise<number>
      listEncounters: (limit?: number) => Promise<EncounterRecord[]>
      listEncounterSummaries: (
        limit?: number
      ) => Promise<EncounterRecord[]>
      listCombatStatsSummaries: (
        limit?: number
      ) => Promise<EncounterRecord[]>
      getEncounterById: (id: number) => Promise<EncounterRecord | null>
      getEncounterBySourceKey: (
        sourceKey: string
      ) => Promise<EncounterRecord | null>
      openExternal: (url: string) => Promise<void>
      selectLogFile: () => Promise<string | null>
      selectAlarmSound: () => Promise<{
        name: string
        dataUrl: string
      } | null>
      readLogFile: (filePath: string) => Promise<string[]>
      startLogWatch: (filePath: string) => Promise<{
        success: boolean
        reason?: 'missing'
      }>
      stopLogWatch: () => Promise<void>
      onLogLines: (callback: (lines: string[]) => void) => void
      onEqlInputActivity: (callback: (timestamp: number) => void) => void

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
