import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import {
  closeDatabase,
  getDatabaseStatus,
  initializeDatabase,
  listJournalEntries,
  saveJournalEntries,
  searchBosses
} from './database/database'
import type { JournalEntryInput } from './database/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function formatSessionTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function createSessionMarker(): string {
  const timestamp = formatSessionTimestamp(new Date())

  return `===== PEQL SESSION START :: ${timestamp} =====`
}

function createOhShitMarker(): string {
  const timestamp = formatSessionTimestamp(new Date())

  return `===== PEQL OH SHIT! :: ${timestamp} =====`
}

function createFartMarker(): string {
  const timestamp = formatSessionTimestamp(new Date())

  return `===== PEQL ==FART== :: ${timestamp} =====`
}

ipcMain.handle('database:status', () => getDatabaseStatus())

ipcMain.handle(
  'bosses:search',
  (_, query: string, zone?: string) => searchBosses(query, zone)
)

ipcMain.handle(
  'journal:save',
  (_, logFilePath: string, entries: JournalEntryInput[]) =>
    saveJournalEntries(logFilePath, entries)
)

ipcMain.handle(
  'journal:list',
  (_, limit?: number) => listJournalEntries(limit)
)

ipcMain.handle('external:open', async (_, url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'eqlwiki.com') {
    throw new Error('Only EQL Wiki links may be opened from PEQL.')
  }

  await shell.openExternal(parsed.toString())
})

ipcMain.handle('dialog:openLogFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select EQL Log File',
    properties: ['openFile'],
    filters: [
      { name: 'EverQuest Legends Log Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
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
    .filter((line) => line.trim().length > 0)
})

ipcMain.handle('log:newSession', async (_, filePath: string) => {
  if (!filePath) {
    throw new Error('No log file selected.')
  }

  const marker = createSessionMarker()

  await fs.appendFile(filePath, `\r\n${marker}\r\n`, 'utf8')

  return {
    success: true,
    marker,
  }
})

ipcMain.handle('log:ohShit', async (_, filePath: string) => {
  if (!filePath) {
    throw new Error('No log file selected.')
  }

  const marker = createOhShitMarker()

  await fs.appendFile(filePath, `\r\n${marker}\r\n`, 'utf8')

  return {
    success: true,
    marker,
  }
})

ipcMain.handle('log:fart', async (_, filePath: string) => {
  if (!filePath) {
    throw new Error('No log file selected.')
  }

  const marker = createFartMarker()

  await fs.appendFile(filePath, `\r\n${marker}\r\n`, 'utf8')

  return {
    success: true,
    marker,
  }
})

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send(
      'main-process-message',
      new Date().toLocaleString(),
    )
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('before-quit', () => {
  closeDatabase()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
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

      const completedLines = lines.filter(
        (line) => line.trim().length > 0,
      )

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

app.whenReady().then(() => {
  const status = initializeDatabase()
  console.log(`PEQL database ready: ${status.path}`)
  createWindow()
})
