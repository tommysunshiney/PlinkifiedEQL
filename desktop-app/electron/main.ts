import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

ipcMain.handle('dialog:openLogFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select EQL Log File',
    properties: ['openFile'],
    filters: [
      { name: 'EverQuest Log Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('log:read', async (_, filePath: string) => {
  const text = await fs.readFile(filePath, 'utf8')

  return text
    .split(/\r?\n/)
    .filter(line => line.length)
    .slice(-50)
})

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

let watchedLogPath: string | null = null
let watchedLogSize = 0
let unfinishedLine = ''

ipcMain.handle('log:startWatch', async (event, filePath: string) => {
  if (watchedLogPath) {
    unwatchFile(watchedLogPath)
  }

  const stats = await fs.stat(filePath)

  watchedLogPath = filePath
  watchedLogSize = stats.size
  unfinishedLine = ''

  watchFile(filePath, { interval: 500 }, async (currentStats) => {
    try {
      if (currentStats.size < watchedLogSize) {
        watchedLogSize = currentStats.size
        unfinishedLine = ''
        return
      }

      if (currentStats.size === watchedLogSize) {
        return
      }

      const bytesToRead = currentStats.size - watchedLogSize
      const file = await fs.open(filePath, 'r')
      const buffer = Buffer.alloc(bytesToRead)

      await file.read(buffer, 0, bytesToRead, watchedLogSize)
      await file.close()

      watchedLogSize = currentStats.size

      const text = unfinishedLine + buffer.toString('utf8')
      const lines = text.split(/\r?\n/)

      unfinishedLine = lines.pop() ?? ''

      const completedLines = lines.filter((line) => line.length > 0)

      if (completedLines.length && !event.sender.isDestroyed()) {
        event.sender.send('log:newLines', completedLines)
      }
    } catch (error) {
      console.error('Log watch error:', error)
    }
  })
})

ipcMain.handle('log:stopWatch', () => {
  if (watchedLogPath) {
    unwatchFile(watchedLogPath)
  }

  watchedLogPath = null
  watchedLogSize = 0
  unfinishedLine = ''
})

app.whenReady().then(createWindow)
