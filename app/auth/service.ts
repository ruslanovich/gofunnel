import { randomBytes } from "node:crypto";

import type { AuthenticatedSession } from "../../domain/auth/types.js";
import { hashOpaqueToken } from "../../infra/security/token_hash.js";
import { verifyPasswordArgon2id } from "../../infra/security/password.js";
import type { AuthRepository } from "./contracts.js";

const SESSION_TTL_DAYS = 14;
export const SESSION_COOKIE_NAME = "session";
export const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

export type Clock = {
  now(): Date;
};

export class AuthError extends Error {
  constructor(
    public readonly code: "invalid_credentials" | "user_disabled",
    public readonly httpStatus: 401 | 403,
  ) {
    super(code);
  }
}

export type AuthServiceDeps = {
  repository: AuthRepository;
  clock?: Clock;
  verifyPassword?: (password: string, passwordHash: string) => Promise<boolean>;
  hashToken?: (token: string) => string;
  randomToken?: () => string;
};

export type LoginInput = {
  email: string;
  password: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type LoginResult = {
  opaqueSessionToken: string;
  session: AuthenticatedSession;
};

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly clock: Clock;
  private readonly verifyPassword: (password: string, passwordHash: string) => Promise<boolean>;
  private readonly hashToken: (token: string) => string;
  private readonly randomToken: () => string;

  constructor(deps: AuthServiceDeps) {
    this.repository = deps.repository;
    this.clock = deps.clock ?? { now: () => new Date() };
    this.verifyPassword = deps.verifyPassword ?? verifyPasswordArgon2id;
    this.hashToken = deps.hashToken ?? hashOpaqueToken;
    this.randomToken = deps.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const password = input.password;

    const user = await this.repository.findUserByEmail(email);
    if (!user?.passwordHash) {
      throw new AuthError("invalid_credentials", 401);
    }

    const passwordMatches = await this.verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AuthError("invalid_credentials", 401);
    }

    if (user.status === "disabled") {
      throw new AuthError("user_disabled", 403);
    }

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const opaqueSessionToken = this.randomToken();
    const sessionTokenHash = this.hashToken(opaqueSessionToken);
    const created = await this.repository.createSession({
      userId: user.id,
      sessionTokenHash,
      expiresAt,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    await this.repository.touchUserLastLogin(user.id, now);

    return {
      opaqueSessionToken,
      session: {
        sessionId: created.sessionId,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
        },
        expiresAt,
      },
    };
  }

  async logoutByOpaqueToken(opaqueSessionToken: string | null | undefined): Promise<void> {
    if (!opaqueSessionToken) {
      return;
    }

    const sessionTokenHash = this.hashToken(opaqueSessionToken);
    await this.repository.deleteSessionByTokenHash(sessionTokenHash);
  }

  async validateOpaqueSession(
    opaqueSessionToken: string | null | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!opaqueSessionToken) {
      return null;
    }

    const sessionTokenHash = this.hashToken(opaqueSessionToken);
    const stored = await this.repository.findSessionByTokenHash(sessionTokenHash);
    if (!stored) {
      return null;
    }

    const now = this.clock.now();
    if (stored.invalidatedAt) {
      return null;
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    if (stored.user.status === "disabled") {
      return null;
    }

    await this.repository.touchSessionLastSeen(stored.sessionId, now);

    return {
      sessionId: stored.sessionId,
      user: stored.user,
      expiresAt: stored.expiresAt,
    };
  }
}

function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}
