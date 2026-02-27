import assert from "node:assert/strict";
import { test } from "node:test";

import { LlmAdapterError, type LlmAdapter } from "../../infra/processing/llm_adapter.js";
import { validateReportPayload } from "../../infra/processing/report_schema_validator.js";
import {
  createReportPipelineProcessor,
  type ProcessingPipelineFileContext,
  type ProcessingPipelineFileRepository,
  type ProcessingPipelineLogger,
  type ProcessingPipelineStorage,
} from "./report_pipeline_processor.js";
import { ProcessingWorker, type ProcessingWorkerRepository, type QueuedProcessingJob } from "./worker.js";

const CLAIMED_JOB: QueuedProcessingJob = {
  id: "11111111-1111-4111-8111-111111111111",
  fileId: "22222222-2222-4222-8222-222222222222",
  attempts: 1,
  maxAttempts: 4,
  lockTtlSeconds: 30,
};

const FILE_CONTEXT: ProcessingPipelineFileContext = {
  fileId: CLAIMED_JOB.fileId,
  userId: "33333333-3333-4333-8333-333333333333",
  storageKeyOriginal: "users/33333333-3333-4333-8333-333333333333/files/22222222-2222-4222-8222-222222222222/original.txt",
};

test("pipeline happy path: report written, metadata updated, worker finalizes succeeded", async () => {
  const workerRepository = new FakeWorkerRepository();
  const pipelineRepository = new FakePipelineRepository({
    fileContext: FILE_CONTEXT,
  });
  const storage = new FakeStorage({
    getObjectText: async () => "call transcript",
  });
  const llmAdapter = createFakeLlmAdapter({
    analyzeTranscript: async () => ({
      provider: "fake",
      model: "test-model",
      promptVersion: "v1",
      schemaVersion: "v1",
      rawText: JSON.stringify(validReportPayload()),
      parsedJson: validReportPayload(),
    }),
  });

  const processor = createReportPipelineProcessor({
    fileRepository: pipelineRepository,
    storage,
    llmAdapter,
    validateReportPayload,
  });
  const worker = createWorker(workerRepository, processor);

  await worker.processClaimedJob(CLAIMED_JOB);

  assert.equal(workerRepository.succeededCalls.length, 1);
  assert.equal(workerRepository.failedCalls.length, 0);
  assert.equal(workerRepository.requeuedCalls.length, 0);
  assert.deepEqual(storage.getObjectCalls, [FILE_CONTEXT.storageKeyOriginal]);
  assert.equal(storage.putObjectCalls.length, 1);
  assert.equal(
    storage.putObjectCalls[0]?.key,
    "users/33333333-3333-4333-8333-333333333333/files/22222222-2222-4222-8222-222222222222/report.json",
  );
  assert.equal(pipelineRepository.reportMetadataCalls.length, 1);
  assert.deepEqual(pipelineRepository.reportMetadataCalls[0], {
    fileId: CLAIMED_JOB.fileId,
    storageKeyReport:
      "users/33333333-3333-4333-8333-333333333333/files/22222222-2222-4222-8222-222222222222/report.json",
    promptVersion: "v1",
    schemaVersion: "v1",
  });
});

test("schema invalid: raw output is persisted and file is finalized failed with schema_validation_failed", async () => {
  const workerRepository = new FakeWorkerRepository();
  const pipelineRepository = new FakePipelineRepository({
    fileContext: FILE_CONTEXT,
  });
  const storage = new FakeStorage({
    getObjectText: async () => "call transcript",
  });
  const llmAdapter = createFakeLlmAdapter({
    analyzeTranscript: async () => ({
      provider: "fake",
      model: "test-model",
      promptVersion: "v1",
      schemaVersion: "v1",
      rawText: JSON.stringify({ overview: "", riskLevel: "critical" }),
      parsedJson: { overview: "", riskLevel: "critical" },
    }),
  });

  const processor = createReportPipelineProcessor({
    fileRepository: pipelineRepository,
    storage,
    llmAdapter,
    validateReportPayload,
  });
  const worker = createWorker(workerRepository, processor);

  await worker.processClaimedJob(CLAIMED_JOB);

  assert.equal(workerRepository.succeededCalls.length, 0);
  assert.equal(workerRepository.requeuedCalls.length, 0);
  assert.equal(workerRepository.failedCalls.length, 1);
  assert.equal(workerRepository.failedCalls[0]?.errorCode, "schema_validation_failed");
  assert.equal(storage.putObjectCalls.length, 1);
  assert.equal(
    storage.putObjectCalls[0]?.key,
    "users/33333333-3333-4333-8333-333333333333/files/22222222-2222-4222-8222-222222222222/raw_llm_output.json",
  );
  assert.equal(pipelineRepository.rawMetadataCalls.length, 1);
});

test("LLM timeout is retriable and worker requeues with future next_run_at", async () => {
  const workerRepository = new FakeWorkerRepository();
  const pipelineRepository = new FakePipelineRepository({
    fileContext: FILE_CONTEXT,
  });
  const storage = new FakeStorage({
    getObjectText: async () => "call transcript",
  });
  const llmAdapter = createFakeLlmAdapter({
    analyzeTranscript: async () => {
      throw new LlmAdapterError({
        code: "llm_timeout",
        retriable: true,
        message: "timeout",
      });
    },
  });

  const processor = createReportPipelineProcessor({
    fileRepository: pipelineRepository,
    storage,
    llmAdapter,
    validateReportPayload,
  });
  const worker = createWorker(workerRepository, processor, {
    now: () => new Date("2026-02-27T14:00:00.000Z"),
    random: () => 0.5,
  });

  await worker.processClaimedJob(CLAIMED_JOB);

  assert.equal(workerRepository.succeededCalls.length, 0);
  assert.equal(workerRepository.failedCalls.length, 0);
  assert.equal(workerRepository.requeuedCalls.length, 1);
  assert.equal(workerRepository.requeuedCalls[0]?.errorCode, "llm_timeout");
  assert.equal(
    workerRepository.requeuedCalls[0]?.nextRunAt.toISOString(),
    "2026-02-27T14:00:30.000Z",
  );
});

test("S3 read transient failure is retriable and worker requeues", async () => {
  const workerRepository = new FakeWorkerRepository();
  const pipelineRepository = new FakePipelineRepository({
    fileContext: FILE_CONTEXT,
  });
  const storage = new FakeStorage({
    getObjectText: async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    },
  });
  const llmAdapter = createFakeLlmAdapter({
    analyzeTranscript: async () => {
      throw new Error("LLM should not be called");
    },
  });

  const processor = createReportPipelineProcessor({
    fileRepository: pipelineRepository,
    storage,
    llmAdapter,
    validateReportPayload,
  });
  const worker = createWorker(workerRepository, processor, {
    now: () => new Date("2026-02-27T14:10:00.000Z"),
    random: () => 0.5,
  });

  await worker.processClaimedJob(CLAIMED_JOB);

  assert.equal(workerRepository.succeededCalls.length, 0);
  assert.equal(workerRepository.failedCalls.length, 0);
  assert.equal(workerRepository.requeuedCalls.length, 1);
  assert.equal(workerRepository.requeuedCalls[0]?.errorCode, "s3_read_failed");
});

test("DB metadata update failure after report write triggers delete attempt and orphan log", async () => {
  const workerRepository = new FakeWorkerRepository();
  const pipelineRepository = new FakePipelineRepository({
    fileContext: FILE_CONTEXT,
    saveReportMetadata: async () => {
      throw Object.assign(new Error("db is unavailable"), { code: "XX000" });
    },
  });
  const storage = new FakeStorage({
    getObjectText: async () => "call transcript",
    deleteObject: async () => {
      throw new Error("delete failed");
    },
  });
  const llmAdapter = createFakeLlmAdapter({
    analyzeTranscript: async () => ({
      provider: "fake",
      model: "test-model",
      promptVersion: "v1",
      schemaVersion: "v1",
      rawText: JSON.stringify(validReportPayload()),
      parsedJson: validReportPayload(),
    }),
  });
  const log = new FakePipelineLogger();

  const processor = createReportPipelineProcessor({
    fileRepository: pipelineRepository,
    storage,
    llmAdapter,
    validateReportPayload,
    logEvent: log.logEvent,
  });
  const worker = createWorker(workerRepository, processor);

  await worker.processClaimedJob(CLAIMED_JOB);

  assert.equal(storage.deleteObjectCalls.length, 1);
  assert.equal(
    storage.deleteObjectCalls[0],
    "users/33333333-3333-4333-8333-333333333333/files/22222222-2222-4222-8222-222222222222/report.json",
  );
  assert.equal(log.calls.length, 1);
  assert.equal(log.calls[0]?.event, "orphan_report_object");
  assert.deepEqual(log.calls[0]?.fields, {
    fileId: CLAIMED_JOB.fileId,
    key: "users/33333333-3333-4333-8333-333333333333/files/22222222-2222-4222-8222-222222222222/report.json",
  });
});

function createWorker(
  repository: FakeWorkerRepository,
  processor: ReturnType<typeof createReportPipelineProcessor>,
  options: {
    now?: () => Date;
    random?: () => number;
  } = {},
): ProcessingWorker {
  return new ProcessingWorker({
    workerId: "worker-pipeline-test",
    concurrency: 1,
    pollMs: 1_000,
    repository,
    processor,
    now: options.now,
    random: options.random ?? (() => 0.5),
  });
}

function createFakeLlmAdapter(input: {
  analyzeTranscript: LlmAdapter["analyzeTranscript"];
}): LlmAdapter {
  return {
    analyzeTranscript: input.analyzeTranscript,
    classifyError: () => ({
      errorCode: "llm_provider_failed",
      retriable: false,
      errorSummary: "llm_provider_failed",
    }),
  };
}

function validReportPayload(): unknown {
  return {
    overview: "Summary",
    highlights: ["Point one"],
    nextSteps: [
      {
        owner: "Team",
        action: "Follow up",
        dueDate: "2026-03-01",
      },
    ],
    riskLevel: "low",
  };
}

class FakeStorage implements ProcessingPipelineStorage {
  readonly getObjectCalls: string[] = [];
  readonly putObjectCalls: Array<{
    key: string;
    body: Buffer;
    contentType: string;
  }> = [];
  readonly deleteObjectCalls: string[] = [];

  constructor(
    private readonly overrides: {
      getObjectText?: (key: string) => Promise<string>;
      putObject?: (key: string, body: Buffer, contentType: string) => Promise<void>;
      deleteObject?: (key: string) => Promise<void>;
    } = {},
  ) {}

  async getObjectText(key: string): Promise<string> {
    this.getObjectCalls.push(key);
    if (this.overrides.getObjectText) {
      return this.overrides.getObjectText(key);
    }
    return "transcript";
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.putObjectCalls.push({
      key,
      body,
      contentType,
    });
    if (this.overrides.putObject) {
      return this.overrides.putObject(key, body, contentType);
    }
  }

  async deleteObject(key: string): Promise<void> {
    this.deleteObjectCalls.push(key);
    if (this.overrides.deleteObject) {
      return this.overrides.deleteObject(key);
    }
  }
}

class FakePipelineRepository implements ProcessingPipelineFileRepository {
  readonly reportMetadataCalls: Array<{
    fileId: string;
    storageKeyReport: string;
    promptVersion: string;
    schemaVersion: string;
  }> = [];
  readonly rawMetadataCalls: Array<{
    fileId: string;
    storageKeyRawLlmOutput: string;
    promptVersion: string;
    schemaVersion: string;
  }> = [];

  constructor(
    private readonly overrides: {
      fileContext: ProcessingPipelineFileContext | null;
      saveReportMetadata?: (
        input: {
          fileId: string;
          storageKeyReport: string;
          promptVersion: string;
          schemaVersion: string;
        },
      ) => Promise<void>;
      saveRawMetadata?: (
        input: {
          fileId: string;
          storageKeyRawLlmOutput: string;
          promptVersion: string;
          schemaVersion: string;
        },
      ) => Promise<void>;
    },
  ) {}

  async getFileContext(input: { fileId: string }): Promise<ProcessingPipelineFileContext | null> {
    assert.equal(input.fileId, CLAIMED_JOB.fileId);
    return this.overrides.fileContext;
  }

  async saveReportMetadata(input: {
    fileId: string;
    storageKeyReport: string;
    promptVersion: string;
    schemaVersion: string;
  }): Promise<void> {
    this.reportMetadataCalls.push(input);
    if (this.overrides.saveReportMetadata) {
      return this.overrides.saveReportMetadata(input);
    }
  }

  async saveRawMetadata(input: {
    fileId: string;
    storageKeyRawLlmOutput: string;
    promptVersion: string;
    schemaVersion: string;
  }): Promise<void> {
    this.rawMetadataCalls.push(input);
    if (this.overrides.saveRawMetadata) {
      return this.overrides.saveRawMetadata(input);
    }
  }
}

class FakePipelineLogger implements ProcessingPipelineLogger {
  readonly calls: Array<{
    event: string;
    fields: Record<string, unknown>;
  }> = [];

  logEvent = (event: string, fields: Record<string, unknown>): void => {
    this.calls.push({ event, fields });
  };
}

class FakeWorkerRepository implements ProcessingWorkerRepository {
  readonly heartbeatCalls: Array<{ jobId: string; workerId: string }> = [];
  readonly succeededCalls: Array<{
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
  }> = [];
  readonly failedCalls: Array<{
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    errorCode: string;
    errorMessage: string;
  }> = [];
  readonly requeuedCalls: Array<{
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    nextRunAt: Date;
    errorCode: string;
    errorMessage: string;
  }> = [];

  async claimReadyJob(): Promise<QueuedProcessingJob | null> {
    return null;
  }

  async touchHeartbeat(input: { jobId: string; workerId: string }): Promise<void> {
    this.heartbeatCalls.push(input);
  }

  async markSucceeded(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
  }): Promise<void> {
    this.succeededCalls.push(input);
  }

  async markFailed(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    this.failedCalls.push(input);
  }

  async requeueWithBackoff(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    nextRunAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    this.requeuedCalls.push(input);
  }
}
