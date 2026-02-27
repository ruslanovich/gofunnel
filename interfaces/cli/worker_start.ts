import os from "node:os";

import { createReportPipelineProcessor } from "../../app/processing/report_pipeline_processor.js";
import { ProcessingWorker } from "../../app/processing/worker.js";
import { createPgPool } from "../../infra/db/client.js";
import { createLlmAdapter, type LlmProviderClient } from "../../infra/processing/llm_adapter.js";
import { createOpenAiProvider } from "../../infra/processing/openai_provider.js";
import { PostgresProcessingJobRepository } from "../../infra/processing/postgres_processing_job_repository.js";
import { validateReportPayload } from "../../infra/processing/report_schema_validator.js";
import { createS3StorageService } from "../../infra/storage/s3_client.js";

const DEFAULT_WORKER_LLM_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const concurrency = parsePositiveIntegerEnv("WORKER_CONCURRENCY", 2);
  const pollMs = parsePositiveIntegerEnv("WORKER_POLL_MS", 1_000);
  const llmTimeoutMs = parsePositiveIntegerEnv("WORKER_LLM_TIMEOUT_MS", DEFAULT_WORKER_LLM_TIMEOUT_MS);
  const workerId = process.env.WORKER_ID?.trim() || `${os.hostname()}:${process.pid}`;

  const pool = createPgPool("gofunnel-worker");
  const repository = new PostgresProcessingJobRepository(pool);
  const storage = createS3StorageService();
  const llmAdapter = createLlmAdapter({
    providers: createWorkerLlmProviderRegistry(),
  });
  const processor = createReportPipelineProcessor({
    fileRepository: repository,
    storage,
    llmAdapter,
    validateReportPayload,
    llmTimeoutMs,
    logEvent: (event, fields) => {
      console.error(
        JSON.stringify(
          {
            event,
            ...fields,
          },
          null,
          2,
        ),
      );
    },
  });

  const worker = new ProcessingWorker({
    workerId,
    concurrency,
    pollMs,
    repository,
    processor,
    logEvent: (event, fields) => {
      console.error(
        JSON.stringify(
          {
            event,
            ...fields,
          },
          null,
          2,
        ),
      );
    },
  });

  const shutdown = () => {
    void worker.stop();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await worker.run();
  } finally {
    await pool.end();
  }
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return defaultValue;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function createWorkerLlmProviderRegistry(): Record<string, LlmProviderClient> {
  const fakeProvider: LlmProviderClient = {
    analyze: async () => {
      throw new Error("Fake LLM provider is enabled. Use only for tests or explicit local diagnostics.");
    },
    classifyError: () => ({
      errorCode: "llm_fake_provider_invoked",
      retriable: false,
      errorSummary: "Fake LLM provider is enabled and does not execute real requests",
    }),
  };

  return {
    openai: createOpenAiProvider(),
    fake: fakeProvider,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
