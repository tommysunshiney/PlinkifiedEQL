import { app, ipcMain, shell, dialog, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as fs from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import Database from "better-sqlite3";
const bossSeed = [];
const initialSchema = "PRAGMA foreign_keys = ON;\n\nCREATE TABLE IF NOT EXISTS schema_migrations (\n  version INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE IF NOT EXISTS sessions (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  character_name TEXT,\n  log_file_path TEXT NOT NULL,\n  started_at TEXT NOT NULL,\n  ended_at TEXT,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE IF NOT EXISTS log_checkpoints (\n  log_file_path TEXT PRIMARY KEY,\n  session_id INTEGER,\n  byte_offset INTEGER NOT NULL DEFAULT 0,\n  last_line_timestamp TEXT,\n  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS zone_visits (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id INTEGER NOT NULL,\n  zone_name TEXT NOT NULL,\n  entered_at TEXT NOT NULL,\n  left_at TEXT,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE\n);\n\nCREATE TABLE IF NOT EXISTS encounters (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id INTEGER NOT NULL,\n  zone_name TEXT,\n  encounter_title TEXT NOT NULL,\n  primary_npc_name TEXT,\n  primary_named_mob_id INTEGER,\n  started_at TEXT NOT NULL,\n  ended_at TEXT,\n  duration_ms INTEGER,\n  total_damage INTEGER NOT NULL DEFAULT 0,\n  dps REAL NOT NULL DEFAULT 0,\n  xp_percent REAL NOT NULL DEFAULT 0,\n  mob_kill_count INTEGER NOT NULL DEFAULT 0,\n  is_boss_encounter INTEGER NOT NULL DEFAULT 0,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,\n  FOREIGN KEY (primary_named_mob_id) REFERENCES named_mobs(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS encounter_mobs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  encounter_id INTEGER NOT NULL,\n  npc_name TEXT NOT NULL,\n  named_mob_id INTEGER,\n  first_seen_at TEXT,\n  slain_at TEXT,\n  damage_dealt INTEGER NOT NULL DEFAULT 0,\n  is_primary INTEGER NOT NULL DEFAULT 0,\n  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,\n  FOREIGN KEY (named_mob_id) REFERENCES named_mobs(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS kills (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id INTEGER NOT NULL,\n  encounter_id INTEGER,\n  npc_name TEXT NOT NULL,\n  named_mob_id INTEGER,\n  killed_at TEXT NOT NULL,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,\n  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,\n  FOREIGN KEY (named_mob_id) REFERENCES named_mobs(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS loot (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id INTEGER NOT NULL,\n  encounter_id INTEGER,\n  kill_id INTEGER,\n  item_name TEXT NOT NULL,\n  quantity INTEGER NOT NULL DEFAULT 1,\n  corpse_npc_name TEXT,\n  looted_at TEXT NOT NULL,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,\n  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,\n  FOREIGN KEY (kill_id) REFERENCES kills(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS journal_entries (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id INTEGER NOT NULL,\n  encounter_id INTEGER,\n  entry_type TEXT NOT NULL,\n  occurred_at TEXT NOT NULL,\n  title TEXT NOT NULL,\n  narrative TEXT NOT NULL,\n  metadata_json TEXT,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,\n  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS oh_shit_events (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id INTEGER NOT NULL,\n  encounter_id INTEGER,\n  marked_at TEXT NOT NULL,\n  note TEXT,\n  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,\n  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL\n);\n\nCREATE TABLE IF NOT EXISTS named_mobs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  npc_name TEXT NOT NULL,\n  title TEXT,\n  normalized_npc_name TEXT NOT NULL,\n  zone_name TEXT,\n  aliases_json TEXT NOT NULL DEFAULT '[]',\n  known_drops_json TEXT NOT NULL DEFAULT '[]',\n  wiki_page_title TEXT NOT NULL,\n  wiki_url TEXT NOT NULL,\n  source_revision INTEGER,\n  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  UNIQUE(normalized_npc_name, zone_name)\n);\n\nCREATE INDEX IF NOT EXISTS idx_named_mobs_normalized_name\n  ON named_mobs(normalized_npc_name);\nCREATE INDEX IF NOT EXISTS idx_named_mobs_zone\n  ON named_mobs(zone_name);\nCREATE INDEX IF NOT EXISTS idx_encounters_session_started\n  ON encounters(session_id, started_at);\nCREATE INDEX IF NOT EXISTS idx_journal_session_occurred\n  ON journal_entries(session_id, occurred_at);\n";
const migrations = [
  {
    version: 1,
    name: "initial_schema",
    sql: initialSchema
  }
];
function runMigrations(database2) {
  database2.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const appliedVersions = new Set(
    database2.prepare("SELECT version FROM schema_migrations").all().map((row2) => Number(row2.version))
  );
  const applyMigration = database2.transaction((migration) => {
    database2.exec(migration.sql);
    database2.prepare(
      "INSERT INTO schema_migrations (version, name) VALUES (?, ?)"
    ).run(migration.version, migration.name);
  });
  for (const migration of migrations) {
    if (!appliedVersions.has(migration.version)) {
      applyMigration(migration);
    }
  }
  const row = database2.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get();
  return Number(row.version);
}
let database = null;
let databasePath = "";
let schemaVersion = 0;
function normalizeNpcName(value) {
  return value.trim().toLocaleLowerCase().replace(/[’`]/g, "'").replace(/^an?\s+|^the\s+/i, "").replace(/\s+/g, " ");
}
function seedNamedMobs(records) {
  if (!database || records.length === 0) return;
  const insert = database.prepare(`
    INSERT INTO named_mobs (
      npc_name,
      title,
      normalized_npc_name,
      zone_name,
      aliases_json,
      known_drops_json,
      wiki_page_title,
      wiki_url,
      source_revision
    ) VALUES (
      @npcName,
      @title,
      @normalizedNpcName,
      @zone,
      @aliasesJson,
      @knownDropsJson,
      @wikiPageTitle,
      @wikiUrl,
      @sourceRevision
    )
    ON CONFLICT(normalized_npc_name, zone_name) DO UPDATE SET
      npc_name = excluded.npc_name,
      title = excluded.title,
      aliases_json = excluded.aliases_json,
      known_drops_json = excluded.known_drops_json,
      wiki_page_title = excluded.wiki_page_title,
      wiki_url = excluded.wiki_url,
      source_revision = excluded.source_revision,
      imported_at = CURRENT_TIMESTAMP
  `);
  const seedAll = database.transaction((seedRecords) => {
    for (const record of seedRecords) {
      insert.run({
        ...record,
        normalizedNpcName: normalizeNpcName(record.npcName),
        aliasesJson: JSON.stringify(record.aliases),
        knownDropsJson: JSON.stringify(record.knownDrops)
      });
    }
  });
  seedAll(records);
}
function initializeDatabase() {
  if (database) return getDatabaseStatus();
  databasePath = path.join(app.getPath("userData"), "peql.db");
  database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  schemaVersion = runMigrations(database);
  seedNamedMobs(bossSeed);
  return getDatabaseStatus();
}
function getDatabaseStatus() {
  const bossCount = database ? Number(
    database.prepare("SELECT COUNT(*) AS count FROM named_mobs").get().count
  ) : 0;
  return {
    ready: database !== null,
    path: databasePath,
    schemaVersion,
    bossCount
  };
}
function searchBosses(query, zone) {
  if (!database) throw new Error("PEQL database is not initialized.");
  const normalizedQuery = `%${normalizeNpcName(query)}%`;
  const rows = zone ? database.prepare(`
          SELECT * FROM named_mobs
          WHERE normalized_npc_name LIKE ?
            AND LOWER(COALESCE(zone_name, '')) = LOWER(?)
          ORDER BY title IS NULL, COALESCE(title, npc_name), npc_name
          LIMIT 50
        `).all(normalizedQuery, zone) : database.prepare(`
          SELECT * FROM named_mobs
          WHERE normalized_npc_name LIKE ?
             OR LOWER(COALESCE(title, '')) LIKE LOWER(?)
             OR LOWER(aliases_json) LIKE LOWER(?)
          ORDER BY title IS NULL, COALESCE(title, npc_name), npc_name
          LIMIT 50
        `).all(normalizedQuery, `%${query}%`, `%${query}%`);
  return rows.map((row) => {
    const value = row;
    return {
      id: Number(value.id),
      npcName: String(value.npc_name),
      title: value.title ? String(value.title) : null,
      zone: value.zone_name ? String(value.zone_name) : null,
      aliases: JSON.parse(String(value.aliases_json ?? "[]")),
      knownDrops: JSON.parse(
        String(value.known_drops_json ?? "[]")
      ),
      wikiPageTitle: String(value.wiki_page_title),
      wikiUrl: String(value.wiki_url),
      sourceRevision: value.source_revision ? Number(value.source_revision) : null
    };
  });
}
function closeDatabase() {
  database == null ? void 0 : database.close();
  database = null;
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function formatSessionTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
function createSessionMarker() {
  const timestamp = formatSessionTimestamp(/* @__PURE__ */ new Date());
  return `===== PEQL SESSION START :: ${timestamp} =====`;
}
function createOhShitMarker() {
  const timestamp = formatSessionTimestamp(/* @__PURE__ */ new Date());
  return `===== PEQL OH SHIT! :: ${timestamp} =====`;
}
ipcMain.handle("database:status", () => getDatabaseStatus());
ipcMain.handle(
  "bosses:search",
  (_, query, zone) => searchBosses(query, zone)
);
ipcMain.handle("external:open", async (_, url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "eqlwiki.com") {
    throw new Error("Only EQL Wiki links may be opened from PEQL.");
  }
  await shell.openExternal(parsed.toString());
});
ipcMain.handle("dialog:openLogFile", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select EQL Log File",
    properties: ["openFile"],
    filters: [
      { name: "EverQuest Legends Log Files", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});
ipcMain.handle("log:read", async (_, filePath) => {
  const text = await fs.readFile(filePath, "utf8");
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
});
ipcMain.handle("log:newSession", async (_, filePath) => {
  if (!filePath) {
    throw new Error("No log file selected.");
  }
  const marker = createSessionMarker();
  await fs.appendFile(filePath, `\r
${marker}\r
`, "utf8");
  return {
    success: true,
    marker
  };
});
ipcMain.handle("log:ohShit", async (_, filePath) => {
  if (!filePath) {
    throw new Error("No log file selected.");
  }
  const marker = createOhShitMarker();
  await fs.appendFile(filePath, `\r
${marker}\r
`, "utf8");
  return {
    success: true,
    marker
  };
});
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send(
      "main-process-message",
      (/* @__PURE__ */ new Date()).toLocaleString()
    );
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("before-quit", () => {
  closeDatabase();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
let watchedLogPath = null;
let watchedLogSize = 0;
let unfinishedLine = "";
ipcMain.handle("log:startWatch", async (event, filePath) => {
  if (watchedLogPath) {
    unwatchFile(watchedLogPath);
  }
  const stats = await fs.stat(filePath);
  watchedLogPath = filePath;
  watchedLogSize = stats.size;
  unfinishedLine = "";
  watchFile(filePath, { interval: 500 }, async (currentStats) => {
    try {
      if (currentStats.size < watchedLogSize) {
        watchedLogSize = currentStats.size;
        unfinishedLine = "";
        return;
      }
      if (currentStats.size === watchedLogSize) {
        return;
      }
      const bytesToRead = currentStats.size - watchedLogSize;
      const file = await fs.open(filePath, "r");
      const buffer = Buffer.alloc(bytesToRead);
      await file.read(buffer, 0, bytesToRead, watchedLogSize);
      await file.close();
      watchedLogSize = currentStats.size;
      const text = unfinishedLine + buffer.toString("utf8");
      const lines = text.split(/\r?\n/);
      unfinishedLine = lines.pop() ?? "";
      const completedLines = lines.filter(
        (line) => line.trim().length > 0
      );
      if (completedLines.length && !event.sender.isDestroyed()) {
        event.sender.send("log:newLines", completedLines);
      }
    } catch (error) {
      console.error("Log watch error:", error);
    }
  });
});
ipcMain.handle("log:stopWatch", () => {
  if (watchedLogPath) {
    unwatchFile(watchedLogPath);
  }
  watchedLogPath = null;
  watchedLogSize = 0;
  unfinishedLine = "";
});
app.whenReady().then(() => {
  const status = initializeDatabase();
  console.log(`PEQL database ready: ${status.path}`);
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
