ALTER TABLE files
  ADD COLUMN storage_key_report TEXT,
  ADD COLUMN storage_key_raw_llm_output TEXT,
  ADD COLUMN prompt_version TEXT,
  ADD COLUMN schema_version TEXT,
  ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN processed_at TIMESTAMPTZ,
  ADD COLUMN queued_at TIMESTAMPTZ,
  ADD COLUMN started_at TIMESTAMPTZ;

ALTER TABLE files
  ADD CONSTRAINT files_processing_attempts_non_negative_chk
  CHECK (processing_attempts >= 0);

CREATE TABLE processing_jobs (
  id UUID PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  heartbeat_at TIMESTAMPTZ,
  lock_ttl_seconds INTEGER NOT NULL DEFAULT 300,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT processing_jobs_status_chk CHECK (
    status IN ('queued', 'processing', 'succeeded', 'failed')
  ),
  CONSTRAINT processing_jobs_attempts_non_negative_chk CHECK (attempts >= 0),
  CONSTRAINT processing_jobs_max_attempts_positive_chk CHECK (max_attempts > 0),
  CONSTRAINT processing_jobs_attempts_within_max_chk CHECK (attempts <= max_attempts),
  CONSTRAINT processing_jobs_lock_ttl_positive_chk CHECK (lock_ttl_seconds > 0),
  CONSTRAINT processing_jobs_lock_pair_chk CHECK (
    (locked_at IS NULL AND locked_by IS NULL)
    OR (locked_at IS NOT NULL AND locked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX processing_jobs_file_id_uidx
  ON processing_jobs (file_id);

CREATE INDEX processing_jobs_claim_ready_idx
  ON processing_jobs (status, next_run_at, id);
