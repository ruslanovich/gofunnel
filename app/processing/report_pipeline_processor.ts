import { ACTIVE_REPORT_PROMPT_VERSION, ACTIVE_REPORT_SCHEMA_VERSION } from "./report_contract.js";
import { ProcessingJobError, type ProcessingJobProcessor, type QueuedProcessingJob } from "./worker.js";

const DEFAULT_WORKER_LLM_TIMEOUT_MS = 60_000;

export type ProcessingPipelineFileContext = {
  fileId: string;
  userId: string;
  storageKeyOriginal: string;
};

export interface ProcessingPipelineFileRepository {
  getFileContext(input: { fileId: string }): Promise<ProcessingPipelineFileContext | null>;
  saveReportMetadata(input: {
    fileId: string;
    storageKeyReport: string;
    promptVersion: string;
    schemaVersion: string;
  }): Promise<void>;
  saveRawMetadata(input: {
    fileId: string;
    storageKeyRawLlmOutput: string;
    promptVersion: string;
    schemaVersion: string;
  }): Promise<void>;
}

export interface ProcessingPipelineStorage {
  getObjectText(key: string): Promise<string>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

export type ProcessingPipelineLlmResult = {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  rawText: string;
  parsedJson: unknown;
};

export interface ProcessingPipelineLlmAdapter {
  analyzeTranscript(input: {
    transcriptText: string;
    promptVersion?: string;
    schemaVersion?: string;
    timeoutMs?: number;
  }): Promise<ProcessingPipelineLlmResult>;
}

type ValidationSuccess = {
  ok: true;
  schemaVersion: string;
};

type ValidationFailure = {
  ok: false;
  errorCode: "schema_validation_failed";
  schemaVersion: string;
  summary: string;
  errors: Array<{
    instancePath: string;
    keyword: string;
    message: string;
  }>;
};

export type ProcessingPipelineLogger = {
  logEvent: (event: string, fields: Record<string, unknown>) => void;
};

export type ReportPipelineProcessorDeps = {
  fileRepository: ProcessingPipelineFileRepository;
  storage: ProcessingPipelineStorage;
  llmAdapter: ProcessingPipelineLlmAdapter;
  validateReportPayload: (payload: unknown, options?: {
    schemaVersion?: string;
  }) => ValidationSuccess | ValidationFailure;
  llmTimeoutMs?: number;
  logEvent?: ProcessingPipelineLogger["logEvent"];
};

export function createReportPipelineProcessor(deps: ReportPipelineProcessorDeps): ProcessingJobProcessor {
  return new ReportPipelineProcessor({
    ...deps,
    llmTimeoutMs: normalizeTimeoutMs(deps.llmTimeoutMs),
    logEvent: deps.logEvent ?? (() => undefined),
  });
}

class ReportPipelineProcessor implements ProcessingJobProcessor {
  constructor(private readonly deps: Required<ReportPipelineProcessorDeps>) {}

  async process(job: QueuedProcessingJob): Promise<void> {
    const fileContext = await this.deps.fileRepository.getFileContext({
      fileId: job.fileId,
    });
    if (!fileContext) {
      throw new ProcessingJobError({
        code: "file_context_not_found",
        message: "file context is missing for claimed job",
        retriable: false,
      });
    }

    const transcriptText = await this.readOriginalTranscript(fileContext.storageKeyOriginal);
    const llmResult = await this.callLlmAdapter(transcriptText);

    const validation = this.deps.validateReportPayload(llmResult.parsedJson, {
      schemaVersion: llmResult.schemaVersion,
    });
    if (!validation.ok) {
      await this.persistRawOutputOnSchemaFailure({
        fileContext,
        llmResult,
      });
      throw new ProcessingJobError({
        code: "schema_validation_failed",
        message: validation.summary,
        retriable: false,
      });
    }

    await this.persistReportArtifacts({
      fileContext,
      llmResult,
    });
  }

  private async readOriginalTranscript(storageKeyOriginal: string): Promise<string> {
    try {
      const transcriptText = await this.deps.storage.getObjectText(storageKeyOriginal);
      const normalized = transcriptText.trim();
      if (!normalized) {
        throw new ProcessingJobError({
          code: "empty_original_transcript",
          message: "original transcript is empty",
          retriable: false,
        });
      }
      return normalized;
    } catch (error) {
      if (error instanceof ProcessingJobError) {
        throw error;
      }
      throw new ProcessingJobError({
        code: "s3_read_failed",
        message: sanitizeErrorMessage(error),
        retriable: isRetriableStorageError(error),
      });
    }
  }

  private async callLlmAdapter(transcriptText: string): Promise<ProcessingPipelineLlmResult> {
    try {
      return await this.deps.llmAdapter.analyzeTranscript({
        transcriptText,
        promptVersion: ACTIVE_REPORT_PROMPT_VERSION,
        schemaVersion: ACTIVE_REPORT_SCHEMA_VERSION,
        timeoutMs: this.deps.llmTimeoutMs,
      });
    } catch (error) {
      if (isLlmAdapterError(error) && error.retriable) {
        throw new ProcessingJobError({
          code: error.code,
          message: sanitizeErrorMessage(error.message),
          retriable: true,
        });
      }

      throw new ProcessingJobError({
        code: "llm_call_failed",
        message: sanitizeErrorMessage(error),
        retriable: false,
      });
    }
  }

  private async persistRawOutputOnSchemaFailure(input: {
    fileContext: ProcessingPipelineFileContext;
    llmResult: ProcessingPipelineLlmResult;
  }): Promise<void> {
    const storageKeyRaw = buildRawOutputStorageKey(input.fileContext.userId, input.fileContext.fileId);
    const body = Buffer.from(input.llmResult.rawText, "utf8");

    try {
      await this.deps.storage.putObject(storageKeyRaw, body, "application/json; charset=utf-8");
    } catch (error) {
      throw new ProcessingJobError({
        code: "s3_write_failed",
        message: sanitizeErrorMessage(error),
        retriable: false,
      });
    }

    try {
      await this.deps.fileRepository.saveRawMetadata({
        fileId: input.fileContext.fileId,
        storageKeyRawLlmOutput: storageKeyRaw,
        promptVersion: input.llmResult.promptVersion,
        schemaVersion: input.llmResult.schemaVersion,
      });
    } catch (error) {
      this.deps.logEvent("raw_output_metadata_update_failed", {
        fileId: input.fileContext.fileId,
        key: storageKeyRaw,
        error: sanitizeErrorMessage(error),
      });
    }
  }

  private async persistReportArtifacts(input: {
    fileContext: ProcessingPipelineFileContext;
    llmResult: ProcessingPipelineLlmResult;
  }): Promise<void> {
    const writtenInRun: string[] = [];
    const reportKey = buildReportStorageKey(input.fileContext.userId, input.fileContext.fileId);
    const reportBody = Buffer.from(JSON.stringify(input.llmResult.parsedJson), "utf8");

    try {
      await this.deps.storage.putObject(reportKey, reportBody, "application/json; charset=utf-8");
      writtenInRun.push(reportKey);
    } catch (error) {
      throw new ProcessingJobError({
        code: "s3_write_failed",
        message: sanitizeErrorMessage(error),
        retriable: isRetriableStorageError(error),
      });
    }

    try {
      await this.deps.fileRepository.saveReportMetadata({
        fileId: input.fileContext.fileId,
        storageKeyReport: reportKey,
        promptVersion: input.llmResult.promptVersion,
        schemaVersion: input.llmResult.schemaVersion,
      });
    } catch (error) {
      await this.cleanupWrittenArtifacts({
        fileId: input.fileContext.fileId,
        keys: writtenInRun,
      });

      throw new ProcessingJobError({
        code: "db_update_failed",
        message: sanitizeErrorMessage(error),
        retriable: isRetriableDatabaseError(error),
      });
    }
  }

  private async cleanupWrittenArtifacts(input: { fileId: string; keys: string[] }): Promise<void> {
    for (const key of input.keys) {
      try {
        await this.deps.storage.deleteObject(key);
      } catch {
        this.deps.logEvent("orphan_report_object", {
          fileId: input.fileId,
          key,
        });
      }
    }
  }
}

export function buildReportStorageKey(userId: string, fileId: string): string {
  return `users/${userId}/files/${fileId}/report.json`;
}

export function buildRawOutputStorageKey(userId: string, fileId: string): string {
  return `users/${userId}/files/${fileId}/raw_llm_output.json`;
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_WORKER_LLM_TIMEOUT_MS;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("llmTimeoutMs must be a positive integer");
  }
  return value;
}

function isLlmAdapterError(error: unknown): error is {
  code: string;
  retriable: boolean;
  message: string;
} {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof (error as { code: unknown }).code === "string"
    && "retriable" in error
    && typeof (error as { retriable: unknown }).retriable === "boolean"
    && "message" in error
    && typeof (error as { message: unknown }).message === "string"
  );
}

function isRetriableStorageError(error: unknown): boolean {
  const statusCode = getErrorStatusCode(error);
  if (statusCode === 429) {
    return true;
  }
  if (statusCode !== null && statusCode >= 500) {
    return true;
  }

  if (hasTruthyProperty(error, "$retryable")) {
    return true;
  }

  const code = getErrorCode(error);
  if (!code) {
    return false;
  }

  return RETRIABLE_STORAGE_ERROR_CODES.has(code);
}

function isRetriableDatabaseError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (!code) {
    return false;
  }

  if (code.startsWith("08")) {
    return true;
  }
  if (code.startsWith("53")) {
    return true;
  }

  return RETRIABLE_DB_ERROR_CODES.has(code);
}

const RETRIABLE_STORAGE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "RequestTimeout",
  "RequestTimeoutException",
  "TimeoutError",
  "Throttling",
  "ThrottlingException",
  "SlowDown",
]);

const RETRIABLE_DB_ERROR_CODES = new Set([
  "40001",
  "40P01",
  "57P01",
  "57P02",
  "57P03",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
]);

function getErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  if (metadata && typeof metadata.httpStatusCode === "number") {
    return metadata.httpStatusCode;
  }

  const directStatus = (error as { statusCode?: unknown }).statusCode;
  if (typeof directStatus === "number") {
    return directStatus;
  }

  return null;
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const rawCode = (error as { code?: unknown; name?: unknown }).code
    ?? (error as { code?: unknown; name?: unknown }).name;
  if (typeof rawCode !== "string") {
    return null;
  }
  return rawCode.trim();
}

function hasTruthyProperty(error: unknown, key: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return Boolean((error as Record<string, unknown>)[key]);
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "unknown_error";
  }
  return collapsed.slice(0, 280);
}
