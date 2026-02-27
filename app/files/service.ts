import { randomUUID } from "node:crypto";

import {
  ALLOWED_FILE_EXTENSIONS,
  type FileDetailsItem,
  type FileReportItem,
  type FileReportStorage,
  type AllowedFileExtension,
  type FileListCursor,
  type FileListItem,
  type FileMetadataRepository,
  type FileObjectStorage,
  type ProcessingJobQueueRepository,
  FILE_UPLOAD_MAX_BYTES,
} from "./contracts.js";

const DEFAULT_MIME_BY_EXTENSION: Record<AllowedFileExtension, string> = {
  txt: "text/plain",
  vtt: "text/vtt",
};

export { FILE_UPLOAD_MAX_BYTES };

export class FileUploadValidationError extends Error {
  readonly httpStatus: 400 | 413;
  readonly code: "invalid_file_type" | "file_too_large";

  constructor(code: "invalid_file_type" | "file_too_large") {
    super(code);
    this.name = "FileUploadValidationError";
    this.code = code;
    this.httpStatus = code === "file_too_large" ? 413 : 400;
  }
}

export class FileUploadError extends Error {
  readonly httpStatus = 500;
  readonly code = "upload_failed";

  constructor() {
    super("upload_failed");
    this.name = "FileUploadError";
  }
}

export class FileListValidationError extends Error {
  readonly httpStatus = 400;
  readonly code = "invalid_limit";

  constructor() {
    super("invalid_limit");
    this.name = "FileListValidationError";
  }
}

export type FileUploadServiceDeps = {
  repository: FileMetadataRepository;
  jobQueueRepository: ProcessingJobQueueRepository;
  storage: FileObjectStorage;
  storageBucket: string;
  randomId?: () => string;
  logEvent?: (event: string, fields: Record<string, unknown>) => void;
};

export type UploadFileInput = {
  userId: string;
  originalFilename: string;
  mimeType: string | null;
  sizeBytes: number;
  bytes: Buffer;
};

export type UploadFileResult = {
  fileId: string;
  storageKeyOriginal: string;
  status: "queued";
};

export class FileUploadService {
  private readonly randomId: () => string;

  constructor(private readonly deps: FileUploadServiceDeps) {
    this.randomId = deps.randomId ?? (() => randomUUID());
  }

  async upload(input: UploadFileInput): Promise<UploadFileResult> {
    const originalFilename = normalizeOriginalFilename(input.originalFilename);
    const extension = extractAllowedExtension(originalFilename);
    if (!extension) {
      throw new FileUploadValidationError("invalid_file_type");
    }

    if (input.sizeBytes > FILE_UPLOAD_MAX_BYTES) {
      throw new FileUploadValidationError("file_too_large");
    }

    const fileId = this.randomId();
    const storageKeyOriginal = buildOriginalStorageKey(input.userId, fileId, extension);
    const contentType = normalizeMimeType(input.mimeType, extension);

    await this.deps.repository.createProcessingFile({
      id: fileId,
      userId: input.userId,
      storageBucket: this.deps.storageBucket,
      storageKeyOriginal,
      originalFilename,
      extension,
      mimeType: contentType,
      sizeBytes: input.sizeBytes,
    });

    try {
      await this.deps.storage.putObject(storageKeyOriginal, input.bytes, contentType ?? "application/octet-stream");
    } catch (error) {
      await this.markFailedBestEffort({
        id: fileId,
        userId: input.userId,
        code: "s3_put_failed",
        message: sanitizeErrorMessage(error),
      });
      throw new FileUploadError();
    }

    try {
      try {
        await this.deps.jobQueueRepository.enqueueForFile({
          fileId,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }

      await this.deps.repository.markFileQueued({
        id: fileId,
        userId: input.userId,
      });
    } catch (error) {
      let deleteFailed = false;
      let deleteErrorMessage: string | null = null;
      try {
        await this.deps.storage.deleteObject(storageKeyOriginal);
      } catch (deleteError) {
        deleteFailed = true;
        deleteErrorMessage = sanitizeErrorMessage(deleteError);
      }

      const sanitizedError = sanitizeErrorMessage(error);
      await this.markFailedBestEffort({
        id: fileId,
        userId: input.userId,
        code: "enqueue_failed",
        message: sanitizedError,
      });

      this.deps.logEvent?.("orphan_file_without_job", {
        userId: input.userId,
        fileId,
        key: storageKeyOriginal,
        enqueueError: sanitizedError,
        deleteFailed,
        ...(deleteErrorMessage ? { deleteError: deleteErrorMessage } : {}),
      });

      if (deleteFailed) {
        this.deps.logEvent?.("orphan_s3_object", {
          userId: input.userId,
          fileId,
          key: storageKeyOriginal,
        });
      }

      throw new FileUploadError();
    }

    return {
      fileId,
      storageKeyOriginal,
      status: "queued",
    };
  }

  private async markFailedBestEffort(input: {
    id: string;
    userId: string;
    code: string;
    message: string;
  }): Promise<void> {
    try {
      await this.deps.repository.markFileFailed({
        id: input.id,
        userId: input.userId,
        errorCode: input.code,
        errorMessage: input.message,
      });
    } catch {
      // Ignored on purpose: status update is best-effort once the primary upload path already failed.
    }
  }
}

export type FileListServiceDeps = {
  repository: FileMetadataRepository;
};

export type ListFilesInput = {
  userId: string;
  limit: number;
  cursor: FileListCursor | null;
};

export type ListFilesResult = {
  items: FileListItem[];
  nextCursor: FileListCursor | null;
};

const FILES_LIST_DEFAULT_LIMIT = 20;
const FILES_LIST_MAX_LIMIT = 100;

export class FileListService {
  constructor(private readonly deps: FileListServiceDeps) {}

  async listForUser(input: ListFilesInput): Promise<ListFilesResult> {
    const limit = normalizeListLimit(input.limit);
    const rows = await this.deps.repository.listFilesForUser({
      userId: input.userId,
      limit: limit + 1,
      cursor: input.cursor,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1) ?? null;

    return {
      items,
      nextCursor: hasMore && last ? { createdAt: new Date(last.createdAt), id: last.id } : null,
    };
  }
}

export type FileDetailsServiceDeps = {
  repository: FileMetadataRepository;
};

export type GetFileDetailsForUserInput = {
  userId: string;
  id: string;
};

export class FileDetailsService {
  constructor(private readonly deps: FileDetailsServiceDeps) {}

  async getForUser(input: GetFileDetailsForUserInput): Promise<FileDetailsItem | null> {
    return this.deps.repository.findFileForUser({
      id: input.id,
      userId: input.userId,
    });
  }
}

export class FileReportError extends Error {
  readonly httpStatus: 409 | 500;
  readonly code: "report_not_ready" | "report_fetch_failed";
  readonly details: string | null;

  constructor(code: "report_not_ready" | "report_fetch_failed", details: string | null = null) {
    super(code);
    this.name = "FileReportError";
    this.code = code;
    this.httpStatus = code === "report_not_ready" ? 409 : 500;
    this.details = details;
  }
}

export type FileReportServiceDeps = {
  repository: FileMetadataRepository;
  storage: FileReportStorage;
};

export type GetFileReportForUserInput = {
  userId: string;
  id: string;
};

export class FileReportService {
  constructor(private readonly deps: FileReportServiceDeps) {}

  async getForUser(input: GetFileReportForUserInput): Promise<(FileReportItem & { report: unknown }) | null> {
    const file = await this.deps.repository.findFileReportForUser({
      id: input.id,
      userId: input.userId,
    });
    if (!file) {
      return null;
    }

    if (file.status !== "succeeded" || file.storageKeyReport === null) {
      throw new FileReportError("report_not_ready");
    }

    let reportText: string;
    try {
      reportText = await this.deps.storage.getObjectText(file.storageKeyReport);
    } catch (error) {
      throw new FileReportError("report_fetch_failed", sanitizeErrorMessage(error));
    }

    try {
      const report = JSON.parse(reportText) as unknown;
      return {
        ...file,
        report,
      };
    } catch (error) {
      throw new FileReportError("report_fetch_failed", sanitizeErrorMessage(error));
    }
  }
}

export function buildOriginalStorageKey(
  userId: string,
  fileId: string,
  extension: AllowedFileExtension,
): string {
  return `users/${userId}/files/${fileId}/original.${extension}`;
}

function normalizeOriginalFilename(value: string): string {
  const trimmed = value.trim();
  const lastSegment = trimmed.split(/[/\\]/).pop() ?? "";
  return lastSegment;
}

function extractAllowedExtension(filename: string): AllowedFileExtension | null {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return null;
  }

  const extension = filename.slice(dotIndex + 1).toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.includes(extension as AllowedFileExtension)) {
    return null;
  }

  return extension as AllowedFileExtension;
}

function normalizeMimeType(
  mimeType: string | null,
  extension: AllowedFileExtension,
): string | null {
  const normalized = mimeType?.trim().toLowerCase() ?? "";
  if (normalized) {
    return normalized;
  }

  return DEFAULT_MIME_BY_EXTENSION[extension];
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "unknown_error";
  }
  return collapsed.slice(0, 280);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "23505"
  );
}

export function normalizeListLimit(input: number | null | undefined): number {
  if (input == null) {
    return FILES_LIST_DEFAULT_LIMIT;
  }

  if (!Number.isInteger(input) || input < 1) {
    throw new FileListValidationError();
  }

  return Math.min(input, FILES_LIST_MAX_LIMIT);
}
