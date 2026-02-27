import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ProcessingJobError,
  ProcessingWorker,
  type HeartbeatScheduler,
  type ProcessingJobProcessor,
  type ProcessingWorkerRepository,
  type QueuedProcessingJob,
} from "./worker.js";

test("heartbeat is updated during long-running processing via scheduler ticks", async () => {
  const claimedJob: QueuedProcessingJob = {
    id: "11111111-1111-4111-8111-111111111111",
    fileId: "22222222-2222-4222-8222-222222222222",
    attempts: 1,
    maxAttempts: 4,
    lockTtlSeconds: 30,
  };

  const scheduler = new ManualHeartbeatScheduler();
  const repository = new FakeWorkerRepository();
  const deferred = createDeferred<void>();

  const processor: ProcessingJobProcessor = {
    process: async () => deferred.promise,
  };

  const worker = new ProcessingWorker({
    workerId: "worker-heartbeat-test",
    concurrency: 1,
    pollMs: 1000,
    repository,
    processor,
    heartbeatScheduler: scheduler,
    random: () => 0.5,
  });

  const processingPromise = worker.processClaimedJob(claimedJob);

  await scheduler.tickAll();
  await scheduler.tickAll();
  assert.equal(repository.heartbeatCalls.length, 2);
  assert.deepEqual(repository.heartbeatCalls[0], {
    jobId: claimedJob.id,
    workerId: "worker-heartbeat-test",
  });

  deferred.resolve();
  await processingPromise;
  assert.equal(repository.succeededCalls.length, 1);
  assert.equal(repository.failedCalls.length, 0);
  assert.equal(repository.requeuedCalls.length, 0);
});

test("retriable processing error requeues job with deterministic backoff", async () => {
  const claimedJob: QueuedProcessingJob = {
    id: "33333333-3333-4333-8333-333333333333",
    fileId: "44444444-4444-4444-8444-444444444444",
    attempts: 1,
    maxAttempts: 4,
    lockTtlSeconds: 30,
  };

  const scheduler = new ManualHeartbeatScheduler();
  const repository = new FakeWorkerRepository();

  const processor: ProcessingJobProcessor = {
    process: async () => {
      throw new ProcessingJobError({
        code: "llm_timeout",
        message: "temporary timeout",
        retriable: true,
      });
    },
  };

  const worker = new ProcessingWorker({
    workerId: "worker-retry-test",
    concurrency: 1,
    pollMs: 1000,
    repository,
    processor,
    heartbeatScheduler: scheduler,
    now: () => new Date("2026-02-27T12:00:00.000Z"),
    random: () => 0.5,
  });

  await worker.processClaimedJob(claimedJob);

  assert.equal(repository.requeuedCalls.length, 1);
  assert.equal(repository.failedCalls.length, 0);
  assert.equal(repository.succeededCalls.length, 0);

  const requeued = repository.requeuedCalls[0];
  assert.equal(requeued?.jobId, claimedJob.id);
  assert.equal(requeued?.fileId, claimedJob.fileId);
  assert.equal(requeued?.errorCode, "llm_timeout");
  assert.equal(requeued?.errorMessage, "temporary timeout");
  assert.equal(requeued?.nextRunAt.toISOString(), "2026-02-27T12:00:30.000Z");
});

class ManualHeartbeatScheduler implements HeartbeatScheduler {
  private readonly tasks = new Map<number, () => Promise<void>>();
  private nextId = 0;

  every(_intervalMs: number, task: () => Promise<void>): { stop(): void } {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, task);

    return {
      stop: () => {
        this.tasks.delete(id);
      },
    };
  }

  async tickAll(): Promise<void> {
    const currentTasks = [...this.tasks.values()];
    for (const task of currentTasks) {
      await task();
    }
  }
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((internalResolve, internalReject) => {
    resolve = internalResolve;
    reject = internalReject;
  });
  return { promise, resolve, reject };
}
