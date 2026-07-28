import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
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
  }
})