import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { Client } from "pg";

import { migrateUp, migrationStatus, rollbackLast } from "./migrator.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
const LATEST_MIGRATION_VERSION = "0004_processing_jobs_and_report_metadata";
const PREVIOUS_VERSIONS = ["0001_epic1_identity_core", "0002_access_request_antispam"] as const;

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
  "migration smoke: up/status/down applies and rolls back latest processing migration",
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl, "DATABASE_URL is required for migration smoke test");

    const client = new Client({
      connectionString: databaseUrl,
      application_name: "gofunnel-migrator-smoke-test",
    });
    openClients.push(client);
    await client.connect();

    const schemaName = createTempSchemaName();
    const quotedSchemaName = quoteIdentifier(schemaName);
    await client.query(`CREATE SCHEMA ${quotedSchemaName}`);

    try {
      await client.query(`SET search_path TO ${quotedSchemaName}, public`);
      await client.query(`CREATE TABLE users (id UUID PRIMARY KEY)`);
      await client.query(`
        CREATE TABLE schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1), ($2)`,
        [...PREVIOUS_VERSIONS],
      );

      const upResult = await migrateUp(client);
      assert.deepEqual(upResult.applied, ["0003_files_table", LATEST_MIGRATION_VERSION]);
      assert.ok(await hasTable(client, schemaName, "files"));
      assert.ok(await hasTable(client, schemaName, "processing_jobs"));
      assert.ok(await hasColumn(client, schemaName, "files", "storage_key_report"));
      assert.ok(await hasColumn(client, schemaName, "processing_jobs", "heartbeat_at"));

      const statusAfterUp = await migrationStatus(client);
      assert.ok(statusAfterUp.applied.includes(LATEST_MIGRATION_VERSION));
      assert.ok(!statusAfterUp.pending.includes(LATEST_MIGRATION_VERSION));

      const downResult = await rollbackLast(client, 1);
      assert.deepEqual(downResult.rolledBack, [LATEST_MIGRATION_VERSION]);
      assert.equal(await hasTable(client, schemaName, "processing_jobs"), false);
      assert.equal(await hasTable(client, schemaName, "files"), true);
      assert.equal(await hasColumn(client, schemaName, "files", "storage_key_report"), false);
      assert.equal(await hasColumn(client, schemaName, "processing_jobs", "heartbeat_at"), false);

      const statusAfterDown = await migrationStatus(client);
      assert.ok(!statusAfterDown.applied.includes(LATEST_MIGRATION_VERSION));
      assert.ok(statusAfterDown.pending.includes(LATEST_MIGRATION_VERSION));
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`);
    }
  },
);

function createTempSchemaName(): string {
  return `smoke_files_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function hasTable(client: Client, schemaName: string, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
    [`${schemaName}.${tableName}`],
  );
  return result.rows[0]?.exists === true;
}

async function hasColumn(
  client: Client,
  schemaName: string,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
        AND column_name = $3
    ) AS "exists"
    `,
    [schemaName, tableName, columnName],
  );
  return result.rows[0]?.exists === true;
}
