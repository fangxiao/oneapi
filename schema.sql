CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  date TEXT NOT NULL,
  user TEXT NOT NULL,
  model TEXT NOT NULL,
  routed_model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  prompt TEXT DEFAULT '',
  status TEXT DEFAULT '200 OK',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_logs(date);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_logs(model);

CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  requests_total INTEGER DEFAULT 0,
  tokens_total INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cached_tokens INTEGER DEFAULT 0,
  reasoning_tokens INTEGER DEFAULT 0,
  data_json TEXT NOT NULL
);
