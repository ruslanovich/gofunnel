export type QueuedProcessingJob = {
  id: string;
  fileId: string;
  attempts: number;
  maxAttempts: number;
  lockTtlSeconds: number;
};

export interface ProcessingWorkerRepository {
  claimReadyJob(input: { workerId: string }): Promise<QueuedProcessingJob | null>;
  touchHeartbeat(input: { jobId: string; workerId: string }): Promise<void>;
  markSucceeded(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
  }): Promise<void>;
  markFailed(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  requeueWithBackoff(input: {
    jobId: string;
    fileId: string;
    workerId: string;
    attempts: number;
    nextRunAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

export interface ProcessingJobProcessor {
  process(job: QueuedProcessingJob): Promise<void>;
}

export interface HeartbeatScheduler {
  every(intervalMs: number, task: () => Promise<void>): { stop(): void };
}

type WorkerLogEvent = (
  event: "worker_loop_error" | "worker_heartbeat_error",
  fields: Record<string, unknown>,
) => void;

type ProcessingWorkerDeps = {
  workerId: string;
  concurrency: number;
  pollMs: number;
  repository: ProcessingWorkerRepository;
  processor: ProcessingJobProcessor;
  heartbeatScheduler?: HeartbeatScheduler;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  logEvent?: WorkerLogEvent;
};

const DEFAULT_BACKOFF_MS_BY_NEXT_ATTEMPT: Record<number, number> = {
  2: 30_000,
  3: 120_000,
  4: 480_000,
};

const RETRY_JITTER_RATIO = 0.2;

export class ProcessingJobError extends Error {
  readonly code: string;
  readonly retriable: boolean;

  constructor(input: { code: string; message: string; retriable: boolean }) {
    super(input.message);
    this.name = "ProcessingJobError";
    this.code = input.code;
    this.retriable = input.retriable;
  }
}

export class IntervalHeartbeatScheduler implements HeartbeatScheduler {
  every(intervalMs: number, task: () => Promise<void>): { stop(): void } {
    const timer = setInterval(() => {
      void task().catch(() => undefined);
    }, intervalMs);
    timer.unref?.();
    return {
      stop: () => clearInterval(timer),
    };
  }
}

export class ProcessingWorker {
  private readonly inFlight = new Set<Promise<void>>();
  private readonly heartbeatScheduler: HeartbeatScheduler;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly logEvent: WorkerLogEvent;
  private stopRequested = false;
  private running = false;

  constructor(private readonly deps: ProcessingWorkerDeps) {
    this.heartbeatScheduler = deps.heartbeatScheduler ?? new IntervalHeartbeatScheduler();
    this.sleep = deps.sleep ?? sleepWithTimeout;
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.logEvent = deps.logEvent ?? (() => undefined);
  }

  async run(): Promise<void> {
    if (this.running) {
      throw new Error("worker_already_running");
    }

    this.running = true;
    try {
      while (!this.stopRequested) {
        await this.fillConcurrencySlots();

        if (this.stopRequested) {
          break;
        }

        await this.sleep(this.deps.pollMs);
      }
    } finally {
      await Promise.allSettled([...this.inFlight]);
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
  }

  async processClaimedJob(job: QueuedProcessingJob): Promise<void> {
    const heartbeatIntervalMs = toHeartbeatIntervalMs(job.lockTtlSeconds);
    const heartbeat = this.heartbeatScheduler.every(heartbeatIntervalMs, async () => {
      try {
        await this.deps.repository.touchHeartbeat({
          jobId: job.id,
          workerId: this.deps.workerId,
        });
      } catch (error) {
        this.logEvent("worker_heartbeat_error", {
          workerId: this.deps.workerId,
          jobId: job.id,
          error: sanitizeErrorMessage(error),
        });
      }
    });

    try {
      await this.deps.processor.process(job);
      await this.deps.repository.markSucceeded({
        jobId: job.id,
        fileId: job.fileId,
        workerId: this.deps.workerId,
        attempts: job.attempts,
      });
      return;
    } catch (error) {
      const normalized = normalizeProcessingError(error);

      if (normalized.retriable && job.attempts < job.maxAttempts) {
        const retryDelayMs = computeRetryDelayMs(job.attempts, this.random);
        await this.deps.repository.requeueWithBackoff({
          jobId: job.id,
          fileId: job.fileId,
          workerId: this.deps.workerId,
          attempts: job.attempts,
          nextRunAt: new Date(this.now().getTime() + retryDelayMs),
          errorCode: normalized.code,
          errorMessage: normalized.message,
        });
        return;
      }

      await this.deps.repository.markFailed({
        jobId: job.id,
        fileId: job.fileId,
        workerId: this.deps.workerId,
        attempts: job.attempts,
        errorCode: normalized.code,
        errorMessage: normalized.message,
      });
    } finally {
      heartbeat.stop();
    }
  }

  private async fillConcurrencySlots(): Promise<void> {
    while (!this.stopRequested && this.inFlight.size < this.deps.concurrency) {
      const claimed = await this.deps.repository.claimReadyJob({
        workerId: this.deps.workerId,
      });
      if (!claimed) {
        break;
      }

      let current: Promise<void>;
      current = this.processClaimedJob(claimed)
        .catch((error) => {
          this.logEvent("worker_loop_error", {
            workerId: this.deps.workerId,
            jobId: claimed.id,
            error: sanitizeErrorMessage(error),
          });
        })
        .finally(() => {
          this.inFlight.delete(current);
        });
      this.inFlight.add(current);
    }
  }
}

export function computeRetryDelayMs(currentAttempts: number, random: () => number): number {
  const nextAttempt = currentAttempts + 1;
  const baseDelayMs = DEFAULT_BACKOFF_MS_BY_NEXT_ATTEMPT[nextAttempt] ?? DEFAULT_BACKOFF_MS_BY_NEXT_ATTEMPT[4];
  const randomUnit = clampRandomUnit(random());
  const jitterFactor = 1 + ((randomUnit * 2) - 1) * RETRY_JITTER_RATIO;
  return Math.max(1_000, Math.round(baseDelayMs * jitterFactor));
}

function clampRandomUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function toHeartbeatIntervalMs(lockTtlSeconds: number): number {
  const ttlMs = Math.max(1, lockTtlSeconds) * 1_000;
  return Math.max(1_000, Math.floor(ttlMs / 3));
}

function sleepWithTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeProcessingError(error: unknown): {
  code: string;
  message: string;
  retriable: boolean;
} {
  if (error instanceof ProcessingJobError) {
    return {
      code: sanitizeErrorCode(error.code),
      message: sanitizeErrorMessage(error.message),
      retriable: error.retriable,
    };
  }

  return {
    code: "processing_failed",
    message: sanitizeErrorMessage(error),
    retriable: false,
  };
}

export function sanitizeErrorCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!normalized) {
    return "unknown_error";
  }
  return normalized.slice(0, 64);
}

export function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown_error");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "unknown_error";
  }
  return collapsed.slice(0, 280);
}
