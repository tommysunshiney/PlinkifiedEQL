import { contextBridge, ipcRenderer } from 'electron'
import type {
  EncounterInput,
  JournalEntryInput,
  PlayerNoteInput,
  PlayerNoteRecord
} from './database/types'

contextBridge.exposeInMainWorld('electronAPI', {
  getDatabaseStatus: () => ipcRenderer.invoke('database:status'),

  searchBosses: (query: string, zone?: string) =>
    ipcRenderer.invoke('bosses:search', query, zone),

  saveJournalEntries: (
    logFilePath: string,
    entries: JournalEntryInput[]
  ): Promise<number> =>
    ipcRenderer.invoke('journal:save', logFilePath, entries),

  listJournalEntries: (limit?: number) =>
    ipcRenderer.invoke('journal:list', limit),

  savePlayerNote: (
    input: PlayerNoteInput
  ): Promise<PlayerNoteRecord> =>
    ipcRenderer.invoke('player-notes:save', input),

  listPlayerNotes: (
    limit?: number
  ): Promise<PlayerNoteRecord[]> =>
    ipcRenderer.invoke('player-notes:list', limit),

  exportPlayerNotes: (): Promise<{
    canceled: boolean
    filePath?: string
    count: number
  }> => ipcRenderer.invoke('player-notes:export'),

  saveEncounters: (
    logFilePath: string,
    encounters: EncounterInput[],
    mode: 'live' | 'replay' = 'live'
  ): Promise<number> =>
    ipcRenderer.invoke('encounters:save', logFilePath, encounters, mode),

  listEncounters: (limit?: number) =>
    ipcRenderer.invoke('encounters:list', limit),

  listEncounterSummaries: (limit?: number) =>
    ipcRenderer.invoke('encounters:listSummaries', limit),

  listCombatStatsSummaries: (limit?: number) =>
    ipcRenderer.invoke('encounters:listCombatStatsSummaries', limit),

  getEncounterById: (id: number) =>
    ipcRenderer.invoke('encounters:getById', id),

  getEncounterBySourceKey: (sourceKey: string) =>
    ipcRenderer.invoke('encounters:getBySourceKey', sourceKey),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('external:open', url),

  selectLogFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openLogFile'),

  readLogFile: (filePath: string): Promise<string[]> =>
    ipcRenderer.invoke('log:read', filePath),

  startLogWatch: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('log:startWatch', filePath),

  stopLogWatch: (): Promise<void> =>
    ipcRenderer.invoke('log:stopWatch'),

  onLogLines: (callback: (lines: string[]) => void): void => {
    ipcRenderer.removeAllListeners('log:newLines')
    ipcRenderer.on('log:newLines', (_event, lines: string[]) => {
      callback(lines)
    })
  },

  onEqlInputActivity: (callback: (timestamp: number) => void): void => {
    ipcRenderer.removeAllListeners('eql:input-activity')
    ipcRenderer.on('eql:input-activity', (_event, timestamp: number) => {
      callback(timestamp)
    })
  },

  startNewSession: (
    filePath: string,
  ): Promise<{
    success: boolean
    marker: string
  }> => ipcRenderer.invoke('log:newSession', filePath),

  markOhShit: (
    filePath: string,
  ): Promise<{
    success: boolean
    marker: string
  }> => ipcRenderer.invoke('log:ohShit', filePath),

  markFart: (
    filePath: string,
  ): Promise<{
    success: boolean
    marker: string
  }> => ipcRenderer.invoke('log:fart', filePath),
})
