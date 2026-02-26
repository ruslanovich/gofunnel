export type CreateAccessRequestInput = {
  email: string;
  fullName: string | null;
  company: string | null;
  message: string | null;
};

export const ACCESS_REQUEST_TIME_GATE_MIN_MS = 3_000;
export const ACCESS_REQUEST_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
export const ACCESS_REQUEST_RATE_LIMIT_BUCKET_MS = 60 * 60 * 1_000;
export const ACCESS_REQUEST_RATE_LIMIT_RETENTION_DAYS = 14;
export const ACCESS_REQUEST_RATE_LIMIT_CLEANUP_EVERY_N_REQUESTS = 100;
export const ACCESS_REQUEST_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const ACCESS_REQUEST_RATE_LIMITS = {
  ipPerHour: 10,
  emailPerHour: 3,
} as const;

export type AccessRequestStatus = "new" | "contacted" | "approved" | "rejected";

export type CreatedAccessRequest = {
  id: string;
  status: AccessRequestStatus;
  createdAt: Date;
};

export type AdminAccessRequest = {
  id: string;
  email: string;
  fullName: string | null;
  company: string | null;
  message: string | null;
  status: AccessRequestStatus;
  handledByUserId: string | null;
  handledAt: Date | null;
  createdAt: Date;
};

export type PersistAccessRequestAttemptInput = CreateAccessRequestInput & {
  now: Date;
  ipHash: string | null;
  emailHash: string;
};

export type PersistAccessRequestAttemptOutcome =
  | {
      kind: "created";
      createdRequest: CreatedAccessRequest;
    }
  | {
      kind: "duplicate_24h";
    }
  | {
      kind: "rate_limited_ip";
    }
  | {
      kind: "rate_limited_email";
    };

export interface AccessRequestRepository {
  persistAccessRequestAttempt(
    input: PersistAccessRequestAttemptInput,
  ): Promise<PersistAccessRequestAttemptOutcome>;
  listForAdmin(input: { status?: AccessRequestStatus | null }): Promise<AdminAccessRequest[]>;
  updateStatusForAdmin(input: {
    id: string;
    status: AccessRequestStatus;
    handledByUserId: string;
    now: Date;
  }): Promise<AdminAccessRequest | null>;
}
