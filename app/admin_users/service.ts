import type { UserStatus } from "../../domain/auth/types.js";
import type { AdminUserListItem, AdminUserRepository } from "./contracts.js";

export class AdminUserAdminError extends Error {
  readonly httpStatus: 400 | 404;
  readonly code: "invalid_status" | "not_found";

  constructor(code: "invalid_status" | "not_found") {
    super(code);
    this.name = "AdminUserAdminError";
    this.code = code;
    this.httpStatus = code === "not_found" ? 404 : 400;
  }
}

export class AdminUserService {
  constructor(
    private readonly deps: {
      repository: AdminUserRepository;
      now?: () => Date;
    },
  ) {}

  async listForAdmin(): Promise<AdminUserListItem[]> {
    return this.deps.repository.listUsersForAdmin();
  }

  async updateStatusForAdmin(input: {
    id: string;
    status: string | null | undefined;
    now?: Date;
  }): Promise<AdminUserListItem> {
    const status = parseRequiredUserStatus(input.status);
    const now = input.now ?? this.deps.now?.() ?? new Date();
    const updated = await this.deps.repository.updateUserStatusForAdmin({
      id: input.id,
      status,
      now,
    });

    if (!updated) {
      throw new AdminUserAdminError("not_found");
    }

    return updated;
  }
}

function parseRequiredUserStatus(value: string | null | undefined): UserStatus {
  const normalized = (value ?? "").trim();
  if (normalized === "active" || normalized === "disabled") {
    return normalized;
  }

  throw new AdminUserAdminError("invalid_status");
}
