import type { Pool } from "pg";

import type { ReportShareRepository, StoredReportShare } from "../../app/shares/contracts.js";

export class PostgresReportShareRepository implements ReportShareRepository {
  constructor(private readonly pool: Pool) {}

  async findByTokenHash(tokenHash: string): Promise<StoredReportShare | null> {
    const result = await this.pool.query<{
      report_ref: string;
      expires_at: Date | null;
      revoked_at: Date | null;
    }>(
      `
      SELECT report_ref, expires_at, revoked_at
      FROM report_shares
      WHERE token_hash = $1
      LIMIT 1
      `,
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      reportRef: row.report_ref,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    };
  }
}
