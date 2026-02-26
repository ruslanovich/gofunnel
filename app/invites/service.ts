import { randomBytes } from "node:crypto";

import type { AuthUser } from "../../domain/auth/types.js";
import { hashPasswordArgon2id } from "../../infra/security/password.js";
import { hashOpaqueToken, TOKEN_HASH_VERSION } from "../../infra/security/token_hash.js";
import type { InviteRepository } from "./contracts.js";

const INVITE_TTL_DAYS = 7;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1_000;
export const INVITE_ACCEPT_MIN_PASSWORD_LENGTH = 12;

export class InviteValidationError extends Error {
  readonly code: "invalid_email" | "password_too_short";
  readonly httpStatus = 400;

  constructor(code: "invalid_email" | "password_too_short") {
    super(code);
    this.name = "InviteValidationError";
    this.code = code;
  }
}

export class InviteAdminError extends Error {
  readonly httpStatus: 404 | 409;
  readonly code: "access_request_not_found" | "user_exists";

  constructor(code: "access_request_not_found" | "user_exists") {
    super(code);
    this.name = "InviteAdminError";
    this.code = code;
    this.httpStatus = code === "user_exists" ? 409 : 404;
  }
}

export class InviteAcceptError extends Error {
  readonly httpStatus: 400 | 409;
  readonly code: "invalid_or_expired_token" | "user_exists";

  constructor(code: "invalid_or_expired_token" | "user_exists") {
    super(code);
    this.name = "InviteAcceptError";
    this.code = code;
    this.httpStatus = code === "user_exists" ? 409 : 400;
  }
}

export class InviteService {
  constructor(
    private readonly deps: {
      repository: InviteRepository;
      now?: () => Date;
      randomToken?: () => string;
      hashToken?: (token: string) => string;
      hashPassword?: (password: string) => Promise<string>;
    },
  ) {}

  async createInviteForAdmin(input: {
    email: string | null | undefined;
    accessRequestId?: string | null;
    createdByUserId: string;
  }): Promise<{ plaintextToken: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) {
      throw new InviteValidationError("invalid_email");
    }

    const existingUser = await this.deps.repository.findUserByEmail(email);
    if (existingUser?.status === "active") {
      throw new InviteAdminError("user_exists");
    }

    const now = this.deps.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const randomToken = this.deps.randomToken ?? (() => randomBytes(32).toString("base64url"));
    const hashToken = this.deps.hashToken ?? hashOpaqueToken;
    const plaintextToken = randomToken();

    if (!plaintextToken) {
      throw new Error("randomToken must return non-empty token");
    }

    const persisted = await this.deps.repository.persistInviteForAdmin({
      email,
      tokenHash: hashToken(plaintextToken),
      hashVersion: TOKEN_HASH_VERSION,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      expiresAt,
      accessRequestId: normalizeOptionalId(input.accessRequestId),
      handledAt: now,
    });

    if (persisted.kind === "access_request_not_found") {
      throw new InviteAdminError("access_request_not_found");
    }

    return {
      plaintextToken,
      expiresAt,
    };
  }

  async acceptInvite(input: {
    token: string | null | undefined;
    password: string | null | undefined;
  }): Promise<{ user: AuthUser }> {
    const token = normalizeToken(input.token);
    if (!token) {
      throw new InviteAcceptError("invalid_or_expired_token");
    }

    const password = input.password ?? "";
    if (password.length < INVITE_ACCEPT_MIN_PASSWORD_LENGTH) {
      throw new InviteValidationError("password_too_short");
    }

    const now = this.deps.now?.() ?? new Date();
    const hashToken = this.deps.hashToken ?? hashOpaqueToken;
    const hashPassword = this.deps.hashPassword ?? hashPasswordArgon2id;
    const outcome = await this.deps.repository.acceptInvite({
      tokenHash: hashToken(token),
      passwordHash: await hashPassword(password),
      now,
    });

    if (outcome.kind === "invalid_or_expired_token") {
      throw new InviteAcceptError("invalid_or_expired_token");
    }
    if (outcome.kind === "user_exists") {
      throw new InviteAcceptError("user_exists");
    }

    return {
      user: outcome.user,
    };
  }
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized === "" ? null : normalized;
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isValidEmail(email: string): boolean {
  if (email.length > 320) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
