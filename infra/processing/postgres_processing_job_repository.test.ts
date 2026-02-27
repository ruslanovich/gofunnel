import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { Pool } from "pg";

import { PostgresProcessingJobRepository } from "./postgres_processing_job_repository.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const openResources: Array<{ pool: Pool; schemaName: string }> = [];

afterEach(async () => {
  while (openResources.length > 0) {
    const resource = openResources.pop();
    if (!resource) {
      continue;
    }
    const quotedSchema = quoteIdentifier(resource.schemaName);
    await resource.pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await resource.pool.end();
  }
});

test(
  "stale locked queued job is reclaimable and claim sets file status to processing",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl, "DATABASE_URL is required for worker repository tests");

    const { pool, schemaName } = await createIsolatedSchema(databaseUrl);
    const repository = new PostgresProcessingJobRepository(pool, { schema: schemaName });

    const userId = "11111111-1111-4111-8111-111111111111";
    const fileId = "22222222-2222-4222-8222-222222222222";
    const jobId = "33333333-3333-4333-8333-333333333333";

    await seedUserFileAndJob(pool, {
      schemaName,
      userId,
      fileId,
      fileStatus: "queued",
      jobId,
      jobStatus: "queued",
      lockTtlSeconds: 10,
      lockedAgoSeconds: 60,
      heartbeatAgoSeconds: 60,
    });

    const claimed = await repository.claimReadyJob({ workerId: "worker-a" });
    assert.ok(claimed, "expected job to be claimed when heartbeat is stale");
    assert.equal(claimed.id, jobId);
    assert.equal(claimed.fileId, fileId);
    assert.equal(claimed.attempts, 1);

    const fileRow = await selectFileState(pool, schemaName, fileId);
    assert.equal(fileRow?.status, "processing");

    const jobRow = await selectJobState(pool, schemaName, jobId);
    assert.equal(jobRow?.status, "processing");
    assert.equal(jobRow?.locked_by, "worker-a");
    assert.ok(jobRow?.heartbeat_at instanceof Date);
  },
);

test(
  "non-stale locked queued job is not claimable",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl, "DATABASE_URL is required for worker repository tests");

    const { pool, schemaName } = await createIsolatedSchema(databaseUrl);
    const repository = new PostgresProcessingJobRepository(pool, { schema: schemaName });

    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const fileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const jobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await seedUserFileAndJob(pool, {
      schemaName,
      userId,
      fileId,
      fileStatus: "queued",
      jobId,
      jobStatus: "queued",
      lockTtlSeconds: 30,
      lockedAgoSeconds: 5,
      heartbeatAgoSeconds: 5,
    });

    const claimed = await repository.claimReadyJob({ workerId: "worker-b" });
    assert.equal(claimed, null);

    const fileRow = await selectFileState(pool, schemaName, fileId);
    assert.equal(fileRow?.status, "queued");

    const jobRow = await selectJobState(pool, schemaName, jobId);
    assert.equal(jobRow?.status, "queued");
    assert.equal(jobRow?.locked_by, "seed-worker");
  },
);

test(
  "status responsibility: claim marks file processing and success finalization marks file succeeded",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl, "DATABASE_URL is required for worker repository tests");

    const { pool, schemaName } = await createIsolatedSchema(databaseUrl);
    const repository = new PostgresProcessingJobRepository(pool, { schema: schemaName });

    const userId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const fileId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const jobId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    await seedUserFileAndJob(pool, {
      schemaName,
      userId,
      fileId,
      fileStatus: "queued",
      jobId,
      jobStatus: "queued",
      lockTtlSeconds: 30,
      lockedAgoSeconds: null,
      heartbeatAgoSeconds: null,
    });

    const claimed = await repository.claimReadyJob({ workerId: "worker-c" });
    assert.ok(claimed);
    assert.equal((await selectFileState(pool, schemaName, fileId))?.status, "processing");

    await repository.markSucceeded({
      jobId,
      fileId,
      workerId: "worker-c",
      attempts: claimed.attempts,
    });

    const fileRow = await selectFileState(pool, schemaName, fileId);
    assert.equal(fileRow?.status, "succeeded");
    assert.ok(fileRow?.processed_at instanceof Date);
    assert.equal(fileRow?.error_code, null);
    assert.equal(fileRow?.error_message, null);

    const jobRow = await selectJobState(pool, schemaName, jobId);
    assert.equal(jobRow?.status, "succeeded");
    assert.equal(jobRow?.locked_at, null);
    assert.equal(jobRow?.locked_by, null);
    assert.equal(jobRow?.heartbeat_at, null);
  },
);

test(
  "status responsibility: failed finalization marks both job and file failed and clears locks",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl, "DATABASE_URL is required for worker repository tests");

    const { pool, schemaName } = await createIsolatedSchema(databaseUrl);
    const repository = new PostgresProcessingJobRepository(pool, { schema: schemaName });

    const userId = "12345678-1234-4123-8123-123456789123";
    const fileId = "23456789-2345-4234-8234-234567891234";
    const jobId = "34567891-3456-4345-8345-345678912345";

    await seedUserFileAndJob(pool, {
      schemaName,
      userId,
      fileId,
      fileStatus: "queued",
      jobId,
      jobStatus: "queued",
      lockTtlSeconds: 30,
      lockedAgoSeconds: null,
      heartbeatAgoSeconds: null,
    });

    const claimed = await repository.claimReadyJob({ workerId: "worker-d" });
    assert.ok(claimed);

    await repository.markFailed({
      jobId,
      fileId,
      workerId: "worker-d",
      attempts: claimed.attempts,
      errorCode: "processing_failed",
      errorMessage: "line1\nline2",
    });

    const fileRow = await selectFileState(pool, schemaName, fileId);
    assert.equal(fileRow?.status, "failed");
    assert.equal(fileRow?.error_code, "processing_failed");
    assert.equal(fileRow?.error_message, "line1 line2");

    const jobRow = await selectJobState(pool, schemaName, jobId);
    assert.equal(jobRow?.status, "failed");
    assert.equal(jobRow?.locked_at, null);
    assert.equal(jobRow?.locked_by, null);
    assert.equal(jobRow?.heartbeat_at, null);
    assert.equal(jobRow?.last_error_code, "processing_failed");
    assert.equal(jobRow?.last_error_message, "line1 line2");
  },
);

async function createIsolatedSchema(databaseUrl: string): Promise<{
  pool: Pool;
  schemaName: string;
}> {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "gofunnel-worker-repository-test",
  });
  const schemaName = createTempSchemaName();
  const quotedSchema = quoteIdentifier(schemaName);
  openResources.push({ pool, schemaName });

  await pool.query(`CREATE SCHEMA ${quotedSchema}`);
  await pool.query(`
    CREATE TABLE ${quotedSchema}.users (
      id UUID PRIMARY KEY
    )
  `);
  await pool.query(`
    CREATE TABLE ${quotedSchema}.files (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES ${quotedSchema}.users (id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      processed_at TIMESTAMPTZ,
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      queued_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE ${quotedSchema}.processing_jobs (
      id UUID PRIMARY KEY,
      file_id UUID NOT NULL REFERENCES ${quotedSchema}.files (id) ON DELETE CASCADE,
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
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  return { pool, schemaName };
}

async function seedUserFileAndJob(
  pool: Pool,
  input: {
    schemaName: string;
    userId: string;
    fileId: string;
    fileStatus: string;
    jobId: string;
    jobStatus: string;
    lockTtlSeconds: number;
    lockedAgoSeconds: number | null;
    heartbeatAgoSeconds: number | null;
  },
): Promise<void> {
  const quotedSchema = quoteIdentifier(input.schemaName);
  await pool.query(
    `INSERT INTO ${quotedSchema}.users (id) VALUES ($1::uuid)`,
    [input.userId],
  );
  await pool.query(
    `
    INSERT INTO ${quotedSchema}.files (id, user_id, status, queued_at)
    VALUES ($1::uuid, $2::uuid, $3, NOW())
    `,
    [input.fileId, input.userId, input.fileStatus],
  );

  const lockedAtSql = input.lockedAgoSeconds == null
    ? "NULL"
    : `NOW() - INTERVAL '${Math.max(0, input.lockedAgoSeconds)} seconds'`;
  const heartbeatAtSql = input.heartbeatAgoSeconds == null
    ? "NULL"
    : `NOW() - INTERVAL '${Math.max(0, input.heartbeatAgoSeconds)} seconds'`;
  const lockedBy = input.lockedAgoSeconds == null ? null : "seed-worker";

  await pool.query(
    `
    INSERT INTO ${quotedSchema}.processing_jobs (
      id,
      file_id,
      status,
      attempts,
      next_run_at,
      locked_at,
      locked_by,
      heartbeat_at,
      lock_ttl_seconds
    )
    VALUES (
      $1::uuid,
      $2::uuid,
      $3,
      0,
      NOW() - INTERVAL '1 second',
      ${lockedAtSql},
      $4,
      ${heartbeatAtSql},
      $5
    )
    `,
    [input.jobId, input.fileId, input.jobStatus, lockedBy, input.lockTtlSeconds],
  );
}

async function selectFileState(
  pool: Pool,
  schemaName: string,
  fileId: string,
): Promise<{
  status: string;
  processed_at: Date | null;
  error_code: string | null;
  error_message: string | null;
} | null> {
  const quotedSchema = quoteIdentifier(schemaName);
  const result = await pool.query<{
    status: string;
    processed_at: Date | null;
    error_code: string | null;
    error_message: string | null;
  }>(
    `
    SELECT status, processed_at, error_code, error_message
    FROM ${quotedSchema}.files
    WHERE id = $1::uuid
    `,
    [fileId],
  );
  return result.rows[0] ?? null;
}

async function selectJobState(
  pool: Pool,
  schemaName: string,
  jobId: string,
): Promise<{
  status: string;
  locked_at: Date | null;
  locked_by: string | null;
  heartbeat_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
} | null> {
  const quotedSchema = quoteIdentifier(schemaName);
  const result = await pool.query<{
    status: string;
    locked_at: Date | null;
    locked_by: string | null;
    heartbeat_at: Date | null;
    last_error_code: string | null;
    last_error_message: string | null;
  }>(
    `
    SELECT
      status,
      locked_at,
      locked_by,
      heartbeat_at,
      last_error_code,
      last_error_message
    FROM ${quotedSchema}.processing_jobs
    WHERE id = $1::uuid
    `,
    [jobId],
  );
  return result.rows[0] ?? null;
}

function createTempSchemaName(): string {
  return `worker_repo_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
