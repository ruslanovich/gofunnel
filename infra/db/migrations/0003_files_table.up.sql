CREATE TABLE files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL,
  storage_key_original TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT files_extension_chk CHECK (extension IN ('txt', 'vtt')),
  CONSTRAINT files_status_chk CHECK (
    status IN ('uploaded', 'queued', 'processing', 'succeeded', 'failed')
  ),
  CONSTRAINT files_size_bytes_positive_chk CHECK (size_bytes > 0)
);

CREATE INDEX files_user_created_id_desc_idx
  ON files (user_id, created_at DESC, id DESC);

CREATE INDEX files_user_id_id_idx
  ON files (user_id, id);
