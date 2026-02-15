CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
  timezone    TEXT NOT NULL,
  utc_offset  INTEGER NOT NULL,
  is_virtual  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  stats_chains     INTEGER DEFAULT 0,
  stats_completions INTEGER DEFAULT 0,
  stats_score      REAL DEFAULT 0.0
);
CREATE INDEX IF NOT EXISTS idx_users_offset ON users(utc_offset);

CREATE TABLE IF NOT EXISTS chains (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  hour        INTEGER NOT NULL,
  status      TEXT DEFAULT 'active',
  current_tz  INTEGER DEFAULT 12,
  blocks_count INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chains_status ON chains(status);
CREATE INDEX IF NOT EXISTS idx_chains_date ON chains(date);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  chain_id    TEXT NOT NULL REFERENCES chains(id),
  block_num   INTEGER NOT NULL,
  user_id     TEXT REFERENCES users(id),
  is_ai       INTEGER DEFAULT 0,
  content     TEXT NOT NULL,
  content_translated TEXT,
  media_type  TEXT DEFAULT 'text',
  media_url   TEXT,
  timezone    TEXT NOT NULL,
  utc_offset  INTEGER NOT NULL,
  context_tag TEXT,
  hash        TEXT NOT NULL,
  prev_hash   TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_chain ON messages(chain_id, block_num);
