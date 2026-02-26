import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "infra/db/migrations");

type MigrationDirection = "up" | "down";

type MigrationFile = {
  version: string;
  upPath: string;
  downPath: string;
};

function parseMigrationName(fileName: string): string | null {
  if (!fileName.endsWith(".up.sql")) {
    return null;
  }
  return fileName.slice(0, -".up.sql".length);
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const upFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .map(parseMigrationName)
    .filter((name): name is string => name !== null)
    .sort();

  return upFiles.map((version) => ({
    version,
    upPath: path.join(MIGRATIONS_DIR, `${version}.up.sql`),
    downPath: path.join(MIGRATIONS_DIR, `${version}.down.sql`),
  }));
}

async function ensureSchemaMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions(client: Client): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    `SELECT version FROM schema_migrations`,
  );
  return new Set(result.rows.map((row) => row.version));
}

async function applySqlWithBookkeeping(
  client: Client,
  direction: MigrationDirection,
  version: string,
  sql: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    if (direction === "up") {
      await client.query(
        `INSERT INTO schema_migrations (version) VALUES ($1)`,
        [version],
      );
    } else {
      await client.query(`DELETE FROM schema_migrations WHERE version = $1`, [
        version,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function migrateUp(client: Client): Promise<{
  applied: string[];
  skipped: string[];
}> {
  await ensureSchemaMigrationsTable(client);
  const migrations = await loadMigrationFiles();
  const appliedVersions = await getAppliedVersions(client);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }
    const sql = await readFile(migration.upPath, "utf8");
    await applySqlWithBookkeeping(client, "up", migration.version, sql);
    applied.push(migration.version);
  }

  return { applied, skipped };
}

export async function rollbackLast(
  client: Client,
  steps = 1,
): Promise<{ rolledBack: string[] }> {
  if (steps < 1) {
    throw new Error("steps must be >= 1");
  }
  await ensureSchemaMigrationsTable(client);
  const migrations = await loadMigrationFiles();
  const byVersion = new Map(migrations.map((m) => [m.version, m]));

  const result = await client.query<{ version: string }>(
    `
    SELECT version
    FROM schema_migrations
    ORDER BY applied_at DESC, version DESC
    LIMIT $1
    `,
    [steps],
  );

  const rolledBack: string[] = [];
  for (const row of result.rows) {
    const migration = byVersion.get(row.version);
    if (!migration) {
      throw new Error(`Missing local migration files for applied version ${row.version}`);
    }
    const sql = await readFile(migration.downPath, "utf8");
    await applySqlWithBookkeeping(client, "down", migration.version, sql);
    rolledBack.push(migration.version);
  }

  return { rolledBack };
}

export async function migrationStatus(client: Client): Promise<{
  applied: string[];
  pending: string[];
}> {
  await ensureSchemaMigrationsTable(client);
  const migrations = await loadMigrationFiles();
  const appliedVersions = await getAppliedVersions(client);

  const applied = migrations
    .map((m) => m.version)
    .filter((version) => appliedVersions.has(version));
  const pending = migrations
    .map((m) => m.version)
    .filter((version) => !appliedVersions.has(version));

  return { applied, pending };
}
