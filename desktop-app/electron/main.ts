import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { watchFile, unwatchFile } from 'node:fs'
import {
  closeDatabase,
  getDatabaseStatus,
  initializeDatabase,
  listEncounters,
  listEncounterSummaries,
  listCombatStatsSummaries,
  getEncounterById,
  getEncounterBySourceKey,
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

function formatPlayerNotesExport() {
  const notes = listPlayerNotes(50_000)

  const lines = [
    'PLINKIFIED EQL — PLAYER NOTES',
    `Exported: ${new Date().toLocaleString()}`,
    `Notes: ${notes.length}`,
    '='.repeat(72),
    ''
  ]

  for (const note of notes) {
    lines.push(`[${new Date(note.createdAt).toLocaleString()}]`)
    if (note.zoneName) lines.push(`Zone: ${note.zoneName}`)
    if (note.encounterTitle) lines.push(`Encounter: ${note.encounterTitle}`)
    else if (note.encounterSourceKey) lines.push('Encounter: linked encounter')
    else lines.push('Context: Session / General')
    lines.push(note.noteText)
    lines.push('-'.repeat(72))
    lines.push('')
  }

  return { notes, text: lines.join('\r\n') }
}

ipcMain.handle('player-notes:export', async () => {
  const { notes, text } = formatPlayerNotesExport()
  const date = new Date().toISOString().slice(0, 10)

  const result = win
    ? await dialog.showSaveDialog(win, {
        title: 'Export PEQL Player Notes',
        defaultPath: path.join(
          app.getPath('documents'),
          `PEQL-NOTES-${date}.txt`
        ),
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      })
    : await dialog.showSaveDialog({
        title: 'Export PEQL Player Notes',
        defaultPath: path.join(
          app.getPath('documents'),
          `PEQL-NOTES-${date}.txt`
        ),
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
      })

  if (result.canceled || !result.filePath) {
    return { canceled: true, count: notes.length }
  }

  await fs.writeFile(result.filePath, text, 'utf8')
  return {
    canceled: false,
    filePath: result.filePath,
    count: notes.length
  }
})

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

ipcMain.handle(
  'encounters:listSummaries',
  (_, limit?: number) => listEncounterSummaries(limit)
)

ipcMain.handle(
  'encounters:listCombatStatsSummaries',
  (_, limit?: number) => listCombatStatsSummaries(limit)
)

ipcMain.handle(
  'encounters:getById',
  (_, id: number) => getEncounterById(id)
)

ipcMain.handle(
  'encounters:getBySourceKey',
  (_, sourceKey: string) => getEncounterBySourceKey(sourceKey)
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


let eqlInputMonitor: ReturnType<typeof spawn> | null = null
let eqlInputMonitorBuffer = ''

const EQL_INPUT_MONITOR_SCRIPT = String.raw` 
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class PeqlInputMonitor {
  [StructLayout(LayoutKind.Sequential)]
  public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }

  [DllImport("user32.dll")]
  public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

$lastTick = [uint32]0
$lastEmit = [int64]0

while ($true) {
  $info = New-Object PeqlInputMonitor+LASTINPUTINFO
  $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)

  if ([PeqlInputMonitor]::GetLastInputInfo([ref]$info)) {
    if ($info.dwTime -ne $lastTick) {
      $hwnd = [PeqlInputMonitor]::GetForegroundWindow()
      [uint32]$foregroundPid = 0
      [PeqlInputMonitor]::GetWindowThreadProcessId(
        $hwnd,
        [ref]$foregroundPid
      ) | Out-Null

      $titleBuilder = New-Object System.Text.StringBuilder 512
      [PeqlInputMonitor]::GetWindowText(
        $hwnd,
        $titleBuilder,
        512
      ) | Out-Null
      $title = $titleBuilder.ToString()

      $processName = ''
      try {
        $processName = (
          Get-Process -Id $foregroundPid -ErrorAction Stop
        ).ProcessName
      } catch {}

      $isEverQuest =
        ($processName -match '^eqgame$') -or
        ($title -match 'EverQuest')

      $now = [Environment]::TickCount64
      if ($isEverQuest -and (($now - $lastEmit) -ge 500)) {
        Write-Output 'PEQL_INPUT'
        [Console]::Out.Flush()
        $lastEmit = $now
      }

      $lastTick = $info.dwTime
    }
  }

  Start-Sleep -Milliseconds 150
}
`

function startEqlInputMonitor() {
  if (process.platform !== 'win32' || eqlInputMonitor) return

  try {
    eqlInputMonitor = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        EQL_INPUT_MONITOR_SCRIPT
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    eqlInputMonitor.stdout?.setEncoding('utf8')
    eqlInputMonitor.stdout?.on('data', (chunk: string) => {
      eqlInputMonitorBuffer += chunk
      const lines = eqlInputMonitorBuffer.split(/\r?\n/)
      eqlInputMonitorBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim() !== 'PEQL_INPUT') continue
        if (!win || win.webContents.isDestroyed()) continue
        win.webContents.send('eql:input-activity', Date.now())
      }
    })

    eqlInputMonitor.stderr?.setEncoding('utf8')
    eqlInputMonitor.stderr?.on('data', (chunk: string) => {
      const warning = chunk.trim()
      if (warning) console.warn('EQL input monitor:', warning)
    })

    eqlInputMonitor.on('exit', () => {
      eqlInputMonitor = null
      eqlInputMonitorBuffer = ''
    })
  } catch (error) {
    console.warn(
      'Unable to start optional EQL input monitor:',
      error
    )
    eqlInputMonitor = null
  }
}

function stopEqlInputMonitor() {
  if (!eqlInputMonitor) return

  eqlInputMonitor.kill()
  eqlInputMonitor = null
  eqlInputMonitorBuffer = ''
}

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
  stopEqlInputMonitor()
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
  startEqlInputMonitor()
})
