import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectLogFile: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openLogFile'),

  readLogFile: (filePath: string): Promise<string[]> =>
    ipcRenderer.invoke('log:read', filePath)
})