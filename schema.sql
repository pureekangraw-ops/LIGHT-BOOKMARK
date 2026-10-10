-- LIGHT Bookmark is a pointer index, not a source of truth.
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notion_page_id TEXT NOT NULL,
  notion_url TEXT NOT NULL,
  cue TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_page ON bookmarks(notion_page_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_updated ON bookmarks(updated_at DESC);
