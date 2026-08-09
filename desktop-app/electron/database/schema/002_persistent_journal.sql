ALTER TABLE journal_entries ADD COLUMN source_key TEXT;
ALTER TABLE journal_entries ADD COLUMN zone_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_session_source_key
  ON journal_entries(session_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_occurred
  ON journal_entries(occurred_at DESC);
