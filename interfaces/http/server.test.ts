import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";

import type {
  AdminUserListItem,
  AdminUserRepository,
} from "../../app/admin_users/contracts.js";
import { AdminUserService } from "../../app/admin_users/service.js";
import type {
  AccessRequestStatus,
  AdminAccessRequest,
  AccessRequestRepository,
  CreateAccessRequestInput,
  PersistAccessRequestAttemptInput,
  PersistAccessRequestAttemptOutcome,
} from "../../app/access_requests/contracts.js";
import { ACCESS_REQUEST_RATE_LIMITS as ACCESS_REQUEST_LIMITS } from "../../app/access_requests/contracts.js";
import { AccessRequestService } from "../../app/access_requests/service.js";
import type {
  AcceptInviteInput,
  AcceptInviteOutcome,
  InviteRepository,
  PersistInviteForAdminInput,
  PersistInviteForAdminOutcome,
} from "../../app/invites/contracts.js";
import { INVITE_TTL_MS, InviteService } from "../../app/invites/service.js";
import type {
  CreateProcessingFileInput,
  FileMetadataRepository,
  FileObjectStorage,
  FileRecord,
  ProcessingJobQueueRepository,
} from "../../app/files/contracts.js";
import {
  FILE_UPLOAD_MAX_BYTES,
  FileDetailsService,
  FileListService,
  FileReportService,
  FileUploadService,
} from "../../app/files/service.js";
import type { ReportShareRepository, StoredReportShare } from "../../app/shares/contracts.js";
import { ReportShareService } from "../../app/shares/service.js";
import type {
  AuthRepository,
  CreateSessionInput,
  StoredSessionWithUser,
  StoredUserForLogin,
} from "../../app/auth/contracts.js";
import { AuthService } from "../../app/auth/service.js";
import type { UserStatus } from "../../domain/auth/types.js";
import { createAuthHttpServer } from "./server.js";

const SITE_ORIGIN = "http://app.test";

type StoredSession = StoredSessionWithUser;

type InMemoryUserRecord = StoredUserForLogin & {
  createdAt: Date;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
};

class InMemoryAuthRepository implements AuthRepository, AdminUserRepository {
  users = new Map<string, InMemoryUserRecord>();
  sessions = new Map<string, StoredSession>();
  lastSeenTouches = 0;
  lastLoginTouches = 0;
  private sessionCounter = 0;

  async findUserByEmail(email: string): Promise<StoredUserForLogin | null> {
    const user = this.users.get(email);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role,
      status: user.status,
    };
  }

  async createSession(input: CreateSessionInput): Promise<{ sessionId: string }> {
    const user = this.findUserRecordById(input.userId);
    assert.ok(user, "user must exist before creating session");

    const sessionId = `s_${++this.sessionCounter}`;
    this.sessions.set(input.sessionTokenHash, {
      sessionId,
      sessionTokenHash: input.sessionTokenHash,
      expiresAt: input.expiresAt,
      invalidatedAt: null,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });

    return { sessionId };
  }

  async deleteSessionByTokenHash(sessionTokenHash: string): Promise<void> {
    this.sessions.delete(sessionTokenHash);
  }

  async findSessionByTokenHash(sessionTokenHash: string): Promise<StoredSessionWithUser | null> {
    const session = this.sessions.get(sessionTokenHash);
    if (!session) {
      return null;
    }

    const user = this.findUserRecordById(session.user.id);
    if (!user) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      sessionTokenHash: session.sessionTokenHash,
      expiresAt: new Date(session.expiresAt),
      invalidatedAt: session.invalidatedAt ? new Date(session.invalidatedAt) : null,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    };
  }

  async touchSessionLastSeen(): Promise<void> {
    this.lastSeenTouches += 1;
  }

  async touchUserLastLogin(userId: string, loggedInAt: Date): Promise<void> {
    const user = this.findUserRecordById(userId);
    assert.ok(user);
    user.lastLoginAt = new Date(loggedInAt);
    this.lastLoginTouches += 1;
  }

  async listUsersForAdmin(): Promise<AdminUserListItem[]> {
    return [...this.users.values()]
      .sort((a, b) => {
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return a.email.localeCompare(b.email);
      })
      .map((user) => ({
        id: user.id,
        createdAt: new Date(user.createdAt),
        email: user.email,
        role: user.role,
        status: user.status,
        lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
      }));
  }

  async updateUserStatusForAdmin(input: {
    id: string;
    status: UserStatus;
    now: Date;
  }): Promise<AdminUserListItem | null> {
    const user = this.findUserRecordById(input.id);
    if (!user) {
      return null;
    }

    user.status = input.status;
    user.disabledAt = input.status === "disabled" ? new Date(input.now) : null;

    return {
      id: user.id,
      createdAt: new Date(user.createdAt),
      email: user.email,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
    };
  }

  seedUser(user: StoredUserForLogin | InMemoryUserRecord): void {
    const maybeRecord = user as Partial<InMemoryUserRecord>;
    this.users.set(user.email, {
      ...user,
      createdAt: maybeRecord.createdAt ? new Date(maybeRecord.createdAt) : new Date(),
      lastLoginAt: maybeRecord.lastLoginAt ? new Date(maybeRecord.lastLoginAt) : null,
      disabledAt: maybeRecord.disabledAt
        ? new Date(maybeRecord.disabledAt)
        : user.status === "disabled"
          ? new Date()
          : null,
    });
  }

  seedSession(session: StoredSessionWithUser): void {
    this.sessions.set(session.sessionTokenHash, session);
  }

  private findUserRecordById(userId: string): InMemoryUserRecord | null {
    return [...this.users.values()].find((candidate) => candidate.id === userId) ?? null;
  }
}

type StoredAccessRequest = CreateAccessRequestInput & {
  id: string;
  status: AccessRequestStatus;
  handledByUserId: string | null;
  handledAt: Date | null;
  createdAt: Date;
};

type RateLimitBucket = {
  scope: "ip" | "email";
  subjectHash: string;
  bucketStartMs: number;
  hitCount: number;
};

class InMemoryAccessRequestRepository implements AccessRequestRepository {
  requests: StoredAccessRequest[] = [];
  rateLimitBuckets = new Map<string, RateLimitBucket>();
  private counter = 0;

  async persistAccessRequestAttempt(
    input: PersistAccessRequestAttemptInput,
  ): Promise<PersistAccessRequestAttemptOutcome> {
    const bucketStartMs = startOfHour(input.now).getTime();

    if (input.ipHash) {
      const ipHits = this.incrementBucket({
        scope: "ip",
        subjectHash: input.ipHash,
        bucketStartMs,
      });
      if (ipHits > ACCESS_REQUEST_LIMITS.ipPerHour) {
        return { kind: "rate_limited_ip" };
      }
    }

    const emailHits = this.incrementBucket({
      scope: "email",
      subjectHash: input.emailHash,
      bucketStartMs,
    });
    if (emailHits > ACCESS_REQUEST_LIMITS.emailPerHour) {
      return { kind: "rate_limited_email" };
    }

    const duplicateCutoffMs = input.now.getTime() - 24 * 60 * 60 * 1_000;
    const duplicate = this.requests.some(
      (candidate) =>
        candidate.email === input.email &&
        (candidate.status === "new" || candidate.status === "contacted" || candidate.status === "approved") &&
        candidate.createdAt.getTime() >= duplicateCutoffMs,
    );
    if (duplicate) {
      return { kind: "duplicate_24h" };
    }

    const created: StoredAccessRequest = {
      id: `ar_${++this.counter}`,
      email: input.email,
      fullName: input.fullName,
      company: input.company,
      message: input.message,
      status: "new",
      handledByUserId: null,
      handledAt: null,
      createdAt: new Date(input.now),
    };

    this.requests.push(created);

    return {
      kind: "created",
      createdRequest: {
        id: created.id,
        status: created.status,
        createdAt: created.createdAt,
      },
    };
  }

  async listForAdmin(input: { status?: AccessRequestStatus | null }): Promise<AdminAccessRequest[]> {
    return this.requests
      .filter((request) => (input.status ? request.status === input.status : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((request) => ({
        id: request.id,
        email: request.email,
        fullName: request.fullName,
        company: request.company,
        message: request.message,
        status: request.status,
        handledByUserId: request.handledByUserId,
        handledAt: request.handledAt ? new Date(request.handledAt) : null,
        createdAt: new Date(request.createdAt),
      }));
  }

  async updateStatusForAdmin(input: {
    id: string;
    status: AccessRequestStatus;
    handledByUserId: string;
    now: Date;
  }): Promise<AdminAccessRequest | null> {
    const request = this.requests.find((candidate) => candidate.id === input.id);
    if (!request) {
      return null;
    }

    if (request.status !== input.status) {
      request.status = input.status;
      request.handledByUserId = input.handledByUserId;
      request.handledAt = new Date(input.now);
    }

    return {
      id: request.id,
      email: request.email,
      fullName: request.fullName,
      company: request.company,
      message: request.message,
      status: request.status,
      handledByUserId: request.handledByUserId,
      handledAt: request.handledAt ? new Date(request.handledAt) : null,
      createdAt: new Date(request.createdAt),
    };
  }

  seedAccessRequest(
    input: Partial<StoredAccessRequest> & Pick<StoredAccessRequest, "email">,
  ): StoredAccessRequest {
    const created: StoredAccessRequest = {
      id: input.id ?? `ar_${++this.counter}`,
      email: input.email,
      fullName: input.fullName ?? null,
      company: input.company ?? null,
      message: input.message ?? null,
      status: input.status ?? "new",
      handledByUserId: input.handledByUserId ?? null,
      handledAt: input.handledAt ? new Date(input.handledAt) : null,
      createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
    };

    this.requests.push(created);
    return created;
  }

  seedRateLimitBucket(input: {
    scope: "ip" | "email";
    subjectHash: string;
    bucketStart: Date;
    hitCount: number;
  }): void {
    const bucketStartMs = input.bucketStart.getTime();
    this.rateLimitBuckets.set(this.bucketKey(input.scope, input.subjectHash, bucketStartMs), {
      scope: input.scope,
      subjectHash: input.subjectHash,
      bucketStartMs,
      hitCount: input.hitCount,
    });
  }

  private incrementBucket(input: {
    scope: "ip" | "email";
    subjectHash: string;
    bucketStartMs: number;
  }): number {
    const key = this.bucketKey(input.scope, input.subjectHash, input.bucketStartMs);
    const existing = this.rateLimitBuckets.get(key);
    if (existing) {
      existing.hitCount += 1;
      return existing.hitCount;
    }

    this.rateLimitBuckets.set(key, {
      scope: input.scope,
      subjectHash: input.subjectHash,
      bucketStartMs: input.bucketStartMs,
      hitCount: 1,
    });
    return 1;
  }

  private bucketKey(scope: "ip" | "email", subjectHash: string, bucketStartMs: number): string {
    return `${scope}:${subjectHash}:${bucketStartMs}`;
  }
}

type StoredInvite = {
  id: string;
  email: string;
  tokenHash: string;
  hashVersion: string;
  createdByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedByUserId: string | null;
  revokedAt: Date | null;
};

class InMemoryInviteRepository implements InviteRepository {
  invites: StoredInvite[] = [];
  private inviteCounter = 0;
  private acceptedUserCounter = 0;

  constructor(
    private readonly authRepository: InMemoryAuthRepository,
    private readonly accessRequestRepository: InMemoryAccessRequestRepository,
  ) {}

  async findUserByEmail(email: string): Promise<{ id: string; status: UserStatus } | null> {
    const user = this.authRepository.users.get(email);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      status: user.status,
    };
  }

  async persistInviteForAdmin(
    input: PersistInviteForAdminInput,
  ): Promise<PersistInviteForAdminOutcome> {
    if (input.accessRequestId) {
      const request = this.accessRequestRepository.requests.find(
        (candidate) => candidate.id === input.accessRequestId,
      );
      if (!request) {
        return { kind: "access_request_not_found" };
      }

      if (
        request.status !== "approved" ||
        request.handledByUserId === null ||
        request.handledAt === null
      ) {
        request.status = "approved";
        request.handledByUserId = input.createdByUserId;
        request.handledAt = new Date(input.handledAt);
      }
    }

    this.invites.push({
      id: `inv_${++this.inviteCounter}`,
      email: input.email,
      tokenHash: input.tokenHash,
      hashVersion: input.hashVersion,
      createdByUserId: input.createdByUserId,
      createdAt: new Date(input.createdAt),
      expiresAt: new Date(input.expiresAt),
      usedAt: null,
      usedByUserId: null,
      revokedAt: null,
    });

    return { kind: "created" };
  }

  async acceptInvite(input: AcceptInviteInput): Promise<AcceptInviteOutcome> {
    const invite = this.invites.find(
      (candidate) =>
        candidate.tokenHash === input.tokenHash &&
        candidate.usedAt === null &&
        candidate.revokedAt === null &&
        candidate.expiresAt.getTime() > input.now.getTime(),
    );

    if (!invite) {
      return { kind: "invalid_or_expired_token" };
    }

    const existingUser = this.authRepository.users.get(invite.email);
    if (existingUser) {
      return { kind: "user_exists" };
    }

    const createdUserId = `u_invite_${++this.acceptedUserCounter}`;
    this.authRepository.seedUser({
      id: createdUserId,
      email: invite.email,
      passwordHash: input.passwordHash,
      role: "user",
      status: "active",
      createdAt: new Date(input.now),
      lastLoginAt: null,
      disabledAt: null,
    });

    invite.usedAt = new Date(input.now);
    invite.usedByUserId = createdUserId;

    return {
      kind: "accepted",
      user: {
        id: createdUserId,
        email: invite.email,
        role: "user",
        status: "active",
      },
    };
  }

  seedInvite(input: {
    email: string;
    tokenHash: string;
    createdByUserId?: string;
    createdAt?: Date;
    expiresAt: Date;
    usedAt?: Date | null;
    usedByUserId?: string | null;
    revokedAt?: Date | null;
  }): StoredInvite {
    const created: StoredInvite = {
      id: `inv_${++this.inviteCounter}`,
      email: input.email,
      tokenHash: input.tokenHash,
      hashVersion: "hmac-sha256-v1",
      createdByUserId: input.createdByUserId ?? "admin_1",
      createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      expiresAt: new Date(input.expiresAt),
      usedAt: input.usedAt ? new Date(input.usedAt) : null,
      usedByUserId: input.usedByUserId ?? null,
      revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
    };
    this.invites.push(created);
    return created;
  }
}

type InMemoryStoredReportShare = {
  id: string;
  reportRef: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

class InMemoryReportShareRepository implements ReportShareRepository {
  shares: InMemoryStoredReportShare[] = [];
  private counter = 0;

  async findByTokenHash(tokenHash: string): Promise<StoredReportShare | null> {
    const share = this.shares.find((candidate) => candidate.tokenHash === tokenHash);
    if (!share) {
      return null;
    }

    return {
      reportRef: share.reportRef,
      expiresAt: share.expiresAt ? new Date(share.expiresAt) : null,
      revokedAt: share.revokedAt ? new Date(share.revokedAt) : null,
    };
  }

  seedShare(input: {
    reportRef: string;
    tokenHash: string;
    createdAt?: Date;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
  }): InMemoryStoredReportShare {
    const created: InMemoryStoredReportShare = {
      id: `shr_${++this.counter}`,
      reportRef: input.reportRef,
      tokenHash: input.tokenHash,
      createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
    };
    this.shares.push(created);
    return created;
  }
}

class InMemoryFileRepository implements FileMetadataRepository {
  rows: Array<
    FileRecord & {
      createdAt: Date;
      updatedAt: Date;
      storageKeyReport: string | null;
      processingAttempts: number;
      jobAttempts: number | null;
      jobMaxAttempts: number | null;
      jobNextRunAt: Date | null;
      jobLastErrorCode: string | null;
      jobLastErrorMessage: string | null;
    }
  > = [];
  failCreateProcessingOnce: Error | null = null;
  failMarkQueuedOnce: Error | null = null;
  failMarkFailedOnce: Error | null = null;

  async createProcessingFile(input: CreateProcessingFileInput): Promise<void> {
    if (this.failCreateProcessingOnce) {
      const error = this.failCreateProcessingOnce;
      this.failCreateProcessingOnce = null;
      throw error;
    }

    this.rows.push({
      ...input,
      status: "processing",
      errorCode: null,
      errorMessage: null,
      storageKeyReport: null,
      processingAttempts: 0,
      jobAttempts: null,
      jobMaxAttempts: null,
      jobNextRunAt: null,
      jobLastErrorCode: null,
      jobLastErrorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async markFileQueued(input: { id: string; userId: string }): Promise<void> {
    if (this.failMarkQueuedOnce) {
      const error = this.failMarkQueuedOnce;
      this.failMarkQueuedOnce = null;
      throw error;
    }

    const row = this.rows.find((candidate) => candidate.id === input.id && candidate.userId === input.userId);
    assert.ok(row, `expected file row ${input.id} to exist`);
    row.status = "queued";
    row.errorCode = null;
    row.errorMessage = null;
    row.updatedAt = new Date();
  }

  async markFileFailed(input: {
    id: string;
    userId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    if (this.failMarkFailedOnce) {
      const error = this.failMarkFailedOnce;
      this.failMarkFailedOnce = null;
      throw error;
    }

    const row = this.rows.find((candidate) => candidate.id === input.id && candidate.userId === input.userId);
    assert.ok(row, `expected file row ${input.id} to exist`);
    row.status = "failed";
    row.errorCode = input.errorCode;
    row.errorMessage = input.errorMessage;
    row.updatedAt = new Date();
  }

  async listFilesForUser(input: {
    userId: string;
    limit: number;
    cursor: { createdAt: Date; id: string } | null;
  }): Promise<
    Array<{
      id: string;
      originalFilename: string;
      extension: "txt" | "vtt";
      sizeBytes: number;
      status: "queued" | "processing" | "uploaded" | "succeeded" | "failed";
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const filtered = this.rows
      .filter((row) => row.userId === input.userId)
      .sort((a, b) => {
        const createdDiff = b.createdAt.getTime() - a.createdAt.getTime();
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return b.id.localeCompare(a.id);
      })
      .filter((row) => {
        if (!input.cursor) {
          return true;
        }

        const rowMs = row.createdAt.getTime();
        const cursorMs = input.cursor.createdAt.getTime();
        if (rowMs < cursorMs) {
          return true;
        }
        if (rowMs > cursorMs) {
          return false;
        }
        return row.id.localeCompare(input.cursor.id) < 0;
      })
      .slice(0, input.limit);

    return filtered.map((row) => ({
      id: row.id,
      originalFilename: row.originalFilename,
      extension: row.extension,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  async findFileForUser(input: {
    id: string;
    userId: string;
  }): Promise<{
    id: string;
    originalFilename: string;
    extension: "txt" | "vtt";
    sizeBytes: number;
    status: "queued" | "processing" | "uploaded" | "succeeded" | "failed";
    createdAt: Date;
    updatedAt: Date;
    processingAttempts: number;
    attempts: number | null;
    maxAttempts: number | null;
    nextRunAt: Date | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null> {
    const row = this.rows.find((candidate) => candidate.id === input.id && candidate.userId === input.userId);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      originalFilename: row.originalFilename,
      extension: row.extension,
      sizeBytes: row.sizeBytes,
      status: row.status,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      processingAttempts: row.processingAttempts,
      attempts: row.jobAttempts,
      maxAttempts: row.jobMaxAttempts,
      nextRunAt: row.jobNextRunAt ? new Date(row.jobNextRunAt) : null,
      lastErrorCode: row.jobLastErrorCode,
      lastErrorMessage: row.jobLastErrorMessage,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    };
  }

  async findFileReportForUser(input: {
    id: string;
    userId: string;
  }): Promise<{
    id: string;
    status: "queued" | "processing" | "uploaded" | "succeeded" | "failed";
    storageKeyReport: string | null;
  } | null> {
    const row = this.rows.find((candidate) => candidate.id === input.id && candidate.userId === input.userId);
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      status: row.status,
      storageKeyReport: row.storageKeyReport,
    };
  }
}

type PutObjectCall = {
  key: string;
  body: Buffer;
  contentType: string;
};

class InMemoryFileStorage implements FileObjectStorage {
  putCalls: PutObjectCall[] = [];
  deleteCalls: string[] = [];
  objects = new Map<string, Buffer>();
  failPutOnce: Error | null = null;
  failDeleteOnce: Error | null = null;
  failGetOnce: Error | null = null;

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.putCalls.push({ key, body, contentType });
    this.objects.set(key, body);

    if (this.failPutOnce) {
      const error = this.failPutOnce;
      this.failPutOnce = null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    this.deleteCalls.push(key);
    this.objects.delete(key);

    if (this.failDeleteOnce) {
      const error = this.failDeleteOnce;
      this.failDeleteOnce = null;
      throw error;
    }
  }

  async getObjectText(key: string): Promise<string> {
    if (this.failGetOnce) {
      const error = this.failGetOnce;
      this.failGetOnce = null;
      throw error;
    }

    const value = this.objects.get(key);
    if (!value) {
      throw new Error("s3_object_not_found");
    }

    return value.toString("utf8");
  }

  seedObjectText(key: string, value: string): void {
    this.objects.set(key, Buffer.from(value, "utf8"));
  }
}

type InMemoryProcessingJobRow = {
  id: string;
  fileId: string;
  status: "queued" | "processing" | "succeeded" | "failed";
  attempts: number;
  maxAttempts: number;
  nextRunAt: Date;
};

class InMemoryProcessingJobRepository implements ProcessingJobQueueRepository {
  rows: InMemoryProcessingJobRow[] = [];
  failEnqueueOnce: Error | null = null;
  private counter = 0;

  async enqueueForFile(input: { fileId: string }): Promise<void> {
    if (this.failEnqueueOnce) {
      const error = this.failEnqueueOnce;
      this.failEnqueueOnce = null;
      throw error;
    }

    if (this.rows.some((row) => row.fileId === input.fileId)) {
      throw createPgDuplicateViolationError("processing_jobs_file_id_uidx");
    }

    this.rows.push({
      id: `job_${++this.counter}`,
      fileId: input.fileId,
      status: "queued",
      attempts: 0,
      maxAttempts: 4,
      nextRunAt: new Date(),
    });
  }

  seedQueuedJob(input: { fileId: string }): void {
    if (this.rows.some((row) => row.fileId === input.fileId)) {
      return;
    }

    this.rows.push({
      id: `job_${++this.counter}`,
      fileId: input.fileId,
      status: "queued",
      attempts: 0,
      maxAttempts: 4,
      nextRunAt: new Date(),
    });
  }
}

const openServers = new Set<import("node:http").Server>();

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            openServers.delete(server);
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

function createHarness() {
  const repository = new InMemoryAuthRepository();
  const accessRequestRepository = new InMemoryAccessRequestRepository();
  const inviteRepository = new InMemoryInviteRepository(repository, accessRequestRepository);
  const reportShareRepository = new InMemoryReportShareRepository();
  const fileRepository = new InMemoryFileRepository();
  const fileStorage = new InMemoryFileStorage();
  const processingJobRepository = new InMemoryProcessingJobRepository();
  const fileLogs: Array<Record<string, unknown>> = [];
  let tokenCounter = 0;
  let inviteTokenCounter = 0;
  let fileIdCounter = 0;
  let inviteNow = new Date("2026-02-26T12:00:00.000Z");
  let shareNow = new Date("2026-02-27T10:00:00.000Z");
  const authService = new AuthService({
    repository,
    verifyPassword: async (password, passwordHash) =>
      password === passwordHash || passwordHash === `argon2:${password}`,
    hashToken: (token) => `hash:${token}`,
    randomToken: () => `opaque_${++tokenCounter}`,
  });
  const accessRequestService = new AccessRequestService({
    repository: accessRequestRepository,
    hashRateLimitKey: (value) => `hash:${value}`,
  });
  const adminUserService = new AdminUserService({
    repository,
  });
  const inviteService = new InviteService({
    repository: inviteRepository,
    hashToken: (token) => `hash:${token}`,
    hashPassword: async (password) => `argon2:${password}`,
    randomToken: () => `invite_${++inviteTokenCounter}`,
    now: () => new Date(inviteNow),
  });
  const reportShareService = new ReportShareService({
    repository: reportShareRepository,
    hashToken: (token) => `hash:${token}`,
    now: () => new Date(shareNow),
  });
  const fileUploadService = new FileUploadService({
    repository: fileRepository,
    jobQueueRepository: processingJobRepository,
    storage: fileStorage,
    storageBucket: "gofunnel-test-bucket",
    randomId: () => testUuid(++fileIdCounter),
    logEvent: (event, fields) => {
      fileLogs.push({ event, ...fields });
    },
  });
  const fileListService = new FileListService({
    repository: fileRepository,
  });
  const fileDetailsService = new FileDetailsService({
    repository: fileRepository,
  });
  const fileReportService = new FileReportService({
    repository: fileRepository,
    storage: fileStorage,
  });

  const server = createAuthHttpServer({
    authService,
    accessRequestService,
    adminUserService,
    inviteService,
    reportShareService,
    fileUploadService,
    fileListService,
    fileDetailsService,
    fileReportService,
    siteOrigin: SITE_ORIGIN,
    secureCookies: false,
  });
  openServers.add(server);

  return {
    repository,
    accessRequestRepository,
    inviteRepository,
    reportShareRepository,
    fileRepository,
    fileStorage,
    processingJobRepository,
    fileLogs,
    authService,
    adminUserService,
    setInviteNow(value: Date) {
      inviteNow = new Date(value);
    },
    setShareNow(value: Date) {
      shareNow = new Date(value);
    },
    async start() {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const address = server.address() as AddressInfo;
      return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        server,
      };
    },
  };
}

function seedUser(overrides: Partial<StoredUserForLogin> = {}): StoredUserForLogin {
  return {
    id: overrides.id ?? "u_1",
    email: overrides.email ?? "user@example.com",
    passwordHash: overrides.passwordHash ?? "secret-password",
    role: overrides.role ?? "user",
    status: overrides.status ?? "active",
  };
}

function seedAdminUserRecord(
  overrides: Partial<InMemoryUserRecord> = {},
): InMemoryUserRecord {
  const base = seedUser(overrides);
  return {
    ...base,
    createdAt: overrides.createdAt ? new Date(overrides.createdAt) : new Date(),
    lastLoginAt: overrides.lastLoginAt ? new Date(overrides.lastLoginAt) : null,
    disabledAt: overrides.disabledAt ? new Date(overrides.disabledAt) : base.status === "disabled" ? new Date() : null,
  };
}

function makeCookieValue(opaqueToken: string): string {
  return `session=${encodeURIComponent(opaqueToken)}`;
}

function makeAccessRequestBody(overrides: Record<string, string>): URLSearchParams {
  return new URLSearchParams({
    website: "",
    client_ts: String(Date.now() - 5_000),
    ...overrides,
  });
}

function makeMultipartUploadBody(input: {
  filename: string;
  content: Buffer | string;
  fieldName?: string;
  contentType?: string;
  boundary?: string;
}): { body: Buffer; contentType: string } {
  const fieldName = input.fieldName ?? "file";
  const partContentType = input.contentType ?? "text/plain";
  const boundary = input.boundary ?? "----gofunnel-upload-test-boundary";
  const contentBuffer = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, "utf8");
  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${input.filename}"\r\n` +
    `Content-Type: ${partContentType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;

  return {
    body: Buffer.concat([Buffer.from(header, "utf8"), contentBuffer, Buffer.from(footer, "utf8")]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function testUuid(counter: number): string {
  const suffix = counter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${suffix}`;
}

function seedAuthenticatedSession(
  harness: ReturnType<typeof createHarness>,
  userOverrides: Partial<StoredUserForLogin> = {},
  opaqueToken = "opaque_1",
): { user: StoredUserForLogin; cookie: string } {
  const user = seedUser({
    role: "user",
    status: "active",
    ...userOverrides,
  });
  harness.repository.seedUser(user);
  harness.repository.seedSession({
    sessionId: "s_1",
    sessionTokenHash: `hash:${opaqueToken}`,
    expiresAt: new Date(Date.now() + 60_000),
    invalidatedAt: null,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  });

  return { user, cookie: makeCookieValue(opaqueToken) };
}

function seedUploadedFileRow(
  harness: ReturnType<typeof createHarness>,
  input: {
    id: string;
    userId: string;
    originalFilename: string;
    extension: "txt" | "vtt";
    sizeBytes: number;
    createdAt: Date;
    updatedAt?: Date;
    status?: "uploaded" | "queued" | "processing" | "succeeded" | "failed";
    storageKeyReport?: string | null;
    processingAttempts?: number;
    attempts?: number | null;
    maxAttempts?: number | null;
    nextRunAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): void {
  const createdAt = new Date(input.createdAt);
  const status = input.status ?? "uploaded";
  harness.fileRepository.rows.push({
    id: input.id,
    userId: input.userId,
    storageBucket: "gofunnel-test-bucket",
    storageKeyOriginal: `users/${input.userId}/files/${input.id}/original.${input.extension}`,
    originalFilename: input.originalFilename,
    extension: input.extension,
    mimeType: input.extension === "vtt" ? "text/vtt" : "text/plain",
    sizeBytes: input.sizeBytes,
    status,
    storageKeyReport: input.storageKeyReport ?? null,
    processingAttempts: input.processingAttempts ?? 0,
    jobAttempts: input.attempts ?? null,
    jobMaxAttempts: input.maxAttempts ?? null,
    jobNextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : null,
    jobLastErrorCode: input.lastErrorCode ?? null,
    jobLastErrorMessage: input.lastErrorMessage ?? null,
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    createdAt,
    updatedAt: input.updatedAt ? new Date(input.updatedAt) : createdAt,
  });
}

type MockFetchExpectation = {
  url: string | RegExp;
  status: number;
  body?: unknown;
};

type FakeListener = (event: {
  target: unknown;
  key?: string;
  preventDefault: () => void;
}) => void;

class FakeHTMLElement {
  id = "";
  textContent = "";
  hidden = false;
  disabled = false;
  value = "";
  files: Array<{ name: string }> | null = null;
  tabIndex = 0;
  colSpan = 1;
  style: Record<string, string> = {};
  children: FakeHTMLElement[] = [];
  private listeners = new Map<string, FakeListener[]>();

  appendChild(child: FakeHTMLElement): FakeHTMLElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeHTMLElement[]): void {
    this.children = [...children];
  }

  addEventListener(type: string, listener: FakeListener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  trigger(type: string, event: Partial<Parameters<FakeListener>[0]> = {}): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener({
        target: this,
        preventDefault() {},
        ...event,
      });
    }
  }
}

class FakeHTMLFormElement extends FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLButtonElement extends FakeHTMLElement {}
class FakeHTMLTableSectionElement extends FakeHTMLElement {}

class FakeDocument {
  hidden = false;
  private listeners = new Map<string, FakeListener[]>();

  constructor(private readonly nodes: Map<string, FakeHTMLElement>) {}

  getElementById(id: string): FakeHTMLElement | null {
    return this.nodes.get(id) ?? null;
  }

  createElement(_tagName: string): FakeHTMLElement {
    return new FakeHTMLElement();
  }

  addEventListener(type: string, listener: FakeListener): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  trigger(type: string, event: Partial<Parameters<FakeListener>[0]> = {}): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener({
        target: this,
        preventDefault() {},
        ...event,
      });
    }
  }
}

class FakeFormData {
  append(): void {}
}

function extractInlineScript(html: string): string {
  const match = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, "expected /app page to include an inline script");
  const script = match[1];
  assert.ok(script, "expected inline script body");
  return script;
}

function createAppDashboardScriptHarness(input: {
  html: string;
  fetchExpectations: MockFetchExpectation[];
}): {
  statusNode: FakeHTMLElement;
  retryButton: FakeHTMLButtonElement;
  filesBody: FakeHTMLTableSectionElement;
  overlay: FakeHTMLElement;
  overlayTitle: FakeHTMLElement;
  overlayBadge: FakeHTMLElement;
  overlayStatus: FakeHTMLElement;
  overlayContent: FakeHTMLElement;
  overlayErrorSection: FakeHTMLElement;
  overlayErrorCode: FakeHTMLElement;
  overlayErrorMessage: FakeHTMLElement;
  overlayFooter: FakeHTMLElement;
  fetchCalls: string[];
  remainingFetchExpectations: () => number;
  lastAssignedLocation: () => string | null;
  clickFirstRow: () => void;
  closeOverlayByHeaderButton: () => void;
  closeOverlayByFooterButton: () => void;
  closeOverlayByBackdrop: () => void;
  closeOverlayByEscape: () => void;
  runTimeouts: (count?: number) => void;
  pendingTimeouts: () => number;
  flush: () => Promise<void>;
} {
  const script = extractInlineScript(input.html);

  const nodes = new Map<string, FakeHTMLElement>();
  const statusNode = new FakeHTMLElement();
  const retryButton = new FakeHTMLButtonElement();
  const uploadForm = new FakeHTMLFormElement();
  const uploadInput = new FakeHTMLInputElement();
  const uploadButton = new FakeHTMLButtonElement();
  const refreshButton = new FakeHTMLButtonElement();
  const loadMoreButton = new FakeHTMLButtonElement();
  const searchInput = new FakeHTMLInputElement();
  const statusFilter = new FakeHTMLElement();
  statusFilter.value = "all";
  const sortSelect = new FakeHTMLElement();
  sortSelect.value = "created_desc";
  const filesBody = new FakeHTMLTableSectionElement();
  const statTotal = new FakeHTMLElement();
  const statQueued = new FakeHTMLElement();
  const statProcessing = new FakeHTMLElement();
  const statReady = new FakeHTMLElement();
  const statFailed = new FakeHTMLElement();
  const overlay = new FakeHTMLElement();
  overlay.hidden = true;
  const overlayClose = new FakeHTMLButtonElement();
  const overlayCloseFooter = new FakeHTMLButtonElement();
  const overlayTitle = new FakeHTMLElement();
  const overlayBadge = new FakeHTMLElement();
  const overlayMetaUploaded = new FakeHTMLElement();
  const overlayMetaSize = new FakeHTMLElement();
  const overlayMetaFormat = new FakeHTMLElement();
  const overlayStatus = new FakeHTMLElement();
  const overlayStatusHint = new FakeHTMLElement();
  const overlayContent = new FakeHTMLElement();
  const overlayErrorSection = new FakeHTMLElement();
  const overlayErrorCode = new FakeHTMLElement();
  const overlayErrorMessage = new FakeHTMLElement();
  const overlayFooter = new FakeHTMLElement();

  nodes.set("app-files-status", statusNode);
  nodes.set("app-retry-button", retryButton);
  nodes.set("app-upload-form", uploadForm);
  nodes.set("app-upload-input", uploadInput);
  nodes.set("app-upload-button", uploadButton);
  nodes.set("app-refresh-button", refreshButton);
  nodes.set("app-load-more-button", loadMoreButton);
  nodes.set("app-search-input", searchInput);
  nodes.set("app-status-filter", statusFilter);
  nodes.set("app-sort-select", sortSelect);
  nodes.set("app-files-body", filesBody);
  nodes.set("app-stat-total", statTotal);
  nodes.set("app-stat-queued", statQueued);
  nodes.set("app-stat-processing", statProcessing);
  nodes.set("app-stat-ready", statReady);
  nodes.set("app-stat-failed", statFailed);
  nodes.set("app-file-overlay", overlay);
  nodes.set("app-file-overlay-close", overlayClose);
  nodes.set("app-file-overlay-close-footer", overlayCloseFooter);
  nodes.set("app-file-overlay-title", overlayTitle);
  nodes.set("app-file-overlay-badge", overlayBadge);
  nodes.set("app-file-overlay-meta-uploaded", overlayMetaUploaded);
  nodes.set("app-file-overlay-meta-size", overlayMetaSize);
  nodes.set("app-file-overlay-meta-format", overlayMetaFormat);
  nodes.set("app-file-overlay-status", overlayStatus);
  nodes.set("app-file-overlay-status-hint", overlayStatusHint);
  nodes.set("app-file-overlay-content", overlayContent);
  nodes.set("app-file-overlay-error-section", overlayErrorSection);
  nodes.set("app-file-overlay-error-code", overlayErrorCode);
  nodes.set("app-file-overlay-error-message", overlayErrorMessage);
  nodes.set("app-file-overlay-footer", overlayFooter);

  const document = new FakeDocument(nodes);
  const fetchCalls: string[] = [];
  const fetchExpectations = [...input.fetchExpectations];

  const fetchMock = async (
    requestUrl: string,
  ): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }> => {
    fetchCalls.push(requestUrl);
    const expected = fetchExpectations.shift();
    assert.ok(expected, `unexpected fetch request: ${requestUrl}`);
    if (typeof expected.url === "string") {
      assert.equal(requestUrl, expected.url);
    } else {
      assert.match(requestUrl, expected.url);
    }

    return {
      ok: expected.status >= 200 && expected.status < 300,
      status: expected.status,
      async json() {
        return expected.body;
      },
    };
  };

  const setIntervalCalls: Array<() => void> = [];
  let nextTimeoutId = 0;
  const timeoutCallbacks = new Map<number, () => void>();
  let assignedLocation: string | null = null;
  const locationObject = {
    href: "",
    assign(url: string): void {
      assignedLocation = url;
      locationObject.href = url;
    },
  };
  const windowObject = {
    setInterval(callback: () => void): number {
      setIntervalCalls.push(callback);
      return setIntervalCalls.length;
    },
    setTimeout(callback: () => void): number {
      nextTimeoutId += 1;
      timeoutCallbacks.set(nextTimeoutId, callback);
      return nextTimeoutId;
    },
    clearTimeout(timeoutId: number): void {
      timeoutCallbacks.delete(timeoutId);
    },
    location: locationObject,
  };

  runInNewContext(script, {
    console,
    document,
    window: windowObject,
    fetch: fetchMock,
    FormData: FakeFormData,
    HTMLElement: FakeHTMLElement,
    HTMLFormElement: FakeHTMLFormElement,
    HTMLInputElement: FakeHTMLInputElement,
    HTMLButtonElement: FakeHTMLButtonElement,
    HTMLTableSectionElement: FakeHTMLTableSectionElement,
  });

  return {
    statusNode,
    retryButton,
    filesBody,
    overlay,
    overlayTitle,
    overlayBadge,
    overlayStatus,
    overlayContent,
    overlayErrorSection,
    overlayErrorCode,
    overlayErrorMessage,
    overlayFooter,
    fetchCalls,
    remainingFetchExpectations: () => fetchExpectations.length,
    lastAssignedLocation: () => assignedLocation,
    clickFirstRow: () => {
      const firstRow = filesBody.children[0];
      assert.ok(firstRow, "expected at least one file row rendered");
      firstRow.trigger("click");
    },
    closeOverlayByHeaderButton: () => {
      overlayClose.trigger("click");
    },
    closeOverlayByFooterButton: () => {
      overlayCloseFooter.trigger("click");
    },
    closeOverlayByBackdrop: () => {
      overlay.trigger("click", { target: overlay });
    },
    closeOverlayByEscape: () => {
      document.trigger("keydown", { key: "Escape" });
    },
    runTimeouts: (count = 1) => {
      for (let index = 0; index < count; index += 1) {
        const firstEntry = timeoutCallbacks.entries().next();
        if (firstEntry.done) {
          return;
        }
        const [timeoutId, callback] = firstEntry.value;
        timeoutCallbacks.delete(timeoutId);
        callback();
      }
    },
    pendingTimeouts: () => timeoutCallbacks.size,
    flush: async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await Promise.resolve();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
      await Promise.resolve();
    },
  };
}

function startOfHour(value: Date): Date {
  const copy = new Date(value);
  copy.setMinutes(0, 0, 0);
  return copy;
}

test("login page renders RU form with request-access CTA", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/login`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1 class="gf-page-header__title">Вход в gofunnel<\/h1>/);
  assert.match(html, /id="login-status"/);
  assert.match(html, /id="login-form"/);
  assert.match(html, /method="post"/);
  assert.match(html, /action="\/api\/auth\/login"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, /id="login-submit"/);
  assert.match(html, /Нет доступа\?\s*<a href="\/request-access">Запросить доступ<\/a>/);
  assert.match(html, /Проверяем данные\.\.\./);
  assert.match(html, /Не удалось войти\. Проверьте эл\. почту и пароль\./);
});

test("login page keeps sanitized next path in hidden field", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/login?next=%2Fshare%2Fshare_token_1%3Fview%3Dcompact`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(
    html,
    /<input type="hidden" name="next" value="\/share\/share_token_1\?view=compact" \/>/,
  );
});

test("request-access page renders RU form with success and rate-limit states", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/request-access`);
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<h1 class="gf-page-header__title">Запрос доступа<\/h1>/);
  assert.match(html, /id="request-access-status"/);
  assert.match(html, /id="request-access-success"/);
  assert.match(html, /id="request-access-form"/);
  assert.match(html, /action="\/api\/access-requests"/);
  assert.match(html, /name="website"/);
  assert.match(html, /name="client_ts"/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="name"/);
  assert.match(html, /name="company"/);
  assert.match(html, /name="note"/);
  assert.match(html, /id="request-access-submit"/);
  assert.match(html, /Не удалось отправить заявку: слишком много попыток\. Попробуйте позже\./);
  assert.match(html, /<a href="\/login">Вернуться ко входу<\/a>/);
});

test("login success creates session and cookie", async () => {
  const harness = createHarness();
  harness.repository.seedUser(seedUser());
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: SITE_ORIGIN,
    },
    body: new URLSearchParams({
      email: "user@example.com",
      password: "secret-password",
    }),
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/app");
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\//i);
  assert.equal(harness.repository.sessions.size, 1);
  assert.equal(harness.repository.lastLoginTouches, 1);
});

test("login invalid credentials returns 401", async () => {
  const harness = createHarness();
  harness.repository.seedUser(seedUser());
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: SITE_ORIGIN },
    body: new URLSearchParams({ email: "user@example.com", password: "wrong" }),
  });

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "invalid_credentials");
  assert.equal(harness.repository.sessions.size, 0);
});

test("disabled user login blocked with 403", async () => {
  const harness = createHarness();
  harness.repository.seedUser(seedUser({ status: "disabled" }));
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: SITE_ORIGIN },
    body: new URLSearchParams({ email: "user@example.com", password: "secret-password" }),
  });

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "user_disabled");
  assert.equal(harness.repository.sessions.size, 0);
});

test("logout clears session", async () => {
  const harness = createHarness();
  harness.repository.seedUser(seedUser());
  const { baseUrl } = await harness.start();

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: SITE_ORIGIN },
    body: new URLSearchParams({ email: "user@example.com", password: "secret-password" }),
  });
  const setCookie = loginResponse.headers.get("set-cookie") ?? "";
  const cookieHeader = setCookie.split(";")[0] ?? "";
  assert.ok(cookieHeader.startsWith("session="));
  assert.equal(harness.repository.sessions.size, 1);

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookieHeader,
    },
    body: new URLSearchParams(),
  });

  assert.equal(logoutResponse.status, 303);
  assert.equal(logoutResponse.headers.get("location"), "/login");
  const clearCookie = logoutResponse.headers.get("set-cookie") ?? "";
  assert.match(clearCookie, /Max-Age=0/i);
  assert.equal(harness.repository.sessions.size, 0);
});

test("expired session rejected for /app", async () => {
  const harness = createHarness();
  const user = seedUser();
  harness.repository.seedUser(user);
  harness.repository.seedSession({
    sessionId: "s_expired",
    sessionTokenHash: "hash:expired_1",
    expiresAt: new Date(Date.now() - 60_000),
    invalidatedAt: null,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/app`, {
    redirect: "manual",
    headers: { Cookie: makeCookieValue("expired_1") },
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?next=%2Fapp");
  assert.equal(harness.repository.lastSeenTouches, 0);
});

test("authenticated /app renders files dashboard UI scaffold", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1 class="gf-page-header__title">Файлы<\/h1>/);
  assert.match(html, /Загрузки и результаты обработки\./);
  assert.match(html, /Обработанные транскрипты/);
  assert.match(html, /gf-shell/);
  assert.match(html, /id="app-upload-form"/);
  assert.match(html, /id="app-upload-input"/);
  assert.match(html, /accept="\.txt,\s*\.vtt"/);
  assert.match(html, /id="app-search-input"/);
  assert.match(html, /id="app-status-filter"/);
  assert.match(html, /id="app-sort-select"/);
  assert.match(html, /id="app-retry-button"/);
  assert.match(html, /Файлов пока нет/);
  assert.match(html, /Загрузите \.txt\/\.vtt, чтобы получить отчёт/);
  assert.match(html, /<th>Ошибка<\/th>/);
  assert.match(html, /<th>Длительность <span class="gf-col-hint">В разработке<\/span><\/th>/);
  assert.match(html, /id="app-files-table"/);
  assert.match(html, /id="app-file-overlay"/);
  assert.match(html, /id="app-file-overlay-badge"/);
  assert.match(html, /id="app-file-overlay-meta-uploaded"/);
  assert.match(html, /id="app-file-overlay-error-code"/);
  assert.match(html, /id="app-file-overlay-content"/);
  assert.match(html, /id="app-file-overlay-close-footer"/);
  assert.match(html, /\/api\/files\/upload/);
  assert.match(html, /\/api\/files\?limit=20/);
});

test("app dashboard shows RU error state and retry button when first list load fails", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 500,
        body: {
          error: "internal",
        },
      },
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [],
          next_cursor: null,
        },
      },
    ],
  });

  await dashboard.flush();
  assert.equal(dashboard.statusNode.textContent, "Не удалось загрузить список файлов.");
  assert.equal(dashboard.retryButton.hidden, false);

  dashboard.retryButton.trigger("click");
  await dashboard.flush();
  assert.equal(dashboard.retryButton.hidden, true);
  assert.equal(dashboard.statusNode.textContent, "Файлов пока нет.");
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("app succeeded file opens standalone report page directly", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              original_filename: "ready.txt",
              created_at: "2026-02-27T14:00:00.000Z",
              status: "succeeded",
              size_bytes: 123,
            },
          ],
          next_cursor: null,
        },
      },
    ],
  });

  await dashboard.flush();
  dashboard.clickFirstRow();
  await dashboard.flush();

  assert.equal(dashboard.overlay.hidden, true);
  assert.equal(
    dashboard.lastAssignedLocation(),
    "/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report",
  );
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("app overlay keeps processing state for non-succeeded file and does not redirect", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              original_filename: "processing.txt",
              created_at: "2026-02-27T14:00:00.000Z",
              status: "processing",
              size_bytes: 123,
            },
          ],
          next_cursor: null,
        },
      },
      {
        url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        status: 200,
        body: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          original_filename: "processing.txt",
          extension: "txt",
          size_bytes: 123,
          created_at: "2026-02-27T14:00:00.000Z",
          status: "processing",
          processing_attempts: 1,
          attempts: 1,
          max_attempts: 4,
          next_run_at: "2026-02-27T14:02:00.000Z",
          last_error_code: "llm_timeout",
          last_error_message: "timeout",
          error_code: null,
          error_message: null,
        },
      },
    ],
  });

  await dashboard.flush();
  dashboard.clickFirstRow();
  await dashboard.flush();

  assert.equal(dashboard.overlay.hidden, false);
  assert.equal(dashboard.overlayBadge.textContent, "В обработке");
  assert.equal(dashboard.overlayStatus.textContent, "Обрабатываем файл…");
  assert.equal(dashboard.lastAssignedLocation(), null);
  assert.match(dashboard.overlayContent.textContent, /Попытка:\s*1\/4/);
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("app overlay polls metadata and shows processing diagnostics until terminal state", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              original_filename: "processing.txt",
              created_at: "2026-02-27T14:00:00.000Z",
              status: "processing",
              size_bytes: 123,
            },
          ],
          next_cursor: null,
        },
      },
      {
        url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        status: 200,
        body: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          original_filename: "processing.txt",
          extension: "txt",
          size_bytes: 123,
          created_at: "2026-02-27T14:00:00.000Z",
          status: "processing",
          processing_attempts: 2,
          attempts: 2,
          max_attempts: 4,
          next_run_at: "2026-02-27T14:02:00.000Z",
          last_error_code: "llm_timeout",
          last_error_message: "timeout",
          error_code: null,
          error_message: null,
        },
      },
      {
        url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        status: 200,
        body: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          original_filename: "processing.txt",
          extension: "txt",
          size_bytes: 123,
          created_at: "2026-02-27T14:00:00.000Z",
          status: "failed",
          processing_attempts: 4,
          attempts: 4,
          max_attempts: 4,
          next_run_at: null,
          last_error_code: "llm_timeout",
          last_error_message: "timeout",
          error_code: "llm_timeout",
          error_message: "timed out after 180000ms",
        },
      },
    ],
  });

  await dashboard.flush();
  dashboard.clickFirstRow();
  await dashboard.flush();

  assert.equal(dashboard.overlay.hidden, false);
  assert.equal(dashboard.overlayStatus.textContent, "Обрабатываем файл…");
  assert.match(dashboard.overlayContent.textContent, /Попытка:\s*2\/4/);
  assert.match(dashboard.overlayContent.textContent, /Код последней ошибки:\s*llm_timeout/);
  assert.match(dashboard.overlayContent.textContent, /Следующий запуск:/);

  dashboard.runTimeouts();
  await dashboard.flush();

  assert.equal(dashboard.overlayStatus.textContent, "Ошибка обработки");
  assert.equal(dashboard.overlayErrorSection.hidden, false);
  assert.equal(dashboard.overlayErrorCode.textContent, "llm_timeout");
  assert.equal(dashboard.overlayErrorMessage.textContent, "timed out after 180000ms");
  assert.match(dashboard.overlayContent.textContent, /Попытка:\s*4\/4/);
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("app overlay shows RU not-found state when metadata endpoint returns 404", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              original_filename: "missing.txt",
              created_at: "2026-02-27T14:00:00.000Z",
              status: "processing",
              size_bytes: 123,
            },
          ],
          next_cursor: null,
        },
      },
      {
        url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        status: 404,
      },
    ],
  });

  await dashboard.flush();
  dashboard.clickFirstRow();
  await dashboard.flush();

  assert.equal(dashboard.overlay.hidden, false);
  assert.equal(dashboard.overlayBadge.textContent, "Недоступно");
  assert.equal(dashboard.overlayStatus.textContent, "Файл не найден");
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("app overlay renders failed error fields as plain text", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              original_filename: "failed.txt",
              created_at: "2026-02-27T14:00:00.000Z",
              status: "failed",
              size_bytes: 123,
            },
          ],
          next_cursor: null,
        },
      },
      {
        url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        status: 200,
        body: {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          original_filename: "failed.txt",
          extension: "txt",
          size_bytes: 123,
          created_at: "2026-02-27T14:00:00.000Z",
          status: "failed",
          processing_attempts: 3,
          attempts: 3,
          max_attempts: 4,
          next_run_at: null,
          last_error_code: "llm_timeout",
          last_error_message: "timeout",
          error_code: "<bad_code>",
          error_message: "<img src=x onerror=alert(1)>",
        },
      },
    ],
  });

  await dashboard.flush();
  dashboard.clickFirstRow();
  await dashboard.flush();

  assert.equal(dashboard.overlayStatus.textContent, "Ошибка обработки");
  assert.equal(dashboard.overlayErrorSection.hidden, false);
  assert.equal(dashboard.overlayErrorCode.textContent, "<bad_code>");
  assert.equal(dashboard.overlayErrorMessage.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("app overlay closes via all actions and clears polling timer", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(appResponse.status, 200);

  const processingPayload = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    original_filename: "processing.txt",
    extension: "txt",
    size_bytes: 123,
    created_at: "2026-02-27T14:00:00.000Z",
    status: "processing",
    processing_attempts: 1,
    attempts: 1,
    max_attempts: 4,
    next_run_at: "2026-02-27T14:01:00.000Z",
    last_error_code: null,
    last_error_message: null,
    error_code: null,
    error_message: null,
  };

  const dashboard = createAppDashboardScriptHarness({
    html: await appResponse.text(),
    fetchExpectations: [
      {
        url: "/api/files?limit=20",
        status: 200,
        body: {
          items: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
              original_filename: "processing.txt",
              created_at: "2026-02-27T14:00:00.000Z",
              status: "processing",
              size_bytes: 123,
            },
          ],
          next_cursor: null,
        },
      },
      { url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", status: 200, body: processingPayload },
      { url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", status: 200, body: processingPayload },
      { url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", status: 200, body: processingPayload },
      { url: "/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", status: 200, body: processingPayload },
    ],
  });

  await dashboard.flush();

  dashboard.clickFirstRow();
  await dashboard.flush();
  assert.equal(dashboard.overlay.hidden, false);
  assert.equal(dashboard.pendingTimeouts(), 1);
  dashboard.closeOverlayByHeaderButton();
  assert.equal(dashboard.overlay.hidden, true);
  assert.equal(dashboard.pendingTimeouts(), 0);

  dashboard.clickFirstRow();
  await dashboard.flush();
  assert.equal(dashboard.pendingTimeouts(), 1);
  dashboard.closeOverlayByFooterButton();
  assert.equal(dashboard.overlay.hidden, true);
  assert.equal(dashboard.pendingTimeouts(), 0);

  dashboard.clickFirstRow();
  await dashboard.flush();
  assert.equal(dashboard.pendingTimeouts(), 1);
  dashboard.closeOverlayByBackdrop();
  assert.equal(dashboard.overlay.hidden, true);
  assert.equal(dashboard.pendingTimeouts(), 0);

  dashboard.clickFirstRow();
  await dashboard.flush();
  assert.equal(dashboard.pendingTimeouts(), 1);
  dashboard.closeOverlayByEscape();
  assert.equal(dashboard.overlay.hidden, true);
  assert.equal(dashboard.pendingTimeouts(), 0);

  dashboard.runTimeouts(4);
  await dashboard.flush();
  assert.equal(dashboard.remainingFetchExpectations(), 0);
});

test("non-admin blocked from /admin/*", async () => {
  const harness = createHarness();
  const user = seedUser({ role: "user" });
  harness.repository.seedUser(user);
  harness.repository.seedSession({
    sessionId: "s_1",
    sessionTokenHash: "hash:opaque_1",
    expiresAt: new Date(Date.now() + 60_000),
    invalidatedAt: null,
    user: {
      id: user.id,
      email: user.email,
      role: "user",
      status: "active",
    },
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/admin/settings`, {
    redirect: "manual",
    headers: { Cookie: makeCookieValue("opaque_1") },
  });

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "admin_only");
});

test("admin /admin redirects to access requests page", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/admin`, {
    redirect: "manual",
    headers: { Cookie: makeCookieValue("opaque_1") },
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/admin/access-requests");
});

test("admin can list access requests via admin api with status filter", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_old",
    email: "first@example.com",
    fullName: "First",
    company: "Old Co",
    message: "Old note",
    status: "approved",
    handledByUserId: "admin_9",
    handledAt: new Date("2026-02-26T09:00:00.000Z"),
    createdAt: new Date("2026-02-26T08:00:00.000Z"),
  });
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_new",
    email: "second@example.com",
    fullName: "Second",
    company: "New Co",
    message: "Need access",
    status: "new",
    createdAt: new Date("2026-02-26T10:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/access-requests?status=new`, {
    headers: { Cookie: makeCookieValue("opaque_1") },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [
      {
        id: "ar_new",
        created_at: "2026-02-26T10:00:00.000Z",
        email: "second@example.com",
        name: "Second",
        company: "New Co",
        note: "Need access",
        status: "new",
        handled_by: null,
        handled_at: null,
      },
    ],
  });
});

test("admin access requests page renders v0-like controls, table and actions", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_1",
    email: "lead@example.com",
    status: "new",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/admin/access-requests`, {
    headers: { Cookie: makeCookieValue("opaque_1") },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Заявки на доступ/);
  assert.match(html, /id="admin-access-search"/);
  assert.match(html, /id="admin-access-status-filter"/);
  assert.match(html, /id="admin-access-visible-count"/);
  assert.match(html, /<th>Эл\. почта<\/th>/);
  assert.match(html, /<th>Имя<\/th>/);
  assert.match(html, /<th>Создано<\/th>/);
  assert.match(html, /<th>Статус<\/th>/);
  assert.match(html, /<th>Действия<\/th>/);
  assert.match(html, /Одобрить/);
  assert.match(html, /Отклонить/);
  assert.match(html, /Связались/);
  assert.match(html, /Создать приглашение/);
  assert.match(html, /access-request-invite-form/);
  assert.match(html, /access-request-copy-button/);
});

test("non-admin cannot list or patch admin access requests api", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "u_1",
    email: "user@example.com",
    role: "user",
  });
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_1",
    email: "lead@example.com",
  });
  const { baseUrl } = await harness.start();
  const cookie = makeCookieValue("opaque_1");

  const listResponse = await fetch(`${baseUrl}/api/admin/access-requests`, {
    headers: { Cookie: cookie },
  });
  assert.equal(listResponse.status, 403);
  assert.equal(await listResponse.text(), "admin_only");

  const patchResponse = await fetch(`${baseUrl}/api/admin/access-requests/ar_1`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "approved" }),
  });
  assert.equal(patchResponse.status, 403);
  assert.equal(await patchResponse.text(), "admin_only");
});

test("admin can transition access request status and handled fields are set", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(
    harness,
    {
      id: "admin_42",
      email: "admin@example.com",
      role: "admin",
    },
    "admin_token",
  );
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_1",
    email: "lead@example.com",
    fullName: "Lead",
    status: "new",
    createdAt: new Date("2026-02-26T10:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/access-requests/ar_1`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "contacted" }),
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    ok: boolean;
    item: { status: string; handled_by: string | null; handled_at: string | null };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.item.status, "contacted");
  assert.equal(payload.item.handled_by, user.id);
  assert.ok(payload.item.handled_at);

  const stored = harness.accessRequestRepository.requests.find((candidate) => candidate.id === "ar_1");
  assert.ok(stored);
  assert.equal(stored.status, "contacted");
  assert.equal(stored.handledByUserId, user.id);
  assert.ok(stored.handledAt instanceof Date);
});

test("admin patch rejects invalid access request status", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_1",
    email: "lead@example.com",
    status: "new",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/access-requests/ar_1`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "pending_review" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_status" });
  assert.equal(harness.accessRequestRepository.requests[0]?.status, "new");
});

test("admin patch returns 404 for unknown access request id", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/access-requests/ar_missing`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "approved" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("admin can create invite and only token hash is stored", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "  New.User@Example.COM  ",
    }),
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as { invite_link: string };
  assert.match(payload.invite_link, /^http:\/\/app\.test\/invite\//);
  const inviteToken = payload.invite_link.split("/invite/")[1];
  assert.ok(inviteToken);

  assert.equal(harness.inviteRepository.invites.length, 1);
  const storedInvite = harness.inviteRepository.invites[0];
  assert.equal(storedInvite?.email, "new.user@example.com");
  assert.equal(storedInvite?.tokenHash, `hash:${inviteToken}`);
  assert.notEqual(storedInvite?.tokenHash, inviteToken);
});

test("non-admin cannot create invite via admin api", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "u_1",
    email: "user@example.com",
    role: "user",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "lead@example.com",
    }),
  });

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "admin_only");
});

test("unauthenticated cannot create invite via admin api", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "lead@example.com",
    }),
  });

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "auth_required");
});

test("invite ttl is 7 days", async () => {
  const harness = createHarness();
  harness.setInviteNow(new Date("2026-03-10T12:34:56.000Z"));
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "lead@example.com",
    }),
  });

  assert.equal(response.status, 200);
  const storedInvite = harness.inviteRepository.invites[0];
  assert.ok(storedInvite);
  assert.equal(storedInvite.createdAt.toISOString(), "2026-03-10T12:34:56.000Z");
  assert.equal(storedInvite.expiresAt.getTime() - storedInvite.createdAt.getTime(), INVITE_TTL_MS);
  assert.equal(storedInvite.expiresAt.toISOString(), "2026-03-17T12:34:56.000Z");
});

test("create invite with access_request_id approves request and sets handled fields", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(
    harness,
    {
      id: "admin_42",
      email: "admin@example.com",
      role: "admin",
    },
    "admin_token",
  );
  harness.accessRequestRepository.seedAccessRequest({
    id: "ar_1",
    email: "lead@example.com",
    status: "new",
    handledByUserId: null,
    handledAt: null,
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "lead@example.com",
      access_request_id: "ar_1",
    }),
  });

  assert.equal(response.status, 200);
  const storedRequest = harness.accessRequestRepository.requests.find((candidate) => candidate.id === "ar_1");
  assert.ok(storedRequest);
  assert.equal(storedRequest.status, "approved");
  assert.equal(storedRequest.handledByUserId, user.id);
  assert.ok(storedRequest.handledAt instanceof Date);
});

test("create invite rejects invalid email", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "not-an-email",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_email" });
});

test("create invite returns 409 when active user already exists", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_existing",
      email: "existing@example.com",
      status: "active",
      role: "user",
    }),
  );
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/invites`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "existing@example.com",
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "user_exists" });
  assert.equal(harness.inviteRepository.invites.length, 0);
});

test("invite page renders minimal set-password form", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/invite/invite_token_1`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1 class="gf-page-header__title">Создание пароля<\/h1>/);
  assert.match(html, /name="password"/);
  assert.match(html, /name="token"/);
  assert.match(html, /invite_token_1/);
});

test("accept invite happy path creates user marks invite used issues session and allows /app", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();
  harness.inviteRepository.seedInvite({
    email: "invitee@example.com",
    tokenHash: "hash:invite_accept_1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const response = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "invite_accept_1",
      password: "VerySecure123",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    redirect_to: "/app",
  });

  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^session=/);
  const cookie = setCookie.split(";")[0] ?? "";

  const createdUser = harness.repository.users.get("invitee@example.com");
  assert.ok(createdUser);
  assert.equal(createdUser.role, "user");
  assert.equal(createdUser.status, "active");
  assert.equal(createdUser.passwordHash, "argon2:VerySecure123");

  const storedInvite = harness.inviteRepository.invites[0];
  assert.ok(storedInvite);
  assert.ok(storedInvite.usedAt instanceof Date);
  assert.equal(storedInvite.usedByUserId, createdUser.id);

  const appResponse = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(appResponse.status, 200);
});

test("accept invite cannot be reused after successful acceptance", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();
  harness.inviteRepository.seedInvite({
    email: "once@example.com",
    tokenHash: "hash:invite_once_1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const first = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "invite_once_1",
      password: "VerySecure123",
    }),
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "invite_once_1",
      password: "VerySecure123",
    }),
  });
  assert.equal(second.status, 400);
  assert.deepEqual(await second.json(), { error: "invalid_or_expired_token" });
});

test("accept invite blocks expired token", async () => {
  const harness = createHarness();
  harness.setInviteNow(new Date("2026-03-10T12:00:00.000Z"));
  const { baseUrl } = await harness.start();
  harness.inviteRepository.seedInvite({
    email: "expired@example.com",
    tokenHash: "hash:invite_expired_1",
    expiresAt: new Date("2026-03-10T11:59:59.000Z"),
  });

  const response = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "invite_expired_1",
      password: "VerySecure123",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_or_expired_token" });
});

test("accept invite blocks invalid token", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "does_not_exist",
      password: "VerySecure123",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_or_expired_token" });
});

test("accept invite returns 409 when invited email already exists", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_existing",
      email: "existing@example.com",
      passwordHash: "secret-password",
      role: "user",
      status: "active",
    }),
  );
  harness.inviteRepository.seedInvite({
    email: "existing@example.com",
    tokenHash: "hash:invite_user_exists_1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const response = await fetch(`${baseUrl}/api/auth/accept-invite`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token: "invite_user_exists_1",
      password: "VerySecure123",
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "user_exists" });
  assert.equal(harness.inviteRepository.invites[0]?.usedAt, null);
});

test("accept invite concurrent attempts allow only one success", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();
  harness.inviteRepository.seedInvite({
    email: "race@example.com",
    tokenHash: "hash:invite_race_1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const [first, second] = await Promise.all([
    fetch(`${baseUrl}/api/auth/accept-invite`, {
      method: "POST",
      headers: {
        Origin: SITE_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "invite_race_1",
        password: "VerySecure123",
      }),
    }),
    fetch(`${baseUrl}/api/auth/accept-invite`, {
      method: "POST",
      headers: {
        Origin: SITE_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: "invite_race_1",
        password: "VerySecure123",
      }),
    }),
  ]);

  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 400]);
  assert.equal(harness.repository.sessions.size, 1);
  assert.ok(harness.inviteRepository.invites[0]?.usedAt instanceof Date);
});

test("admin users page renders v0-like controls, table and inline actions", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_active",
      email: "active@example.com",
      status: "active",
    }),
  );
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_disabled",
      email: "disabled@example.com",
      status: "disabled",
      disabledAt: new Date("2026-02-26T10:00:00.000Z"),
    }),
  );
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/admin/users`, {
    headers: { Cookie: makeCookieValue("opaque_1") },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Пользователи/);
  assert.match(html, /id="admin-users-search"/);
  assert.match(html, /id="admin-users-role-filter"/);
  assert.match(html, /id="admin-users-status-filter"/);
  assert.match(html, /<th>Эл\. почта<\/th>/);
  assert.match(html, /<th>Роль<\/th>/);
  assert.match(html, /<th>Статус<\/th>/);
  assert.match(html, /<th>Создано<\/th>/);
  assert.match(html, /active@example\.com/);
  assert.match(html, /disabled@example\.com/);
  assert.match(html, /data-user-status-badge/);
  assert.match(html, />Отключить<\/button>/);
  assert.match(html, />Включить<\/button>/);
});

test("admin can list users via admin api", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_old",
      email: "old@example.com",
      role: "user",
      status: "disabled",
      createdAt: new Date("2026-02-26T08:00:00.000Z"),
      lastLoginAt: new Date("2026-02-25T10:00:00.000Z"),
      disabledAt: new Date("2026-02-26T09:00:00.000Z"),
    }),
  );
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_new",
      email: "new@example.com",
      role: "user",
      status: "active",
      createdAt: new Date("2026-02-26T12:00:00.000Z"),
      lastLoginAt: null,
      disabledAt: null,
    }),
  );
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: makeCookieValue("opaque_1") },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [
      {
        id: "admin_1",
        created_at: harness.repository.users.get("admin@example.com")?.createdAt.toISOString(),
        email: "admin@example.com",
        role: "admin",
        status: "active",
        last_login_at: null,
      },
      {
        id: "u_new",
        created_at: "2026-02-26T12:00:00.000Z",
        email: "new@example.com",
        role: "user",
        status: "active",
        last_login_at: null,
      },
      {
        id: "u_old",
        created_at: "2026-02-26T08:00:00.000Z",
        email: "old@example.com",
        role: "user",
        status: "disabled",
        last_login_at: "2026-02-25T10:00:00.000Z",
      },
    ],
  });
});

test("non-admin cannot list or patch admin users api", async () => {
  const harness = createHarness();
  seedAuthenticatedSession(harness, {
    id: "u_1",
    email: "user@example.com",
    role: "user",
  });
  harness.repository.seedUser(seedUser({ id: "u_2", email: "other@example.com" }));
  const { baseUrl } = await harness.start();
  const cookie = makeCookieValue("opaque_1");

  const listResponse = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: cookie },
  });
  assert.equal(listResponse.status, 403);
  assert.equal(await listResponse.text(), "admin_only");

  const patchResponse = await fetch(`${baseUrl}/api/admin/users/u_2`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(patchResponse.status, 403);
  assert.equal(await patchResponse.text(), "admin_only");
});

test("admin disable/enable user updates status and disabled user session fails on next /app request", async () => {
  const harness = createHarness();
  const { cookie: adminCookie } = seedAuthenticatedSession(
    harness,
    {
      id: "admin_1",
      email: "admin@example.com",
      role: "admin",
    },
    "admin_token",
  );
  harness.repository.seedUser(
    seedAdminUserRecord({
      id: "u_member",
      email: "member@example.com",
      passwordHash: "secret-password",
      role: "user",
      status: "active",
      createdAt: new Date("2026-02-26T11:00:00.000Z"),
    }),
  );
  const { baseUrl } = await harness.start();

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: { Origin: SITE_ORIGIN },
    body: new URLSearchParams({
      email: "member@example.com",
      password: "secret-password",
    }),
  });
  assert.equal(loginResponse.status, 303);
  const userCookie = (loginResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  assert.ok(userCookie.startsWith("session="));

  const appBeforeDisable = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(appBeforeDisable.status, 200);

  const disableResponse = await fetch(`${baseUrl}/api/admin/users/u_member`, {
    method: "PATCH",
    headers: {
      Cookie: adminCookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "disabled" }),
  });
  assert.equal(disableResponse.status, 200);
  assert.equal(harness.repository.users.get("member@example.com")?.status, "disabled");
  assert.ok(harness.repository.users.get("member@example.com")?.disabledAt instanceof Date);

  const appAfterDisable = await fetch(`${baseUrl}/app`, {
    headers: { Cookie: userCookie },
    redirect: "manual",
  });
  assert.equal(appAfterDisable.status, 303);
  assert.equal(appAfterDisable.headers.get("location"), "/login?next=%2Fapp");

  const enableResponse = await fetch(`${baseUrl}/api/admin/users/u_member`, {
    method: "PATCH",
    headers: {
      Cookie: adminCookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(enableResponse.status, 200);
  assert.equal(harness.repository.users.get("member@example.com")?.status, "active");
  assert.equal(harness.repository.users.get("member@example.com")?.disabledAt, null);
});

test("admin patch rejects invalid user status", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  harness.repository.seedUser(seedUser({ id: "u_2", email: "other@example.com" }));
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/users/u_2`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "paused" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_status" });
  assert.equal(harness.repository.users.get("other@example.com")?.status, "active");
});

test("admin patch returns 404 for unknown user id", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "admin_1",
    email: "admin@example.com",
    role: "admin",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/admin/users/u_missing`, {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      Origin: SITE_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "disabled" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
});

test("unauthenticated /app redirects to /login with next", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/app`, {
    redirect: "manual",
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?next=%2Fapp");
});

test("unauthenticated /share/<token> redirects to /login with next", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/share/share_token_1`, {
    redirect: "manual",
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?next=%2Fshare%2Fshare_token_1");
});

test("share login redirect preserves exact next path after authentication", async () => {
  const harness = createHarness();
  harness.repository.seedUser(
    seedUser({
      email: "member@example.com",
      passwordHash: "member-password",
    }),
  );
  harness.reportShareRepository.seedShare({
    reportRef: "report_login_redirect_1",
    tokenHash: "hash:share_login_redirect_1",
    expiresAt: new Date("2026-03-01T00:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const requestedPath = "/share/share_login_redirect_1?view=compact";
  const shareResponse = await fetch(`${baseUrl}${requestedPath}`, {
    redirect: "manual",
  });
  assert.equal(shareResponse.status, 303);
  assert.equal(
    shareResponse.headers.get("location"),
    "/login?next=%2Fshare%2Fshare_login_redirect_1%3Fview%3Dcompact",
  );

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: SITE_ORIGIN,
    },
    body: new URLSearchParams({
      email: "member@example.com",
      password: "member-password",
      next: requestedPath,
    }),
  });

  assert.equal(loginResponse.status, 303);
  assert.equal(loginResponse.headers.get("location"), requestedPath);
});

test("authenticated /share/<token> returns standalone report page for valid legacy ref", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();
  harness.reportShareRepository.seedShare({
    reportRef: "report_abc_123",
    tokenHash: "hash:share_valid_1",
    expiresAt: new Date("2026-03-01T00:00:00.000Z"),
  });

  const response = await fetch(`${baseUrl}/share/share_valid_1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /id="meta"/);
  assert.match(html, /id="passport"/);
  assert.match(html, /id="deal"/);
  assert.match(html, /id="pilot"/);
  assert.match(html, /id="product"/);
  assert.match(html, /Метаданные/);
  assert.match(html, /Паспорт сделки/);
  assert.match(html, /Коммерческий трек/);
  assert.match(html, /Пилотирование/);
  assert.match(html, /Продуктовый трек/);
  assert.doesNotMatch(html, /Развернуть всё/);
  assert.doesNotMatch(html, /Свернуть всё/);
  assert.doesNotMatch(html, /Печать \/ PDF/);
  assert.match(html, /schema unknown/);
});

test("authenticated /share/<token> escapes potentially dangerous report strings", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();
  const sharedFileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const reportKey = `users/${user.id}/files/${sharedFileId}/report.json`;

  seedUploadedFileRow(harness, {
    id: sharedFileId,
    userId: user.id,
    originalFilename: "share-ready.txt",
    extension: "txt",
    sizeBytes: 512,
    status: "succeeded",
    storageKeyReport: reportKey,
    createdAt: new Date("2026-02-27T11:00:00.000Z"),
  });
  harness.fileStorage.seedObjectText(reportKey, JSON.stringify({
    meta: {
      schema_version: "v2",
    },
    passport: {
      customer: "<script>alert(1)</script>",
    },
  }));
  harness.reportShareRepository.seedShare({
    reportRef: sharedFileId,
    tokenHash: "hash:share_safe_1",
    expiresAt: new Date("2026-03-01T00:00:00.000Z"),
  });

  const response = await fetch(`${baseUrl}/share/share_safe_1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("authenticated /share/<token> returns 410 for revoked token", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();
  harness.reportShareRepository.seedShare({
    reportRef: "report_revoked_1",
    tokenHash: "hash:share_revoked_1",
    revokedAt: new Date("2026-02-27T09:00:00.000Z"),
    expiresAt: new Date("2026-03-01T00:00:00.000Z"),
  });

  const response = await fetch(`${baseUrl}/share/share_revoked_1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 410);
});

test("authenticated /share/<token> returns 404 for invalid token", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/share/share_missing_1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 404);
});

test("authenticated /share/<token> returns 404 for expired token", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  harness.setShareNow(new Date("2026-02-27T10:00:00.000Z"));
  const { baseUrl } = await harness.start();
  harness.reportShareRepository.seedShare({
    reportRef: "report_expired_1",
    tokenHash: "hash:share_expired_1",
    expiresAt: new Date("2026-02-27T09:00:00.000Z"),
  });

  const response = await fetch(`${baseUrl}/share/share_expired_1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 404);
});

test("authenticated /files/<id>/report returns standalone report html document", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();
  const fileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const reportKey = `users/${user.id}/files/${fileId}/report.json`;

  seedUploadedFileRow(harness, {
    id: fileId,
    userId: user.id,
    originalFilename: "meeting.txt",
    extension: "txt",
    sizeBytes: 1234,
    status: "succeeded",
    storageKeyReport: reportKey,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  harness.fileStorage.seedObjectText(reportKey, JSON.stringify({
    meta: { schema_version: "v2", source: { transcript_format: "txt", language: "ru" } },
    passport: { stage: "discovery" },
    deal_track: { next_step: "follow-up" },
  }));

  const response = await fetch(`${baseUrl}/files/${fileId}/report`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /id="meta"/);
  assert.match(html, /id="passport"/);
  assert.match(html, /id="deal"/);
  assert.match(html, /id="pilot"/);
  assert.match(html, /id="product"/);
  assert.match(html, /Метаданные/);
  assert.match(html, /Паспорт сделки/);
  assert.match(html, /Коммерческий трек/);
  assert.match(html, /Пилотирование/);
  assert.match(html, /Продуктовый трек/);
  assert.doesNotMatch(html, /Развернуть всё/);
  assert.doesNotMatch(html, /Свернуть всё/);
  assert.doesNotMatch(html, /Печать \/ PDF/);
  assert.match(html, /schema v2/);
  assert.match(html, /follow-up/);
  assert.match(html, /<section class="card" id="meta">\s*<details>/);
  assert.doesNotMatch(html, /<section class="card" id="meta">\s*<details open>/);
  assert.match(html, /<section class="card" id="pilot">\s*<details>/);
  assert.doesNotMatch(html, /<section class="card" id="pilot">\s*<details open>/);
});

test("standalone report page renders schema-aware v2 fields", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(harness, {
    email: "member@example.com",
  });
  const { baseUrl } = await harness.start();
  const fileId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const reportKey = `users/${user.id}/files/${fileId}/report.json`;

  seedUploadedFileRow(harness, {
    id: fileId,
    userId: user.id,
    originalFilename: "schema-aware.txt",
    extension: "txt",
    sizeBytes: 2048,
    status: "succeeded",
    storageKeyReport: reportKey,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  harness.fileStorage.seedObjectText(reportKey, JSON.stringify({
    meta: {
      schema_version: "1.0",
      source: {
        transcript_id: "unknown",
        transcript_format: "txt",
        has_diarization: false,
        has_timecodes: false,
        language: "ru",
      },
      meeting_type: {
        primary: {
          label: "discovery",
          confidence: "high",
        },
        secondary: [],
        signals: [
          {
            text: "Обсуждение пилота и NDA",
            evidence: [{ quote: "NDA и пилот", timecode: "00:10" }],
          },
        ],
      },
      focus_weights: {
        passport: 0.2,
        deal_track: 0.25,
        pilot_poc: 0.25,
        product_track: 0.3,
      },
    },
    passport: {
      company: {
        name: { value: "ACME", status: "present", confidence: "high", evidence: [{ quote: "ACME", timecode: "00:02" }] },
        group: { value: "Enterprise", status: "present", confidence: "medium", evidence: [{ quote: "Enterprise", timecode: "00:03" }] },
        industry: { value: "Retail", status: "present", confidence: "medium", evidence: [{ quote: "Retail", timecode: "00:04" }] },
        contacts: [
          {
            person: { value: "Никита", status: "present", confidence: "high", evidence: [{ quote: "Никита", timecode: "00:05" }] },
            role: { value: "Product owner", status: "present", confidence: "medium", evidence: [{ quote: "Product owner", timecode: "00:06" }] },
          },
        ],
      },
      offering: {
        primary_theme: { value: "AI поиск", status: "present", confidence: "high", evidence: [{ quote: "AI поиск", timecode: "00:07" }] },
        solution_candidates: [
          { value: "Copilot", status: "present", confidence: "medium", evidence: [{ quote: "Copilot", timecode: "00:08" }] },
        ],
      },
      stage: {
        value: "discovery",
        status: "present",
        confidence: "high",
        mode: "inferred",
        evidence: [{ quote: "Discovery", timecode: "00:09" }],
      },
    },
    deal_track: {
      problem_impact: {
        items: [
          { value: "Нет быстрого поиска", status: "present", confidence: "high", evidence: [{ quote: "Нет быстрого поиска", timecode: "00:11" }] },
        ],
        missing_questions: [
          { value: "Целевые KPI", status: "missing", confidence: "medium", evidence: [{ quote: "KPI нет", timecode: "00:12" }] },
        ],
      },
      value_hypothesis: {
        items: [
          { value: "Сократить время поиска", status: "present", confidence: "high", evidence: [{ quote: "Сократить время", timecode: "00:13" }] },
        ],
        alternatives: [
          { value: "Внутренняя разработка", status: "uncertain", confidence: "medium", evidence: [{ quote: "Внутренняя разработка", timecode: "00:14" }] },
        ],
      },
      decision_people: {
        roles: {
          decision_maker: { value: "CTO", status: "present", confidence: "medium", evidence: [{ quote: "CTO", timecode: "00:15" }] },
          champion: { value: "Head of AI", status: "present", confidence: "medium", evidence: [{ quote: "Head of AI", timecode: "00:16" }] },
          owner: { value: "PM", status: "present", confidence: "medium", evidence: [{ quote: "PM", timecode: "00:17" }] },
          blocker: { value: "Security", status: "present", confidence: "medium", evidence: [{ quote: "Security", timecode: "00:18" }] },
        },
        process: [
          { value: "NDA -> pilot -> rollout", status: "present", confidence: "high", evidence: [{ quote: "NDA", timecode: "00:19" }] },
        ],
      },
      timing_trigger: {
        items: [
          { value: "Пилот по файлам", status: "present", confidence: "high", evidence: [{ quote: "Пилот", timecode: "00:20" }] },
        ],
        cadence: {
          next_contact: { value: "На неделе", status: "uncertain", confidence: "medium", evidence: [{ quote: "На неделе", timecode: "00:21" }] },
          deliverable: { value: "Список требований", status: "present", confidence: "high", evidence: [{ quote: "Список требований", timecode: "00:22" }] },
        },
      },
      money_procurement: {
        budget: { value: "не обсуждался", status: "not_discussed", confidence: "medium", evidence: [{ quote: "Бюджет позже", timecode: "00:23" }] },
        unit_economics: [
          { value: "Оплата за токены", status: "present", confidence: "medium", evidence: [{ quote: "Токены", timecode: "00:24" }] },
        ],
        procurement: [
          { value: "Через procurement", status: "present", confidence: "medium", evidence: [{ quote: "Procurement", timecode: "00:25" }] },
        ],
        price_sensitivity: [
          { value: "Нужен расчет TCO", status: "present", confidence: "medium", evidence: [{ quote: "TCO", timecode: "00:26" }] },
        ],
      },
      momentum_next_step: {
        commitments: [
          {
            actor: { value: "client", status: "present", confidence: "high", evidence: [{ quote: "Клиент", timecode: "00:27" }] },
            action: { value: "Подготовить требования", status: "present", confidence: "high", evidence: [{ quote: "Требования", timecode: "00:28" }] },
            when: { value: "На неделе", status: "uncertain", confidence: "medium", evidence: [{ quote: "На неделе", timecode: "00:29" }] },
          },
        ],
        next_step: {
          what: { value: "Подписать NDA", status: "present", confidence: "high", evidence: [{ quote: "NDA", timecode: "00:30" }] },
          when: { value: "После юр. согласования", status: "uncertain", confidence: "medium", evidence: [{ quote: "После юр.", timecode: "00:31" }] },
          goal: { value: "Запустить пилот", status: "present", confidence: "high", evidence: [{ quote: "Пилот", timecode: "00:32" }] },
        },
      },
      security_compliance_data: {
        items: [
          { value: "PII фильтрация", status: "present", confidence: "high", evidence: [{ quote: "PII", timecode: "00:33" }] },
        ],
        missing_questions: [
          { value: "Список нормативов", status: "missing", confidence: "medium", evidence: [{ quote: "Нормативы", timecode: "00:34" }] },
        ],
      },
    },
    pilot_poc: {
      status: { value: "present", status: "present", confidence: "high", evidence: [{ quote: "Пилот есть", timecode: "00:35" }] },
      goal: { value: "Проверить качество поиска", status: "present", confidence: "high", evidence: [{ quote: "Проверить поиск", timecode: "00:36" }] },
      scope: [{ value: "PDF/Docx", status: "present", confidence: "high", evidence: [{ quote: "PDF/Docx", timecode: "00:37" }] }],
      inputs_from_client: [{ value: "Набор документов", status: "present", confidence: "high", evidence: [{ quote: "Документы", timecode: "00:38" }] }],
      outputs_from_vendor: [{ value: "Демо", status: "present", confidence: "high", evidence: [{ quote: "Демо", timecode: "00:39" }] }],
      success_criteria: [{ value: "Релевантные ответы", status: "present", confidence: "high", evidence: [{ quote: "Релевантность", timecode: "00:40" }] }],
      timeline_checkpoints: [{ value: "2 недели", status: "uncertain", confidence: "medium", evidence: [{ quote: "2 недели", timecode: "00:41" }] }],
      owners: {
        client_owner: { value: "Никита", status: "present", confidence: "high", evidence: [{ quote: "Никита", timecode: "00:42" }] },
        vendor_owner: { value: "Murad", status: "present", confidence: "high", evidence: [{ quote: "Murad", timecode: "00:43" }] },
      },
    },
    product_track: {
      use_case: {
        items: [{ value: "Поиск по документам", status: "present", confidence: "high", evidence: [{ quote: "Поиск", timecode: "00:44" }] }],
      },
      requirements: {
        functional: [{ value: "Индексация", status: "present", confidence: "high", evidence: [{ quote: "Индексация", timecode: "00:45" }] }],
        non_functional: [{ value: "Производительность", status: "present", confidence: "high", evidence: [{ quote: "Производительность", timecode: "00:46" }] }],
        data_integrations: [{ value: "S3 connector", status: "present", confidence: "high", evidence: [{ quote: "S3", timecode: "00:47" }] }],
      },
      constraints: {
        items: [{ value: "DMZ", status: "present", confidence: "high", evidence: [{ quote: "DMZ", timecode: "00:48" }] }],
      },
      implementation: {
        items: [{ value: "Pilot then rollout", status: "present", confidence: "high", evidence: [{ quote: "Pilot then rollout", timecode: "00:49" }] }],
      },
      success_criteria: {
        items: [{ value: "Релевантность > 80%", status: "present", confidence: "high", evidence: [{ quote: "80%", timecode: "00:50" }] }],
      },
      open_questions_risks: {
        items: [{ value: "Бюджет", status: "missing", confidence: "medium", evidence: [{ quote: "Бюджет", timecode: "00:51" }] }],
      },
    },
  }));

  const response = await fetch(`${baseUrl}/files/${fileId}/report`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<span class=\"chip\">passport: 0[\\.,]2<\/span>/);
  assert.match(html, /<strong>Никита<\/strong> — Product owner/);
  assert.match(html, /✅ items: 1/);
  assert.match(html, /⚠️ missing: 1/);
  assert.match(html, /Потребности клиента/);
  assert.match(html, /Ценностное предложение/);
  assert.match(html, /Принятие решений/);
  assert.match(html, /Шаги и сроки/);
  assert.match(html, /Бюджет и закупка/);
  assert.match(html, /Договоренности/);
  assert.match(html, /Безопасность/);
  assert.match(html, /<span class='mono'>client<\/span>: Подготовить требования/);
  assert.match(html, /class=\"cards-3\"/);
  assert.match(html, /<h3>Требования<\/h3>/);
  assert.match(html, /<h4>Функциональные<\/h4>/);
  assert.match(html, /<h4>Нефункциональные<\/h4>/);
  assert.match(html, /<h4>Данные и интеграцияя<\/h4>/);
  assert.match(html, /<h3>Ограничители<\/h3>/);
  assert.match(html, /<h3>Имплементация<\/h3>/);
  assert.match(html, /<h3>Критерии успеха<\/h3>/);
  assert.match(html, /<h3>Открытые вопросы \/ риски<\/h3>/);
});

test("access request success creates row with status new", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
    },
    body: makeAccessRequestBody({
      email: "Lead@Example.com",
      name: "  Ada Lovelace ",
      company: "  Analytical Engines Inc ",
      note: "  Please contact me about early access. ",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    message: "Заявка принята. Если доступ будет одобрен, мы свяжемся с вами по электронной почте.",
  });

  assert.equal(harness.accessRequestRepository.requests.length, 1);
  assert.deepEqual(harness.accessRequestRepository.requests[0], {
    id: "ar_1",
    email: "lead@example.com",
    fullName: "Ada Lovelace",
    company: "Analytical Engines Inc",
    message: "Please contact me about early access.",
    status: "new",
    handledByUserId: null,
    handledAt: null,
    createdAt: harness.accessRequestRepository.requests[0]?.createdAt,
  });
});

test("access request invalid email is rejected", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
    },
    body: makeAccessRequestBody({
      email: "not-an-email",
      name: "User",
    }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "invalid_email",
  });
  assert.equal(harness.accessRequestRepository.requests.length, 0);
});

test("honeypot-filled access request returns generic success and creates no row", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: { Origin: SITE_ORIGIN },
    body: makeAccessRequestBody({
      email: "bot@example.com",
      website: "https://spam.example",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    message: "Заявка принята. Если доступ будет одобрен, мы свяжемся с вами по электронной почте.",
  });
  assert.equal(harness.accessRequestRepository.requests.length, 0);
});

test("time gate under 3s returns generic success and creates no row", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: { Origin: SITE_ORIGIN },
    body: new URLSearchParams({
      email: "speedy@example.com",
      website: "",
      client_ts: String(Date.now()),
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    message: "Заявка принята. Если доступ будет одобрен, мы свяжемся с вами по электронной почте.",
  });
  assert.equal(harness.accessRequestRepository.requests.length, 0);
});

test("duplicate access request within 24h returns generic success and creates no new row", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const first = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: { Origin: SITE_ORIGIN },
    body: makeAccessRequestBody({
      email: "repeat@example.com",
      name: "First",
    }),
  });
  assert.equal(first.status, 200);
  assert.equal(harness.accessRequestRepository.requests.length, 1);

  const second = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: { Origin: SITE_ORIGIN },
    body: makeAccessRequestBody({
      email: "repeat@example.com",
      name: "Second",
    }),
  });

  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), {
    ok: true,
    message: "Заявка принята. Если доступ будет одобрен, мы свяжемся с вами по электронной почте.",
  });
  assert.equal(harness.accessRequestRepository.requests.length, 1);
});

test("rate limit exceeded returns 429 and creates no additional row", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  for (let i = 0; i < ACCESS_REQUEST_LIMITS.ipPerHour; i += 1) {
    const response = await fetch(`${baseUrl}/api/access-requests`, {
      method: "POST",
      headers: {
        Origin: SITE_ORIGIN,
        "X-Forwarded-For": "198.51.100.10, 203.0.113.99",
      },
      body: makeAccessRequestBody({
        email: `lead-${i}@example.com`,
      }),
    });
    assert.equal(response.status, 200);
  }

  assert.equal(harness.accessRequestRepository.requests.length, ACCESS_REQUEST_LIMITS.ipPerHour);

  const blocked = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "X-Forwarded-For": "198.51.100.10, 203.0.113.99",
    },
    body: makeAccessRequestBody({
      email: "lead-blocked@example.com",
    }),
  });

  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), {
    ok: false,
    message: "Не удалось отправить заявку. Попробуйте еще раз позже.",
  });
  assert.equal(harness.accessRequestRepository.requests.length, ACCESS_REQUEST_LIMITS.ipPerHour);
});

test("old rate-limit buckets are ignored for current request evaluation", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();
  const oldBucket = new Date(Date.now() - 2 * 60 * 60 * 1_000);
  harness.accessRequestRepository.seedRateLimitBucket({
    scope: "ip",
    subjectHash: "hash:198.51.100.20",
    bucketStart: startOfHour(oldBucket),
    hitCount: ACCESS_REQUEST_LIMITS.ipPerHour + 5,
  });

  const response = await fetch(`${baseUrl}/api/access-requests`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "X-Forwarded-For": "198.51.100.20",
    },
    body: makeAccessRequestBody({
      email: "fresh@example.com",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(harness.accessRequestRepository.requests.length, 1);
});

test("files list endpoint requires authenticated session", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files`);

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "auth_required");
});

test("files list returns only current user items and omits storage internals", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const otherUser = seedUser({
    id: "22222222-2222-4222-8222-222222222222",
    email: "other@example.com",
    role: "user",
    status: "active",
  });
  harness.repository.seedUser(otherUser);

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "owner-new.txt",
    extension: "txt",
    sizeBytes: 111,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  seedUploadedFileRow(harness, {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    userId: otherUser.id,
    originalFilename: "other.vtt",
    extension: "vtt",
    sizeBytes: 222,
    createdAt: new Date("2026-02-27T11:00:00.000Z"),
  });
  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
    userId: owner.id,
    originalFilename: "owner-old.vtt",
    extension: "vtt",
    sizeBytes: 333,
    createdAt: new Date("2026-02-27T10:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    items: Array<Record<string, unknown>>;
    next_cursor: string | null;
  };
  assert.equal(payload.next_cursor, null);
  assert.equal(payload.items.length, 2);
  assert.deepEqual(
    payload.items.map((item) => item.id),
    [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
    ],
  );
  assert.equal(payload.items[0]?.original_filename, "owner-new.txt");
  assert.equal(payload.items[0]?.storage_key_original, undefined);
  assert.equal(payload.items[0]?.storage_bucket, undefined);
});

test("files list pagination traverses two pages with stable ordering", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "first.txt",
    extension: "txt",
    sizeBytes: 100,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
    userId: owner.id,
    originalFilename: "second.vtt",
    extension: "vtt",
    sizeBytes: 200,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  seedUploadedFileRow(harness, {
    id: "99999999-9999-4999-8999-999999999999",
    userId: owner.id,
    originalFilename: "third.txt",
    extension: "txt",
    sizeBytes: 300,
    createdAt: new Date("2026-02-27T11:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const page1 = await fetch(`${baseUrl}/api/files?limit=2`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(page1.status, 200);
  const page1Payload = (await page1.json()) as {
    items: Array<Record<string, unknown>>;
    next_cursor: string | null;
  };
  assert.deepEqual(
    page1Payload.items.map((item) => item.id),
    [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0",
    ],
  );
  assert.ok(page1Payload.next_cursor);

  const page2 = await fetch(
    `${baseUrl}/api/files?limit=2&cursor=${encodeURIComponent(page1Payload.next_cursor ?? "")}`,
    {
      headers: {
        Cookie: cookie,
      },
    },
  );
  assert.equal(page2.status, 200);
  const page2Payload = (await page2.json()) as {
    items: Array<Record<string, unknown>>;
    next_cursor: string | null;
  };
  assert.deepEqual(page2Payload.items.map((item) => item.id), [
    "99999999-9999-4999-8999-999999999999",
  ]);
  assert.equal(page2Payload.next_cursor, null);
});

test("files list invalid cursor returns 400 invalid_cursor", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files?cursor=not-a-valid-cursor`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_cursor" });
});

test("files details endpoint requires authenticated session", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/11111111-1111-4111-8111-111111111111`);

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "auth_required");
});

test("files details invalid id returns 400 invalid_id", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/not-a-uuid`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_id" });
});

test("files details returns 404 when file belongs to another user", async () => {
  const harness = createHarness();
  const { user: owner } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const { cookie: otherCookie } = seedAuthenticatedSession(
    harness,
    {
      id: "22222222-2222-4222-8222-222222222222",
      email: "other@example.com",
    },
    "opaque_2",
  );

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "owner.txt",
    extension: "txt",
    sizeBytes: 123,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`, {
    headers: {
      Cookie: otherCookie,
    },
  });

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not Found");
});

test("files details returns owner metadata with expected fields", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const createdAt = new Date("2026-02-27T12:00:00.000Z");
  const updatedAt = new Date("2026-02-27T12:10:00.000Z");
  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "failed.vtt",
    extension: "vtt",
    sizeBytes: 456,
    status: "failed",
    errorCode: "transcription_failed",
    errorMessage: "   vendor\nerror   detail\twith  extra spaces    ",
    createdAt,
    updatedAt,
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(payload.storage_bucket, undefined);
  assert.equal(payload.storage_key_original, undefined);
  assert.deepEqual(payload, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    original_filename: "failed.vtt",
    extension: "vtt",
    size_bytes: 456,
    status: "failed",
    created_at: createdAt.toISOString(),
    updated_at: updatedAt.toISOString(),
    processing_attempts: 0,
    attempts: null,
    max_attempts: null,
    next_run_at: null,
    last_error_code: null,
    last_error_message: null,
    error_code: "transcription_failed",
    error_message: "vendor error detail with extra spaces",
  });
});

test("files details includes processing metadata for queued/processing states", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const createdAt = new Date("2026-02-27T12:00:00.000Z");
  const updatedAt = new Date("2026-02-27T12:10:00.000Z");
  const nextRunAt = new Date("2026-02-27T12:12:00.000Z");
  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "processing.vtt",
    extension: "vtt",
    sizeBytes: 456,
    status: "queued",
    processingAttempts: 2,
    attempts: 2,
    maxAttempts: 4,
    nextRunAt,
    lastErrorCode: "llm_timeout",
    lastErrorMessage: "  timed out   while   waiting ",
    createdAt,
    updatedAt,
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(payload, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    original_filename: "processing.vtt",
    extension: "vtt",
    size_bytes: 456,
    status: "queued",
    created_at: createdAt.toISOString(),
    updated_at: updatedAt.toISOString(),
    processing_attempts: 2,
    attempts: 2,
    max_attempts: 4,
    next_run_at: nextRunAt.toISOString(),
    last_error_code: "llm_timeout",
    last_error_message: "timed out while waiting",
    error_code: null,
    error_message: null,
  });
});

test("file report endpoint requires authenticated session", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/11111111-1111-4111-8111-111111111111/report`);

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "auth_required");
});

test("file report returns 404 when file belongs to another user", async () => {
  const harness = createHarness();
  const { user: owner } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const { cookie: otherCookie } = seedAuthenticatedSession(
    harness,
    {
      id: "22222222-2222-4222-8222-222222222222",
      email: "other@example.com",
    },
    "opaque_2",
  );

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "owner.txt",
    extension: "txt",
    sizeBytes: 123,
    status: "succeeded",
    storageKeyReport: `users/${owner.id}/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report.json`,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report`, {
    headers: {
      Cookie: otherCookie,
    },
  });

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not Found");
});

test("file report returns 409 report_not_ready for owner when processing is not completed", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "owner.txt",
    extension: "txt",
    sizeBytes: 123,
    status: "processing",
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "report_not_ready" });
});

test("file report returns report json for owner with application/json content type", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const reportKey = `users/${owner.id}/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report.json`;

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "owner.txt",
    extension: "txt",
    sizeBytes: 123,
    status: "succeeded",
    storageKeyReport: reportKey,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  harness.fileStorage.seedObjectText(reportKey, JSON.stringify({
    summary: "ok",
    score: 0.9,
  }));
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.deepEqual(await response.json(), {
    summary: "ok",
    score: 0.9,
  });
});

test("file report returns 500 report_fetch_failed when s3 read fails", async () => {
  const harness = createHarness();
  const { user: owner, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const reportKey = `users/${owner.id}/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report.json`;

  seedUploadedFileRow(harness, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    userId: owner.id,
    originalFilename: "owner.txt",
    extension: "txt",
    sizeBytes: 123,
    status: "succeeded",
    storageKeyReport: reportKey,
    createdAt: new Date("2026-02-27T12:00:00.000Z"),
  });
  harness.fileStorage.failGetOnce = new Error("s3 timeout");
  const { baseUrl } = await harness.start();

  const response = await fetch(`${baseUrl}/api/files/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/report`, {
    headers: {
      Cookie: cookie,
    },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "report_fetch_failed" });
});

test("upload endpoint requires authenticated session", async () => {
  const harness = createHarness();
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "note.txt",
    content: "hello",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "auth_required");
  assert.equal(harness.fileRepository.rows.length, 0);
  assert.equal(harness.fileStorage.putCalls.length, 0);
});

test("upload .txt success stores metadata and object", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const { baseUrl } = await harness.start();
  const payload = Buffer.from("hello from txt", "utf8");
  const multipart = makeMultipartUploadBody({
    filename: "notes.txt",
    content: payload,
    contentType: "text/plain",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 200);
  const json = (await response.json()) as {
    ok: boolean;
    file_id: string;
    status: string;
  };
  assert.equal(json.ok, true);
  assert.match(json.file_id, /^[0-9a-f-]{36}$/);
  assert.equal(json.status, "queued");

  assert.equal(harness.fileRepository.rows.length, 1);
  const row = harness.fileRepository.rows[0];
  assert.ok(row);
  assert.equal(row.id, json.file_id);
  assert.equal(row.userId, user.id);
  assert.equal(row.status, "queued");
  assert.equal(row.storageBucket, "gofunnel-test-bucket");
  assert.equal(row.originalFilename, "notes.txt");
  assert.equal(row.extension, "txt");
  assert.equal(row.mimeType, "text/plain");
  assert.equal(row.sizeBytes, payload.length);
  assert.equal(
    row.storageKeyOriginal,
    `users/${user.id}/files/${json.file_id}/original.txt`,
  );

  assert.equal(harness.fileStorage.putCalls.length, 1);
  const putCall = harness.fileStorage.putCalls[0];
  assert.ok(putCall);
  assert.equal(putCall.key, row.storageKeyOriginal);
  assert.equal(putCall.contentType, "text/plain");
  assert.deepEqual(putCall.body, payload);

  const job = harness.processingJobRepository.rows.find((candidate) => candidate.fileId === row.id);
  assert.ok(job);
  assert.equal(job.status, "queued");
  assert.equal(job.attempts, 0);
  assert.equal(job.maxAttempts, 4);
});

test("upload success is visible in files list response", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "visible.txt",
    content: "visible-content",
    contentType: "text/plain",
  });

  const uploadResponse = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });
  assert.equal(uploadResponse.status, 200);
  const uploadPayload = (await uploadResponse.json()) as { file_id: string };

  const listResponse = await fetch(`${baseUrl}/api/files?limit=20`, {
    headers: {
      Cookie: cookie,
    },
  });
  assert.equal(listResponse.status, 200);
  const listPayload = (await listResponse.json()) as {
    items: Array<Record<string, unknown>>;
    next_cursor: string | null;
  };

  assert.equal(listPayload.items.length, 1);
  assert.deepEqual(listPayload.items[0], {
    id: uploadPayload.file_id,
    original_filename: "visible.txt",
    extension: "txt",
    size_bytes: Buffer.byteLength("visible-content"),
    status: "queued",
    created_at: listPayload.items[0]?.created_at,
    updated_at: listPayload.items[0]?.updated_at,
  });
  assert.equal(typeof listPayload.items[0]?.created_at, "string");
  assert.equal(typeof listPayload.items[0]?.updated_at, "string");
  assert.equal(listPayload.next_cursor, null);
});

test("upload handles duplicate enqueue idempotently and does not create extra jobs", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
  });
  const anticipatedFileId = testUuid(1);
  harness.processingJobRepository.seedQueuedJob({ fileId: anticipatedFileId });
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "idempotent.txt",
    content: "idempotent-content",
    contentType: "text/plain",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 200);
  const json = (await response.json()) as {
    ok: boolean;
    file_id: string;
    status: string;
  };
  assert.equal(json.ok, true);
  assert.equal(json.file_id, anticipatedFileId);
  assert.equal(json.status, "queued");
  assert.equal(
    harness.processingJobRepository.rows.filter((row) => row.fileId === anticipatedFileId).length,
    1,
  );
  assert.equal(harness.fileRepository.rows.length, 1);
  assert.equal(harness.fileRepository.rows[0]?.status, "queued");
});

test("upload rejects unsupported extension without DB or S3 side effects", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "report.pdf",
    content: "binary",
    contentType: "application/pdf",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_file_type" });
  assert.equal(harness.fileRepository.rows.length, 0);
  assert.equal(harness.fileStorage.putCalls.length, 0);
});

test("upload rejects oversize payload with 413 and no writes", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "oversize.txt",
    content: Buffer.alloc(FILE_UPLOAD_MAX_BYTES + 1, 65),
    contentType: "text/plain",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "file_too_large" });
  assert.equal(harness.fileRepository.rows.length, 0);
  assert.equal(harness.fileStorage.putCalls.length, 0);
});

test("queue finalize failure after successful s3 put triggers delete compensation and orphan logs", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  harness.fileRepository.failMarkQueuedOnce = new Error("write conflict");
  harness.fileStorage.failDeleteOnce = new Error("delete unavailable");
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "session.txt",
    content: "payload",
    contentType: "text/plain",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "upload_failed" });
  assert.equal(harness.fileStorage.putCalls.length, 1);
  assert.equal(harness.fileStorage.deleteCalls.length, 1);
  assert.equal(harness.fileRepository.rows.length, 1);
  const row = harness.fileRepository.rows[0];
  assert.ok(row);
  assert.equal(row.status, "failed");
  assert.equal(row.errorCode, "enqueue_failed");
  assert.equal(harness.fileStorage.deleteCalls[0], row.storageKeyOriginal);

  const enqueueOrphanLog = harness.fileLogs.find((entry) => entry.event === "orphan_file_without_job");
  assert.ok(enqueueOrphanLog);
  assert.equal(enqueueOrphanLog.userId, user.id);
  assert.equal(enqueueOrphanLog.fileId, row.id);
  assert.equal(enqueueOrphanLog.key, row.storageKeyOriginal);

  const orphanLog = harness.fileLogs.find((entry) => entry.event === "orphan_s3_object");
  assert.ok(orphanLog);
  assert.equal(orphanLog.userId, user.id);
  assert.equal(orphanLog.fileId, row.id);
  assert.equal(orphanLog.key, row.storageKeyOriginal);
});

test("s3 put failure after db insert updates file row status to failed", async () => {
  const harness = createHarness();
  const { cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  harness.fileStorage.failPutOnce = new Error("s3 timeout");
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "raw.vtt",
    content: "WEBVTT\n\n00:00.000 --> 00:01.000\nHi",
    contentType: "text/vtt",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "upload_failed" });
  assert.equal(harness.fileRepository.rows.length, 1);
  assert.equal(harness.fileStorage.putCalls.length, 1);
  assert.equal(harness.fileStorage.deleteCalls.length, 0);
  const row = harness.fileRepository.rows[0];
  assert.ok(row);
  assert.equal(row.status, "failed");
  assert.equal(row.errorCode, "s3_put_failed");
  assert.match(row.errorMessage ?? "", /s3 timeout/i);
});

test("enqueue failure after successful upload marks file failed and attempts s3 delete", async () => {
  const harness = createHarness();
  const { user, cookie } = seedAuthenticatedSession(harness, {
    id: "11111111-1111-4111-8111-111111111111",
  });
  harness.processingJobRepository.failEnqueueOnce = new Error("queue unavailable");
  const { baseUrl } = await harness.start();
  const multipart = makeMultipartUploadBody({
    filename: "to-queue.txt",
    content: "payload",
    contentType: "text/plain",
  });

  const response = await fetch(`${baseUrl}/api/files/upload`, {
    method: "POST",
    headers: {
      Origin: SITE_ORIGIN,
      Cookie: cookie,
      "Content-Type": multipart.contentType,
    },
    body: multipart.body.toString("utf8"),
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "upload_failed" });
  assert.equal(harness.fileRepository.rows.length, 1);
  assert.equal(harness.processingJobRepository.rows.length, 0);
  assert.equal(harness.fileStorage.putCalls.length, 1);
  assert.equal(harness.fileStorage.deleteCalls.length, 1);
  const row = harness.fileRepository.rows[0];
  assert.ok(row);
  assert.equal(row.status, "failed");
  assert.equal(row.errorCode, "enqueue_failed");
  assert.match(row.errorMessage ?? "", /queue unavailable/i);
  assert.equal(harness.fileStorage.deleteCalls[0], row.storageKeyOriginal);

  const orphanLog = harness.fileLogs.find((entry) => entry.event === "orphan_file_without_job");
  assert.ok(orphanLog);
  assert.equal(orphanLog.userId, user.id);
  assert.equal(orphanLog.fileId, row.id);
  assert.equal(orphanLog.key, row.storageKeyOriginal);
});

function createPgDuplicateViolationError(constraintName: string): Error & { code: string; constraint: string } {
  const error = new Error("duplicate key value violates unique constraint");
  return Object.assign(error, {
    code: "23505",
    constraint: constraintName,
  });
}
