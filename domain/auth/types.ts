export type UserRole = "user" | "admin";
export type UserStatus = "active" | "disabled";

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
};

export type AuthenticatedSession = {
  sessionId: string;
  user: AuthUser;
  expiresAt: Date;
};
