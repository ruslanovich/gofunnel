import { hashOpaqueToken } from "../../infra/security/token_hash.js";
import type { ReportShareRepository } from "./contracts.js";

export class ShareAccessError extends Error {
  readonly code: "not_found" | "revoked";
  readonly httpStatus: 404 | 410;

  constructor(code: "not_found" | "revoked") {
    super(code);
    this.name = "ShareAccessError";
    this.code = code;
    this.httpStatus = code === "revoked" ? 410 : 404;
  }
}

export class ReportShareService {
  constructor(
    private readonly deps: {
      repository: ReportShareRepository;
      hashToken?: (token: string) => string;
      now?: () => Date;
    },
  ) {}

  async resolveShareByToken(input: {
    token: string | null | undefined;
  }): Promise<{ reportRef: string }> {
    const token = normalizeToken(input.token);
    if (!token) {
      throw new ShareAccessError("not_found");
    }

    const now = this.deps.now?.() ?? new Date();
    const hashToken = this.deps.hashToken ?? hashOpaqueToken;
    const share = await this.deps.repository.findByTokenHash(hashToken(token));

    if (!share) {
      throw new ShareAccessError("not_found");
    }

    if (share.revokedAt !== null) {
      throw new ShareAccessError("revoked");
    }

    if (share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime()) {
      throw new ShareAccessError("not_found");
    }

    return { reportRef: share.reportRef };
  }
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? "").trim();
}
