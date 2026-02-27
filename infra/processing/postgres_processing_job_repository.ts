import type { Pool, PoolClient } from "pg";

import type { ProcessingJobQueueRepository } from "../../app/files/contracts.js";
import type { ProcessingPipelineFileRepository } from "../../app/processing/report_pipeline_processor.js";
import {
  sanitizeErrorCode,
  sanitizeErrorMessage,
  type ProcessingWorkerRepository,
  type QueuedProcessingJob,
} from "../../app/processing/worker.js";

type PostgresProcessingJobRepositoryOptions = {
  schema?: string;
};

export class PostgresProcessingJobRepository
  implements ProcessingWorkerRepository, ProcessingJobQueueRepository, ProcessingPipelineFileRepository
{
  private readonly filesTable: string;
  private readonly processingJobsTable: string;

  constructor(
    private readonly pool: Pool,
    options: PostgresProcessingJobRepositoryOptions = {},
  ) {
    const schema = options.schema?.trim() || "public";
    this.filesTable = qualifyTable(schema, "files");
    this.processingJobsTable = qualifyTable(schema, "processing_jobs");
  }

  async claimReadyJob(input: { workerId: string }): Promise<QueuedProcessingJob | null> {
    return this.withTransaction(async (client) => {
      const result = await client.query<{
        id: string;
        file_id: string;
        attempts: number;
        max_attempts: number;
        lock_ttl_seconds: number;
      }>(
        `
        WITH candidate AS (
          SELECT id
          FROM ${this.processingJobsTable}
          WHERE
            status = 'queued'
            AND next_run_at <= NOW()
            AND (
              locked_at IS NULL
              OR locked_by IS NULL
              OR COALESCE(heartbeat_at, locked_at) <= NOW() - (lock_ttl_seconds * INTERVAL '1 second')
            )
          ORDER BY next_run_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ),
        claimed AS (
          UPDATE ${this.processingJobsTable} jobs
          SET
            status = 'processing',
            locked_at = NOW(),
            locked_by = $1,
            heartbeat_at = NOW(),
            attempts = jobs.attempts + 1,
            updated_at = NOW()
          FROM candidate
          WHERE jobs.id = candidate.id
          RETURNING jobs.id, jobs.file_id, jobs.attempts, jobs.max_attempts, jobs.lock_ttl_seconds
        ),
        files_updated AS (
          UPDATE ${this.filesTable} files
          SET
            status = 'processing',
            error_code = NULL,
            error_message = NULL,
            started_at = COALESCE(files.started_at, NOW()),
            processing_attempts = claimed.attempts,
            updated_at = NOW()
          FROM claimed
          WHERE files.id = claimed.file_id
          RETURNING claimed.id AS job_id
        )
        SELECT claimed.id, claimed.file_id, claimed.attempts, claimed.max_attempts, claimed.lock_ttl_seconds
        FROM claimed
        JOIN files_updated
          ON files_updated.job_id = claimed.id
        `,
        [input.workerId],
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        fileId: row.file_id,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        lockTtlSeconds: row.lock_ttl_seconds,
      };
    });
  }

  async enqueueForFile(input: { fileId: string }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO ${this.processingJobsTable} (
        id,
        file_id,
        status,
        attempts,
        max_attempts,
        next_run_at,
        created_at,
        updated_at
      )
      VALUES (gen_random_uuid(), $1::uuid, 'queued', 0, 4, NOW(), NOW(), NOW())
      `,
      [input.fileId],
    );
  }

  async getFileContext(input: { fileId: string }): Promise<{
    fileId: string;
    userId: string;
    storageKeyOriginal: string;
  } | null> {
    const result = await this.pool.query<{
      id: string;
      user_id: string;
      storage_key_original: string;
    }>(
      `
      SELECT id, user_id, storage_key_original
      FROM ${this.filesTable}
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [input.fileId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      fileId: row.id,
      userId: row.user_id,
      storageKeyOriginal: row.storage_key_original,
    };
  }

  async saveReportMetadata(input: {
    fileId: string;
    storageKeyReport: string;
    promptVersion: string;
    schemaVersion: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE ${this.filesTable}
      SET
        storage_key_report = $2,
        prompt_version = $3,
        schema_version = $4,
        updated_at = NOW()
      WHERE id = $1::uuid
      `,
      [input.fileId, input.storageKeyReport, input.promptVersion, input.schemaVersion],
    );

    if ((result.rowCount ?? 0) !== 1) {
      throw new Error("file_report_metadata_update_failed");
    }
  }

  async saveRawMetadata(input: {
    fileId: string;
    storageKeyRawLlmOutput: string;
    promptVersion: string;
    schemaVersion: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE ${this.filesTable}
      SET
        storage_key_raw_llm_output = $2,
        prompt_version = $3,
        schema_version = $4,
        updated_at = NOW()
      WHERE id = $1::uuid
      `,
      [input.fileId, input.storageKeyRawLlmOutput, input.promptVersion, input.schemaVersion],
    );

    if ((result.rowCount ?? 0) !== 1) {
      throw new Error("file_raw_output_metadata_update_failed");
    }
  }

  async touchHeartbeat(input: { jobId: string; workerId: string }): Promise<void> {
    const result = await this.pool.query(
      `
      UPDATE ${this.processingJobsTable}
      SET
        heartbeat_at = NOW(),
        updated_at = NOW()
      WHERE
        id = $1::uuid
        AND status = 'processing'
        AND locked_by = $2
      `,
      [input.jobId, input.workerId],
    );

    if ((result.rowCount ?? 0) !== 1) {
      throw new Error("job_heartbeat_update_failed");
    }
  }

  async markSucceeded(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
  }): Promise<void> {
    await this.withTransaction(async (client) => {
      const jobResult = await client.query(
        `
        UPDATE ${this.processingJobsTable}
        SET
          status = 'succeeded',
          locked_at = NULL,
          locked_by = NULL,
          heartbeat_at = NULL,
          last_error_code = NULL,
          last_error_message = NULL,
          updated_at = NOW()
        WHERE
          id = $1::uuid
          AND status = 'processing'
          AND locked_by = $2
        `,
        [input.jobId, input.workerId],
      );

      if ((jobResult.rowCount ?? 0) !== 1) {
        throw new Error("job_mark_succeeded_failed");
      }

      const fileResult = await client.query(
        `
        UPDATE ${this.filesTable}
        SET
          status = 'succeeded',
          processed_at = NOW(),
          processing_attempts = $2,
          error_code = NULL,
          error_message = NULL,
          updated_at = NOW()
        WHERE id = $1::uuid
        `,
        [input.fileId, input.attempts],
      );

      if ((fileResult.rowCount ?? 0) !== 1) {
        throw new Error("file_mark_succeeded_failed");
      }
    });
  }

  async markFailed(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const sanitizedCode = sanitizeErrorCode(input.errorCode);
    const sanitizedMessage = sanitizeErrorMessage(input.errorMessage);

    await this.withTransaction(async (client) => {
      const jobResult = await client.query(
        `
        UPDATE ${this.processingJobsTable}
        SET
          status = 'failed',
          locked_at = NULL,
          locked_by = NULL,
          heartbeat_at = NULL,
          last_error_code = $3,
          last_error_message = $4,
          updated_at = NOW()
        WHERE
          id = $1::uuid
          AND status = 'processing'
          AND locked_by = $2
        `,
        [input.jobId, input.workerId, sanitizedCode, sanitizedMessage],
      );

      if ((jobResult.rowCount ?? 0) !== 1) {
        throw new Error("job_mark_failed_failed");
      }

      const fileResult = await client.query(
        `
        UPDATE ${this.filesTable}
        SET
          status = 'failed',
          processed_at = NOW(),
          processing_attempts = $2,
          error_code = $3,
          error_message = $4,
          updated_at = NOW()
        WHERE id = $1::uuid
        `,
        [input.fileId, input.attempts, sanitizedCode, sanitizedMessage],
      );

      if ((fileResult.rowCount ?? 0) !== 1) {
        throw new Error("file_mark_failed_failed");
      }
    });
  }

  async requeueWithBackoff(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    nextRunAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const sanitizedCode = sanitizeErrorCode(input.errorCode);
    const sanitizedMessage = sanitizeErrorMessage(input.errorMessage);

    await this.withTransaction(async (client) => {
      const jobResult = await client.query(
        `
        UPDATE ${this.processingJobsTable}
        SET
          status = 'queued',
          next_run_at = $3,
          locked_at = NULL,
          locked_by = NULL,
          heartbeat_at = NULL,
          last_error_code = $4,
          last_error_message = $5,
          updated_at = NOW()
        WHERE
          id = $1::uuid
          AND status = 'processing'
          AND locked_by = $2
        `,
        [input.jobId, input.workerId, input.nextRunAt.toISOString(), sanitizedCode, sanitizedMessage],
      );

      if ((jobResult.rowCount ?? 0) !== 1) {
        throw new Error("job_requeue_failed");
      }

      const fileResult = await client.query(
        `
        UPDATE ${this.filesTable}
        SET
          status = 'queued',
          queued_at = COALESCE(queued_at, NOW()),
          processing_attempts = $2,
          error_code = NULL,
          error_message = NULL,
          updated_at = NOW()
        WHERE id = $1::uuid
        `,
        [input.fileId, input.attempts],
      );

      if ((fileResult.rowCount ?? 0) !== 1) {
        throw new Error("file_requeue_failed");
      }
    });
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function qualifyTable(schema: string, tableName: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
