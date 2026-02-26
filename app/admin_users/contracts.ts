import type { UserRole, UserStatus } from "../../domain/auth/types.js";

export type AdminUserListItem = {
  id: string;
  createdAt: Date;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
};

export interface AdminUserRepository {
  listUsersForAdmin(): Promise<AdminUserListItem[]>;
  updateUserStatusForAdmin(input: {
    id: string;
    status: UserStatus;
    now: Date;
  }): Promise<AdminUserListItem | null>;
}
