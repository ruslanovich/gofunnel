import type { Pool } from "pg";

import type {
  AuthRepository,
  CreateSessionInput,
  StoredSessionWithUser,
  StoredUserForLogin,
} from "../../app/auth/contracts.js";

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<StoredUserForLogin | null> {
    const result = await this.pool.query<{
      id: string;
      email: string;
      password_hash: string | null;
      role: "user" | "admin";
      status: "active" | "disabled";
    }>(
      `
      SELECT id, email, password_hash, role, status
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
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
      status: row.status,
    };
  }

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    const result = await this.pool.query<{ id: string }>(
      `
      INSERT INTO sessions (user_id, session_token_hash, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [
        input.userId,
        input.sessionTokenHash,
        input.expiresAt,
        input.ipAddress,
        input.userAgent,
      ],
    );

    return { sessionId: result.rows[0]?.id ?? "" };
  }

  async deleteSessionByTokenHash(sessionTokenHash: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM sessions
      WHERE session_token_hash = $1
      `,
      [sessionTokenHash],
    );
  }

  async findSessionByTokenHash(sessionTokenHash: string): Promise<StoredSessionWithUser | null> {
    const result = await this.pool.query<{
      session_id: string;
      session_token_hash: string;
      expires_at: Date;
      invalidated_at: Date | null;
      user_id: string;
      user_email: string;
      user_role: "user" | "admin";
      user_status: "active" | "disabled";
    }>(
      `
      SELECT
        s.id AS session_id,
        s.session_token_hash,
        s.expires_at,
        s.invalidated_at,
        u.id AS user_id,
        u.email AS user_email,
        u.role AS user_role,
        u.status AS user_status
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = $1
      LIMIT 1
      `,
      [sessionTokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      sessionTokenHash: row.session_token_hash,
      expiresAt: new Date(row.expires_at),
      invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null,
      user: {
        id: row.user_id,
        email: row.user_email,
        role: row.user_role,
        status: row.user_status,
      },
    };
  }

  async touchSessionLastSeen(sessionId: string, seenAt: Date): Promise<void> {
    await this.pool.query(
      `
      UPDATE sessions
      SET last_seen_at = $2
      WHERE id = $1
      `,
      [sessionId, seenAt],
    );
  }

  async touchUserLastLogin(userId: string, loggedInAt: Date): Promise<void> {
    await this.pool.query(
      `
      UPDATE users
      SET last_login_at = $2,
          updated_at = GREATEST(updated_at, $2)
      WHERE id = $1
      `,
      [userId, loggedInAt],
    );
  }
}
