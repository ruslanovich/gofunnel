import type { Pool, PoolClient } from "pg";

import type {
  AccessRequestRepository,
  AccessRequestStatus,
  AdminAccessRequest,
  CreatedAccessRequest,
  PersistAccessRequestAttemptInput,
  PersistAccessRequestAttemptOutcome,
} from "../../app/access_requests/contracts.js";
import {
  ACCESS_REQUEST_DUPLICATE_WINDOW_MS,
  ACCESS_REQUEST_RATE_LIMIT_BUCKET_MS,
  ACCESS_REQUEST_RATE_LIMIT_CLEANUP_EVERY_N_REQUESTS,
  ACCESS_REQUEST_RATE_LIMIT_RETENTION_DAYS,
  ACCESS_REQUEST_RATE_LIMITS,
} from "../../app/access_requests/contracts.js";

let accessRequestCleanupTick = 0;

type RateLimitScope = "ip" | "email";

export class PostgresAccessRequestRepository implements AccessRequestRepository {
  constructor(private readonly pool: Pool) {}

  async persistAccessRequestAttempt(
    input: PersistAccessRequestAttemptInput,
  ): Promise<PersistAccessRequestAttemptOutcome> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      if (shouldRunRateLimitCleanup()) {
        await cleanupOldRateLimitBuckets(client, input.now);
      }

      const bucketStart = startOfBucket(input.now, ACCESS_REQUEST_RATE_LIMIT_BUCKET_MS);

      if (input.ipHash) {
        const ipHits = await incrementRateLimitBucket(client, {
          scope: "ip",
          subjectHash: input.ipHash,
          bucketStart,
          now: input.now,
        });
        if (ipHits > ACCESS_REQUEST_RATE_LIMITS.ipPerHour) {
          await client.query("COMMIT");
          return { kind: "rate_limited_ip" };
        }
      }

      const emailHits = await incrementRateLimitBucket(client, {
        scope: "email",
        subjectHash: input.emailHash,
        bucketStart,
        now: input.now,
      });
      if (emailHits > ACCESS_REQUEST_RATE_LIMITS.emailPerHour) {
        await client.query("COMMIT");
        return { kind: "rate_limited_email" };
      }

      const duplicateExists = await hasRecentDuplicateAccessRequest(client, input.email, input.now);
      if (duplicateExists) {
        await client.query("COMMIT");
        return { kind: "duplicate_24h" };
      }

      const createdRequest = await insertAccessRequest(client, input);
      await client.query("COMMIT");
      return { kind: "created", createdRequest };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listForAdmin(input: { status?: AccessRequestStatus | null }): Promise<AdminAccessRequest[]> {
    const result = input.status
      ? await this.pool.query<AccessRequestRow>(
          `
          SELECT id, email, full_name, company, message, status, handled_by_user_id, handled_at, created_at
          FROM access_requests
          WHERE status = $1
          ORDER BY created_at DESC
          `,
          [input.status],
        )
      : await this.pool.query<AccessRequestRow>(
          `
          SELECT id, email, full_name, company, message, status, handled_by_user_id, handled_at, created_at
          FROM access_requests
          ORDER BY created_at DESC
          `,
        );

    return result.rows.map(mapAccessRequestRow);
  }

  async updateStatusForAdmin(input: {
    id: string;
    status: AccessRequestStatus;
    handledByUserId: string;
    now: Date;
  }): Promise<AdminAccessRequest | null> {
    const result = await this.pool.query<AccessRequestRow>(
      `
      UPDATE access_requests
      SET
        status = $2,
        handled_by_user_id = CASE
          WHEN access_requests.status IS DISTINCT FROM $2 THEN $3
          ELSE handled_by_user_id
        END,
        handled_at = CASE
          WHEN access_requests.status IS DISTINCT FROM $2 THEN $4
          ELSE handled_at
        END,
        updated_at = $4
      WHERE id = $1
      RETURNING id, email, full_name, company, message, status, handled_by_user_id, handled_at, created_at
      `,
      [input.id, input.status, input.handledByUserId, input.now],
    );

    const row = result.rows[0];
    return row ? mapAccessRequestRow(row) : null;
  }
}

type AccessRequestRow = {
  id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  message: string | null;
  status: AccessRequestStatus;
  handled_by_user_id: string | null;
  handled_at: Date | null;
  created_at: Date;
};

function shouldRunRateLimitCleanup(): boolean {
  accessRequestCleanupTick += 1;
  return accessRequestCleanupTick % ACCESS_REQUEST_RATE_LIMIT_CLEANUP_EVERY_N_REQUESTS === 0;
}

function startOfBucket(value: Date, bucketMs: number): Date {
  const ts = value.getTime();
  return new Date(Math.floor(ts / bucketMs) * bucketMs);
}

async function cleanupOldRateLimitBuckets(client: PoolClient, now: Date): Promise<void> {
  const cutoff = new Date(
    now.getTime() - ACCESS_REQUEST_RATE_LIMIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );

  await client.query(
    `
    DELETE FROM access_request_rate_limit_buckets
    WHERE bucket_start < $1
    `,
    [cutoff],
  );
}

async function incrementRateLimitBucket(
  client: PoolClient,
  input: {
    scope: RateLimitScope;
    subjectHash: string;
    bucketStart: Date;
    now: Date;
  },
): Promise<number> {
  const result = await client.query<{ hit_count: number }>(
    `
    INSERT INTO access_request_rate_limit_buckets (
      scope,
      subject_hash,
      bucket_start,
      hit_count,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, 1, $4, $4)
    ON CONFLICT (scope, subject_hash, bucket_start)
    DO UPDATE
    SET
      hit_count = access_request_rate_limit_buckets.hit_count + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING hit_count
    `,
    [input.scope, input.subjectHash, input.bucketStart, input.now],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to upsert access request rate limit bucket");
  }

  return row.hit_count;
}

async function hasRecentDuplicateAccessRequest(
  client: PoolClient,
  email: string,
  now: Date,
): Promise<boolean> {
  const duplicateCutoff = new Date(now.getTime() - ACCESS_REQUEST_DUPLICATE_WINDOW_MS);
  const result = await client.query(
    `
    SELECT 1
    FROM access_requests
    WHERE email = $1
      AND status IN ('new', 'contacted', 'approved')
      AND created_at >= $2
    LIMIT 1
    `,
    [email, duplicateCutoff],
  );

  return (result.rowCount ?? 0) > 0;
}

async function insertAccessRequest(
  client: PoolClient,
  input: PersistAccessRequestAttemptInput,
): Promise<CreatedAccessRequest> {
  const result = await client.query<{
    id: string;
    status: "new" | "contacted" | "approved" | "rejected";
    created_at: Date;
  }>(
    `
    INSERT INTO access_requests (email, full_name, company, message)
    VALUES ($1, $2, $3, $4)
    RETURNING id, status, created_at
    `,
    [input.email, input.fullName, input.company, input.message],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Failed to create access request");
  }

  return {
    id: row.id,
    status: row.status,
    createdAt: new Date(row.created_at),
  };
}

function mapAccessRequestRow(row: AccessRequestRow): AdminAccessRequest {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    company: row.company,
    message: row.message,
    status: row.status,
    handledByUserId: row.handled_by_user_id,
    handledAt: row.handled_at ? new Date(row.handled_at) : null,
    createdAt: new Date(row.created_at),
  };
}
