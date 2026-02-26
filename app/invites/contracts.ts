import type { AuthUser, UserStatus } from "../../domain/auth/types.js";

export type InviteUser = {
  id: string;
  status: UserStatus;
};

export type PersistInviteForAdminInput = {
  email: string;
  tokenHash: string;
  hashVersion: string;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  accessRequestId: string | null;
  handledAt: Date;
};

export type PersistInviteForAdminOutcome =
  | {
      kind: "created";
    }
  | {
      kind: "access_request_not_found";
    };

export type AcceptInviteInput = {
  tokenHash: string;
  passwordHash: string;
  now: Date;
};

export type AcceptInviteOutcome =
  | {
      kind: "accepted";
      user: AuthUser;
    }
  | {
      kind: "invalid_or_expired_token";
    }
  | {
      kind: "user_exists";
    };

export interface InviteRepository {
  findUserByEmail(email: string): Promise<InviteUser | null>;
  persistInviteForAdmin(input: PersistInviteForAdminInput): Promise<PersistInviteForAdminOutcome>;
  acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteOutcome>;
}
