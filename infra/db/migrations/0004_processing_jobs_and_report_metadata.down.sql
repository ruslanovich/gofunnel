DROP TABLE IF EXISTS processing_jobs;

ALTER TABLE files
  DROP CONSTRAINT IF EXISTS files_processing_attempts_non_negative_chk;

ALTER TABLE files
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS queued_at,
  DROP COLUMN IF EXISTS processed_at,
  DROP COLUMN IF EXISTS processing_attempts,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS prompt_version,
  DROP COLUMN IF EXISTS storage_key_raw_llm_output,
  DROP COLUMN IF EXISTS storage_key_report;
