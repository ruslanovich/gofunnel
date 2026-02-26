CREATE TABLE access_request_rate_limit_buckets (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT access_request_rate_limit_buckets_scope_chk CHECK (scope IN ('ip', 'email')),
  CONSTRAINT access_request_rate_limit_buckets_subject_hash_len_chk CHECK (
    char_length(subject_hash) = 64
  ),
  CONSTRAINT access_request_rate_limit_buckets_hit_count_positive_chk CHECK (hit_count >= 1),
  PRIMARY KEY (scope, subject_hash, bucket_start)
);

CREATE INDEX access_request_rate_limit_buckets_bucket_start_idx
  ON access_request_rate_limit_buckets (bucket_start);
