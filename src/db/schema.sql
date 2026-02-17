-- Jung Bot v6 Schema

CREATE TABLE IF NOT EXISTS users (
  telegram_id   INTEGER PRIMARY KEY,
  username      TEXT,
  first_name    TEXT,
  tz_offset     INTEGER NOT NULL,          -- -11 ~ +12
  notify_hour   INTEGER NOT NULL,          -- 0~23 (local hour)
  lang          TEXT DEFAULT 'en',         -- telegram language_code
  wallet_address TEXT,                     -- CDP server wallet (auto-created)
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chains (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id    INTEGER NOT NULL REFERENCES users(telegram_id),
  creator_tz    INTEGER NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'text', -- text | story | photo
  chain_hour    INTEGER NOT NULL,             -- local hour of creation (floored)
  mission       TEXT,                         -- photo mission (photo mode only)
  start_utc     TEXT NOT NULL,
  status        TEXT DEFAULT 'active',        -- active | completed | delivered
  block_count   INTEGER DEFAULT 1,
  completed_at  TEXT,                         -- when chain completed
  deliver_at    TEXT,                         -- when to deliver result to creator
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blocks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id      INTEGER NOT NULL REFERENCES chains(id),
  slot_index    INTEGER NOT NULL,          -- 1~24
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  tz_offset     INTEGER NOT NULL,
  content       TEXT NOT NULL,             -- text/story content or photo caption
  media_url     TEXT,                      -- photo URL (photo mode)
  media_type    TEXT DEFAULT 'text',       -- text | photo
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(chain_id, slot_index)
);

CREATE TABLE IF NOT EXISTS translations (
  lang          TEXT NOT NULL,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (lang, key)
);

CREATE TABLE IF NOT EXISTS assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  chain_id      INTEGER NOT NULL REFERENCES chains(id),
  slot_index    INTEGER NOT NULL,
  message_id    INTEGER,                   -- telegram msg id (for auto-delete)
  chat_id       INTEGER,
  status        TEXT DEFAULT 'pending',    -- pending | writing | written | skipped | expired
  assigned_at   TEXT DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);
