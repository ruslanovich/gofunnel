import type { AuthUser } from "../../domain/auth/types.js";

export type StoredUserForLogin = AuthUser & {
  passwordHash: string | null;
};

export type StoredSessionWithUser = {
  sessionId: string;
  sessionTokenHash: string;
  expiresAt: Date;
  invalidatedAt: Date | null;
  user: AuthUser;
};

export type CreateSessionInput = {
  userId: string;
  sessionTokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export interface AuthRepository {
  findUserByEmail(email: string): Promise<StoredUserForLogin | null>;
  createSession(input: CreateSessionInput): Promise<{ sessionId: string }>;
  deleteSessionByTokenHash(sessionTokenHash: string): Promise<void>;
  findSessionByTokenHash(sessionTokenHash: string): Promise<StoredSessionWithUser | null>;
  touchSessionLastSeen(sessionId: string, seenAt: Date): Promise<void>;
  touchUserLastLogin(userId: string, loggedInAt: Date): Promise<void>;
}
