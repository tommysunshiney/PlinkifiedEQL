PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_name TEXT,
  log_file_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS log_checkpoints (
  log_file_path TEXT PRIMARY KEY,
  session_id INTEGER,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  last_line_timestamp TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS zone_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  zone_name TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  left_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS encounters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  zone_name TEXT,
  encounter_title TEXT NOT NULL,
  primary_npc_name TEXT,
  primary_named_mob_id INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  total_damage INTEGER NOT NULL DEFAULT 0,
  dps REAL NOT NULL DEFAULT 0,
  xp_percent REAL NOT NULL DEFAULT 0,
  mob_kill_count INTEGER NOT NULL DEFAULT 0,
  is_boss_encounter INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_named_mob_id) REFERENCES named_mobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS encounter_mobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_id INTEGER NOT NULL,
  npc_name TEXT NOT NULL,
  named_mob_id INTEGER,
  first_seen_at TEXT,
  slain_at TEXT,
  damage_dealt INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,
  FOREIGN KEY (named_mob_id) REFERENCES named_mobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS kills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  encounter_id INTEGER,
  npc_name TEXT NOT NULL,
  named_mob_id INTEGER,
  killed_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
  FOREIGN KEY (named_mob_id) REFERENCES named_mobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS loot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  encounter_id INTEGER,
  kill_id INTEGER,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  corpse_npc_name TEXT,
  looted_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL,
  FOREIGN KEY (kill_id) REFERENCES kills(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  encounter_id INTEGER,
  entry_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS oh_shit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  encounter_id INTEGER,
  marked_at TEXT NOT NULL,
  note TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS named_mobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  npc_name TEXT NOT NULL,
  title TEXT,
  normalized_npc_name TEXT NOT NULL,
  zone_name TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  known_drops_json TEXT NOT NULL DEFAULT '[]',
  wiki_page_title TEXT NOT NULL,
  wiki_url TEXT NOT NULL,
  source_revision INTEGER,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(normalized_npc_name, zone_name)
);

CREATE INDEX IF NOT EXISTS idx_named_mobs_normalized_name
  ON named_mobs(normalized_npc_name);
CREATE INDEX IF NOT EXISTS idx_named_mobs_zone
  ON named_mobs(zone_name);
CREATE INDEX IF NOT EXISTS idx_encounters_session_started
  ON encounters(session_id, started_at);
CREATE INDEX IF NOT EXISTS idx_journal_session_occurred
  ON journal_entries(session_id, occurred_at);
