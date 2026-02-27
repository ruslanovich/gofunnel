import { parseArgs } from "node:util";

import { createPgClient } from "../../infra/db/client.js";

const REQUIRED_PROCESSING_JOB_COLUMNS = [
  "id",
  "file_id",
  "status",
  "attempts",
  "max_attempts",
  "next_run_at",
  "locked_at",
  "locked_by",
  "heartbeat_at",
  "lock_ttl_seconds",
  "last_error_code",
  "last_error_message",
  "created_at",
  "updated_at",
] as const;

const REQUIRED_FILES_METADATA_COLUMNS = [
  "storage_key_report",
  "storage_key_raw_llm_output",
  "prompt_version",
  "schema_version",
  "processing_attempts",
  "processed_at",
  "queued_at",
  "started_at",
] as const;

const REQUIRED_PROCESSING_JOB_INDEXES = [
  "processing_jobs_pkey",
  "processing_jobs_file_id_uidx",
  "processing_jobs_claim_ready_idx",
] as const;

const REQUIRED_PROCESSING_JOB_CONSTRAINTS = [
  "processing_jobs_status_chk",
  "processing_jobs_attempts_non_negative_chk",
  "processing_jobs_max_attempts_positive_chk",
  "processing_jobs_attempts_within_max_chk",
  "processing_jobs_lock_ttl_positive_chk",
  "processing_jobs_lock_pair_chk",
] as const;

type VerificationReport = {
  ok: boolean;
  schema: string;
  present: {
    processingJobsColumns: string[];
    filesMetadataColumns: string[];
    processingJobsIndexes: string[];
    processingJobsConstraints: string[];
  };
  missing: {
    processingJobsColumns: string[];
    filesMetadataColumns: string[];
    processingJobsIndexes: string[];
    processingJobsConstraints: string[];
  };
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      schema: {
        type: "string",
        default: "public",
      },
    },
  });

  const schema = values.schema?.trim() || "public";
  const client = createPgClient();
  await client.connect();

  try {
    const processingJobsColumns = await fetchColumns(client, schema, "processing_jobs");
    const filesMetadataColumns = await fetchColumns(client, schema, "files");
    const processingJobsIndexes = await fetchIndexes(client, schema, "processing_jobs");
    const processingJobsConstraints = await fetchConstraints(client, schema, "processing_jobs");

    const report: VerificationReport = {
      ok: true,
      schema,
      present: {
        processingJobsColumns,
        filesMetadataColumns: filesMetadataColumns.filter((column) =>
          REQUIRED_FILES_METADATA_COLUMNS.includes(
            column as (typeof REQUIRED_FILES_METADATA_COLUMNS)[number],
          ),
        ),
        processingJobsIndexes,
        processingJobsConstraints,
      },
      missing: {
        processingJobsColumns: listMissing(
          REQUIRED_PROCESSING_JOB_COLUMNS,
          processingJobsColumns,
        ),
        filesMetadataColumns: listMissing(
          REQUIRED_FILES_METADATA_COLUMNS,
          filesMetadataColumns,
        ),
        processingJobsIndexes: listMissing(
          REQUIRED_PROCESSING_JOB_INDEXES,
          processingJobsIndexes,
        ),
        processingJobsConstraints: listMissing(
          REQUIRED_PROCESSING_JOB_CONSTRAINTS,
          processingJobsConstraints,
        ),
      },
    };

    report.ok = Object.values(report.missing).every((items) => items.length === 0);

    const output = JSON.stringify(report, null, 2);
    if (!report.ok) {
      console.error(output);
      process.exitCode = 1;
      return;
    }

    console.log(output);
  } finally {
    await client.end();
  }
}

async function fetchColumns(
  client: ReturnType<typeof createPgClient>,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
    `,
    [schema, table],
  );
  return result.rows.map((row) => row.column_name);
}

async function fetchIndexes(
  client: ReturnType<typeof createPgClient>,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ indexname: string }>(
    `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = $1
      AND tablename = $2
    ORDER BY indexname
    `,
    [schema, table],
  );
  return result.rows.map((row) => row.indexname);
}

async function fetchConstraints(
  client: ReturnType<typeof createPgClient>,
  schema: string,
  table: string,
): Promise<string[]> {
  const result = await client.query<{ conname: string }>(
    `
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t
      ON t.oid = c.conrelid
    JOIN pg_namespace n
      ON n.oid = t.relnamespace
    WHERE n.nspname = $1
      AND t.relname = $2
    ORDER BY c.conname
    `,
    [schema, table],
  );
  return result.rows.map((row) => row.conname);
}

function listMissing(required: readonly string[], actual: string[]): string[] {
  const actualSet = new Set(actual);
  return required.filter((item) => !actualSet.has(item));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
