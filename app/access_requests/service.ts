import type {
  AccessRequestRepository,
  AccessRequestStatus,
  AdminAccessRequest,
  CreatedAccessRequest,
} from "./contracts.js";
import { ACCESS_REQUEST_TIME_GATE_MIN_MS as TIME_GATE_MIN_MS } from "./contracts.js";

export type SubmitAccessRequestInput = {
  email: string | null | undefined;
  name?: string | null;
  company?: string | null;
  note?: string | null;
  website?: string | null;
  clientTs?: string | null;
  ipAddress?: string | null;
  now?: Date;
};

export type SubmitAccessRequestOutcome =
  | {
      kind: "accepted";
      mode: "created" | "duplicate_24h";
      createdRequest?: CreatedAccessRequest;
    }
  | {
      kind: "silent_drop";
      reason: "honeypot" | "time_gate";
    }
  | {
      kind: "rate_limited";
      reason: "rate_limited_ip" | "rate_limited_email";
    };

export class AccessRequestValidationError extends Error {
  readonly code: "invalid_email";
  readonly httpStatus = 400;

  constructor(code: "invalid_email") {
    super(code);
    this.name = "AccessRequestValidationError";
    this.code = code;
  }
}

export class AccessRequestAdminError extends Error {
  readonly httpStatus: 400 | 404;
  readonly code: "invalid_status" | "not_found";

  constructor(code: "invalid_status" | "not_found") {
    super(code);
    this.name = "AccessRequestAdminError";
    this.code = code;
    this.httpStatus = code === "not_found" ? 404 : 400;
  }
}

export class AccessRequestService {
  constructor(
    private readonly deps: {
      repository: AccessRequestRepository;
      hashRateLimitKey: (value: string) => string;
      now?: () => Date;
    },
  ) {}

  async submitRequest(input: SubmitAccessRequestInput): Promise<SubmitAccessRequestOutcome> {
    const email = normalizeEmail(input.email);
    if (!email || !isValidEmail(email)) {
      throw new AccessRequestValidationError("invalid_email");
    }

    if (normalizeOptionalText(input.website) !== null) {
      return {
        kind: "silent_drop",
        reason: "honeypot",
      };
    }

    const now = input.now ?? this.deps.now?.() ?? new Date();
    if (isTooFastSubmission(input.clientTs, now)) {
      return {
        kind: "silent_drop",
        reason: "time_gate",
      };
    }

    const persisted = await this.deps.repository.persistAccessRequestAttempt({
      now,
      ipHash: hashOptional(input.ipAddress, this.deps.hashRateLimitKey),
      emailHash: this.deps.hashRateLimitKey(email),
      email,
      fullName: normalizeOptionalText(input.name),
      company: normalizeOptionalText(input.company),
      message: normalizeOptionalText(input.note),
    });

    if (persisted.kind === "created") {
      return {
        kind: "accepted",
        mode: "created",
        createdRequest: persisted.createdRequest,
      };
    }

    if (persisted.kind === "duplicate_24h") {
      return {
        kind: "accepted",
        mode: "duplicate_24h",
      };
    }

    if (persisted.kind === "rate_limited_ip") {
      return {
        kind: "rate_limited",
        reason: "rate_limited_ip",
      };
    }

    return {
      kind: "rate_limited",
      reason: "rate_limited_email",
    };
  }

  async listForAdmin(input: { status?: string | null }): Promise<AdminAccessRequest[]> {
    const status = parseOptionalStatus(input.status);
    return this.deps.repository.listForAdmin({ status });
  }

  async updateStatusForAdmin(input: {
    id: string;
    status: string | null | undefined;
    handledByUserId: string;
    now?: Date;
  }): Promise<AdminAccessRequest> {
    const status = parseRequiredStatus(input.status);
    const now = input.now ?? this.deps.now?.() ?? new Date();
    const updated = await this.deps.repository.updateStatusForAdmin({
      id: input.id,
      status,
      handledByUserId: input.handledByUserId,
      now,
    });

    if (!updated) {
      throw new AccessRequestAdminError("not_found");
    }

    return updated;
  }
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized === "" ? null : normalized;
}

function hashOptional(
  value: string | null | undefined,
  hashRateLimitKey: (value: string) => string,
): string | null {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return null;
  }
  return hashRateLimitKey(normalized);
}

function isTooFastSubmission(clientTsRaw: string | null | undefined, now: Date): boolean {
  const clientTs = Number.parseInt((clientTsRaw ?? "").trim(), 10);
  if (!Number.isFinite(clientTs)) {
    return true;
  }

  const elapsedMs = now.getTime() - clientTs;
  return elapsedMs < TIME_GATE_MIN_MS;
}

function isValidEmail(email: string): boolean {
  if (email.length > 320) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseOptionalStatus(value: string | null | undefined): AccessRequestStatus | null {
  const normalized = (value ?? "").trim();
  if (normalized === "") {
    return null;
  }

  return parseAccessRequestStatus(normalized);
}

function parseRequiredStatus(value: string | null | undefined): AccessRequestStatus {
  const normalized = (value ?? "").trim();
  if (normalized === "") {
    throw new AccessRequestAdminError("invalid_status");
  }

  return parseAccessRequestStatus(normalized);
}

function parseAccessRequestStatus(value: string): AccessRequestStatus {
  if (value === "new" || value === "contacted" || value === "approved" || value === "rejected") {
    return value;
  }

  throw new AccessRequestAdminError("invalid_status");
}
