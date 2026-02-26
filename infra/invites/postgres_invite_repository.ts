import type { Pool } from "pg";

import type {
  AcceptInviteInput,
  AcceptInviteOutcome,
  InviteRepository,
  InviteUser,
  PersistInviteForAdminInput,
  PersistInviteForAdminOutcome,
} from "../../app/invites/contracts.js";

export class PostgresInviteRepository implements InviteRepository {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<InviteUser | null> {
    const result = await this.pool.query<{
      id: string;
      status: "active" | "disabled";
    }>(
      `
      SELECT id, status
      FROM users
      WHERE email = $1
      LIMIT 1
      `,
      [email],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status,
    };
  }

  async persistInviteForAdmin(
    input: PersistInviteForAdminInput,
  ): Promise<PersistInviteForAdminOutcome> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      if (input.accessRequestId) {
        const accessRequestResult = await client.query(
          `
          UPDATE access_requests
          SET
            status = 'approved',
            handled_by_user_id = CASE
              WHEN access_requests.status IS DISTINCT FROM 'approved'
                OR access_requests.handled_by_user_id IS NULL
              THEN $2
              ELSE access_requests.handled_by_user_id
            END,
            handled_at = CASE
              WHEN access_requests.status IS DISTINCT FROM 'approved'
                OR access_requests.handled_at IS NULL
              THEN $3
              ELSE access_requests.handled_at
            END,
            updated_at = $3
          WHERE id = $1
          `,
          [input.accessRequestId, input.createdByUserId, input.handledAt],
        );

        if ((accessRequestResult.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          return { kind: "access_request_not_found" };
        }
      }

      await client.query(
        `
        INSERT INTO invites (
          email,
          token_hash,
          hash_version,
          created_by_user_id,
          created_at,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          input.email,
          input.tokenHash,
          input.hashVersion,
          input.createdByUserId,
          input.createdAt,
          input.expiresAt,
        ],
      );

      await client.query("COMMIT");
      return { kind: "created" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteOutcome> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const claimedInviteResult = await client.query<{
        id: string;
        email: string;
      }>(
        `
        UPDATE invites
        SET used_at = $2
        WHERE
          token_hash = $1
          AND used_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > $2
        RETURNING id, email
        `,
        [input.tokenHash, input.now],
      );

      const claimedInvite = claimedInviteResult.rows[0];
      if (!claimedInvite) {
        await client.query("ROLLBACK");
        return { kind: "invalid_or_expired_token" };
      }

      const createdUserResult = await client.query<{
        id: string;
        email: string;
        role: "user" | "admin";
        status: "active" | "disabled";
      }>(
        `
        INSERT INTO users (
          email,
          password_hash,
          role,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'user', 'active', $3, $3)
        ON CONFLICT DO NOTHING
        RETURNING id, email, role, status
        `,
        [claimedInvite.email, input.passwordHash, input.now],
      );

      const createdUser = createdUserResult.rows[0];
      if (!createdUser) {
        await client.query("ROLLBACK");
        return { kind: "user_exists" };
      }

      await client.query(
        `
        UPDATE invites
        SET used_by_user_id = $2
        WHERE id = $1
        `,
        [claimedInvite.id, createdUser.id],
      );

      await client.query("COMMIT");
      return {
        kind: "accepted",
        user: {
          id: createdUser.id,
          email: createdUser.email,
          role: createdUser.role,
          status: createdUser.status,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
