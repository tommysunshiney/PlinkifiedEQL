ALTER TABLE encounters ADD COLUMN source_key TEXT;
ALTER TABLE encounters ADD COLUMN end_reason TEXT;
ALTER TABLE encounters ADD COLUMN outcome TEXT;
ALTER TABLE encounters ADD COLUMN player_damage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN pet_damage INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN best_hit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE encounters ADD COLUMN zone_detail TEXT;
ALTER TABLE encounters ADD COLUMN actions_json TEXT NOT NULL DEFAULT '[]';

CREATE UNIQUE INDEX IF NOT EXISTS idx_encounter_session_source_key
  ON encounters(session_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_encounter_primary_zone_started
  ON encounters(primary_npc_name, zone_name, started_at);


CREATE TABLE IF NOT EXISTS player_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  encounter_source_key TEXT,
  created_at TEXT NOT NULL,
  zone_name TEXT,
  note_text TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_notes_created_at
  ON player_notes(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_notes_encounter_source
  ON player_notes(session_id, encounter_source_key);
