import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { Client } from "pg";

import { migrateUp } from "./migrator.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const PROCESSING_MIGRATION_VERSION = "0004_processing_jobs_and_report_metadata";
const PREVIOUS_VERSIONS = [
  "0001_epic1_identity_core",
  "0002_access_request_antispam",
  "0003_files_table",
] as const;

const openClients: Client[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    const client = openClients.pop();
    if (!client) {
      continue;
    }
    await client.end();
  }
});

test(
  "processing jobs schema supports enqueue, uniqueness by file_id, and queue indexes",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl, "DATABASE_URL is required for processing jobs schema test");

    const client = new Client({
      connectionString: databaseUrl,
      application_name: "gofunnel-processing-jobs-schema-test",
    });
    openClients.push(client);
    await client.connect();

    const schemaName = createTempSchemaName();
    const quotedSchemaName = quoteIdentifier(schemaName);
    await client.query(`CREATE SCHEMA ${quotedSchemaName}`);

    try {
      await client.query(`SET search_path TO ${quotedSchemaName}, public`);
      await client.query(`CREATE TABLE files (id UUID PRIMARY KEY)`);
      await client.query(`
        CREATE TABLE schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1), ($2), ($3)`,
        [...PREVIOUS_VERSIONS],
      );

      const upResult = await migrateUp(client);
      assert.deepEqual(upResult.applied, [PROCESSING_MIGRATION_VERSION]);

      const fileId = "11111111-1111-4111-8111-111111111111";
      const jobId = "22222222-2222-4222-8222-222222222222";
      await client.query(`INSERT INTO files (id) VALUES ($1::uuid)`, [fileId]);

      await client.query(
        `
        INSERT INTO processing_jobs (id, file_id, status)
        VALUES ($1::uuid, $2::uuid, 'queued')
        `,
        [jobId, fileId],
      );

      const jobResult = await client.query<{
        status: string;
        attempts: number;
        max_attempts: number;
        locked_at: Date | null;
        locked_by: string | null;
        heartbeat_at: Date | null;
        lock_ttl_seconds: number;
      }>(
        `
        SELECT
          status,
          attempts,
          max_attempts,
          locked_at,
          locked_by,
          heartbeat_at,
          lock_ttl_seconds
        FROM processing_jobs
        WHERE file_id = $1::uuid
        `,
        [fileId],
      );

      assert.equal(jobResult.rows.length, 1);
      assert.equal(jobResult.rows[0]?.status, "queued");
      assert.equal(jobResult.rows[0]?.attempts, 0);
      assert.equal(jobResult.rows[0]?.max_attempts, 4);
      assert.equal(jobResult.rows[0]?.locked_at, null);
      assert.equal(jobResult.rows[0]?.locked_by, null);
      assert.equal(jobResult.rows[0]?.heartbeat_at, null);
      assert.equal(jobResult.rows[0]?.lock_ttl_seconds, 300);

      await assert.rejects(
        async () => {
          await client.query(
            `
            INSERT INTO processing_jobs (id, file_id, status)
            VALUES ($1::uuid, $2::uuid, 'queued')
            `,
            ["33333333-3333-4333-8333-333333333333", fileId],
          );
        },
        (error: unknown) => isPgErrorWithCode(error, "23505"),
      );

      assert.ok(
        await hasIndex(client, schemaName, "processing_jobs_claim_ready_idx"),
        "claim-ready queue index must exist",
      );
      assert.ok(
        await hasIndex(client, schemaName, "processing_jobs_file_id_uidx"),
        "file_id unique lookup index must exist",
      );
      assert.ok(
        await hasConstraint(client, schemaName, "processing_jobs_status_chk"),
        "status check constraint must exist",
      );
      assert.ok(
        await hasConstraint(client, schemaName, "processing_jobs_attempts_non_negative_chk"),
        "attempts check constraint must exist",
      );
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    }
  },
);

function createTempSchemaName(): string {
  return `processing_jobs_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isPgErrorWithCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === expectedCode
  );
}

async function hasIndex(client: Client, schemaName: string, indexName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
    [`${schemaName}.${indexName}`],
  );
  return result.rows[0]?.exists === true;
}

async function hasConstraint(
  client: Client,
  schemaName: string,
  constraintName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_namespace n
        ON n.oid = c.connamespace
      WHERE n.nspname = $1
        AND c.conname = $2
    ) AS "exists"
    `,
    [schemaName, constraintName],
  );
  return result.rows[0]?.exists === true;
}
