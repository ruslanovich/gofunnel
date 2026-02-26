import type { Pool } from "pg";

import type { AdminUserListItem, AdminUserRepository } from "../../app/admin_users/contracts.js";
import type { UserStatus } from "../../domain/auth/types.js";

type AdminUserRow = {
  id: string;
  created_at: Date;
  email: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  last_login_at: Date | null;
};

export class PostgresAdminUserRepository implements AdminUserRepository {
  private disabledAtColumnExists: boolean | null = null;

  constructor(private readonly pool: Pool) {}

  async listUsersForAdmin(): Promise<AdminUserListItem[]> {
    const result = await this.pool.query<AdminUserRow>(
      `
      SELECT id, created_at, email, role, status, last_login_at
      FROM users
      ORDER BY created_at DESC, email ASC
      `,
    );

    return result.rows.map(mapAdminUserRow);
  }

  async updateUserStatusForAdmin(input: {
    id: string;
    status: UserStatus;
    now: Date;
  }): Promise<AdminUserListItem | null> {
    const hasDisabledAtColumn = await this.hasDisabledAtColumn();
    const result = hasDisabledAtColumn
      ? await this.pool.query<AdminUserRow>(
          `
          UPDATE users
          SET status = $2,
              disabled_at = CASE
                WHEN $2 = 'disabled' THEN COALESCE(disabled_at, $3)
                ELSE NULL
              END,
              updated_at = GREATEST(updated_at, $3)
          WHERE id = $1
          RETURNING id, created_at, email, role, status, last_login_at
          `,
          [input.id, input.status, input.now],
        )
      : await this.pool.query<AdminUserRow>(
          `
          UPDATE users
          SET status = $2,
              updated_at = GREATEST(updated_at, $3)
          WHERE id = $1
          RETURNING id, created_at, email, role, status, last_login_at
          `,
          [input.id, input.status, input.now],
        );

    const row = result.rows[0];
    return row ? mapAdminUserRow(row) : null;
  }

  private async hasDisabledAtColumn(): Promise<boolean> {
    if (this.disabledAtColumnExists !== null) {
      return this.disabledAtColumnExists;
    }

    const result = await this.pool.query<{ exists: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'disabled_at'
          AND table_schema = ANY(current_schemas(false))
      ) AS exists
      `,
    );

    this.disabledAtColumnExists = result.rows[0]?.exists === true;
    return this.disabledAtColumnExists;
  }
}

function mapAdminUserRow(row: AdminUserRow): AdminUserListItem {
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    email: row.email,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
  };
}
