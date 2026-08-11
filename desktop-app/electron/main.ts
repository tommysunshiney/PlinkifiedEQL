import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import {
  closeDatabase,
  getDatabaseStatus,
  initializeDatabase,
  listEncounters,
  listJournalEntries,
  saveEncounters,
  saveJournalEntries,
  searchBosses,
  listPlayerNotes,
  savePlayerNote
} from './database/database'
import type {
  EncounterInput,
  JournalEntryInput,
  PlayerNoteInput
} from './database/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null
let logDialogOpen = false

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

ipcMain.handle(
  'player-notes:save',
  (_, input: PlayerNoteInput) => savePlayerNote(input)
)

ipcMain.handle(
  'player-notes:list',
  (_, limit?: number) => listPlayerNotes(limit)
)

ipcMain.handle(
  'encounters:save',
  (
    _,
    logFilePath: string,
    encounters: EncounterInput[],
    mode?: 'live' | 'replay'
  ) => saveEncounters(logFilePath, encounters, mode)
)

ipcMain.handle(
  'encounters:list',
  (_, limit?: number) => listEncounters(limit)
)

ipcMain.handle('external:open', async (_, url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'eqlwiki.com') {
    throw new Error('Only EQL Wiki links may be opened from PEQL.')
  }
  await shell.openExternal(parsed.toString())
})

ipcMain.handle('dialog:openLogFile', async () => {
  if (logDialogOpen) return null

  logDialogOpen = true
  try {
    const result = win
      ? await dialog.showOpenDialog(win, {
      title: 'Select EQL Log File',
      properties: ['openFile'],
      filters: [
        { name: 'EverQuest Legends Log Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
      : await dialog.showOpenDialog({
          title: 'Select EQL Log File',
          properties: ['openFile'],
          filters: [
            { name: 'EverQuest Legends Log Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  } finally {
    logDialogOpen = false
  }
})

const RECENT_KILL_TARGET = 10
const RECENT_LOOKBACK_MS = 30 * 60 * 1000
const RECENT_READ_CHUNK_BYTES = 256 * 1024
const RECENT_MAX_BYTES = 8 * 1024 * 1024

function parseLogTimestamp(line: string): number | null {
  const match = line.match(/^\[([^\]]+)\]/)
  if (!match) return null

  const parsed = Date.parse(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function isKillLine(line: string): boolean {
  return /\]\s+You have slain .+!$/i.test(line)
}

function isSafeReplayBoundary(line: string): boolean {
  return (
    /===== PEQL SESSION START/.test(line) ||
    /\]\s+You have entered .+/i.test(line)
  )
}

async function readRecentLogTail(filePath: string): Promise<string[]> {
  const handle = await fs.open(filePath, 'r')

  try {
    const stats = await handle.stat()
    if (stats.size === 0) return []

    let position = stats.size
    let accumulated = ''
    let bytesReadTotal = 0
    let latestTimestamp: number | null = null
    let reachedTarget = false
    let targetTimestamp: number | null = null

    while (position > 0 && bytesReadTotal < RECENT_MAX_BYTES) {
      const chunkSize = Math.min(RECENT_READ_CHUNK_BYTES, position)
      position -= chunkSize

      const buffer = Buffer.alloc(chunkSize)
      await handle.read(buffer, 0, chunkSize, position)

      accumulated = buffer.toString('utf8') + accumulated
      bytesReadTotal += chunkSize

      const lines = accumulated
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)

      if (lines.length === 0) continue

      if (latestTimestamp === null) {
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const timestamp = parseLogTimestamp(lines[index])
          if (timestamp !== null) {
            latestTimestamp = timestamp
            break
          }
        }
      }

      if (latestTimestamp === null) continue

      const cutoff = latestTimestamp - RECENT_LOOKBACK_MS
      let killCount = 0
      let stopIndex = -1

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]
        const timestamp = parseLogTimestamp(line)

        if (timestamp !== null && timestamp < cutoff) {
          stopIndex = index + 1
          break
        }

        if (isKillLine(line)) {
          killCount += 1
          if (killCount >= RECENT_KILL_TARGET && !reachedTarget) {
            reachedTarget = true
            targetTimestamp = timestamp
          }
        }

        if (
          reachedTarget &&
          targetTimestamp !== null &&
          isSafeReplayBoundary(line)
        ) {
          stopIndex = index
          break
        }
      }

      if (stopIndex >= 0) {
        return lines.slice(stopIndex)
      }

      if (reachedTarget && position === 0) {
        return lines
      }
    }

    const lines = accumulated
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)

    if (latestTimestamp === null) return lines

    const cutoff = latestTimestamp - RECENT_LOOKBACK_MS
    const cutoffIndex = lines.findIndex((line) => {
      const timestamp = parseLogTimestamp(line)
      return timestamp !== null && timestamp >= cutoff
    })

    return cutoffIndex >= 0 ? lines.slice(cutoffIndex) : lines
  } finally {
    await handle.close()
  }
}

ipcMain.handle('log:read', async (_, filePath: string) => {
  return readRecentLogTail(filePath)
})

ipcMain.handle('log:newSession', async (_, filePath: string) => {
  if (!filePath) throw new Error('No log file selected.')
  const marker = createSessionMarker()
  await fs.appendFile(filePath, `\r\n${marker}\r\n`, 'utf8')
  return { success: true, marker }
})

ipcMain.handle('log:ohShit', async (_, filePath: string) => {
  if (!filePath) throw new Error('No log file selected.')
  const marker = createOhShitMarker()
  await fs.appendFile(filePath, `\r\n${marker}\r\n`, 'utf8')
  return { success: true, marker }
})

ipcMain.handle('log:fart', async (_, filePath: string) => {
  if (!filePath) throw new Error('No log file selected.')
  const marker = createFartMarker()
  await fs.appendFile(filePath, `\r\n${marker}\r\n`, 'utf8')
  return { success: true, marker }
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
  if (watchedLogPath) unwatchFile(watchedLogPath)

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

      if (currentStats.size === watchedLogSize) return

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
  if (watchedLogPath) unwatchFile(watchedLogPath)

  watchedLogPath = null
  watchedLogSize = 0
  unfinishedLine = ''
})

app.whenReady().then(() => {
  const status = initializeDatabase()
  console.log(`PEQL database ready: ${status.path}`)
  createWindow()
})
