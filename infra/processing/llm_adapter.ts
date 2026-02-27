import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveReportContractVersions } from "../../app/processing/report_contract.js";

const DEFAULT_LLM_TIMEOUT_MS = 20_000;
const DEFAULT_LLM_PROVIDER = "openai";
const DEFAULT_TEST_LLM_PROVIDER = "fake";
const DEFAULT_LLM_MODEL = "gpt-5-mini";

const PROMPT_DIR = path.join(resolveRepositoryRootDir(), "prompts", "report");
const promptCache = new Map<string, string>();

export type LlmProviderConfig = {
  provider: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export type AnalyzeTranscriptInput = {
  transcriptText: string;
  promptVersion?: string;
  schemaVersion?: string;
  timeoutMs?: number;
};

export type AnalyzeTranscriptResult = {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  rawText: string;
  parsedJson: unknown;
};

export type LlmProviderErrorClassification = {
  errorCode: string;
  retriable: boolean;
  errorSummary: string;
};

export type ProviderAnalyzeInput = {
  transcriptText: string;
  promptText: string;
  promptVersion: string;
  schemaVersion: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export type ProviderAnalyzeResult = {
  rawText: string;
  parsedJson?: unknown;
};

export interface LlmProviderClient {
  analyze(input: ProviderAnalyzeInput): Promise<ProviderAnalyzeResult>;
  classifyError?(error: unknown): LlmProviderErrorClassification | null;
}

export interface LlmAdapter {
  analyzeTranscript(input: AnalyzeTranscriptInput): Promise<AnalyzeTranscriptResult>;
  classifyError(error: unknown): LlmProviderErrorClassification;
}

export class LlmAdapterError extends Error {
  readonly code: string;
  readonly retriable: boolean;

  constructor(input: { code: string; retriable: boolean; message: string }) {
    super(input.message);
    this.name = "LlmAdapterError";
    this.code = sanitizeErrorCode(input.code);
    this.retriable = input.retriable;
  }
}

export function createLlmAdapter(options: {
  env?: NodeJS.ProcessEnv;
  providers: Record<string, LlmProviderClient>;
}): LlmAdapter {
  const config = loadLlmProviderConfig(options.env);
  const provider = options.providers[config.provider];
  if (!provider) {
    throw new Error(
      `Unsupported LLM_PROVIDER "${config.provider}". Register a provider client for this key.`,
    );
  }
  return new ConfiguredLlmAdapter(config, provider);
}

export function loadLlmProviderConfig(env: NodeJS.ProcessEnv = process.env): LlmProviderConfig {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase() ?? "";
  const explicitProvider = env.LLM_PROVIDER?.trim().toLowerCase() ?? "";
  const provider = explicitProvider || (nodeEnv === "test" ? DEFAULT_TEST_LLM_PROVIDER : DEFAULT_LLM_PROVIDER);

  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;
  const apiKey = env.LLM_API_KEY?.trim() ?? "";

  const timeoutMs = parseOptionalPositiveInteger(env.LLM_TIMEOUT_MS, DEFAULT_LLM_TIMEOUT_MS);

  if (nodeEnv === "production" && provider === "fake") {
    throw new Error("LLM fake provider is not allowed in production");
  }

  if (provider !== "fake" && !apiKey) {
    throw new Error(formatMissingLlmApiKeyError());
  }

  if (nodeEnv === "production" && !apiKey) {
    throw new Error(formatMissingLlmApiKeyError());
  }

  return {
    provider,
    model,
    apiKey,
    timeoutMs,
  };
}

class ConfiguredLlmAdapter implements LlmAdapter {
  constructor(
    private readonly config: LlmProviderConfig,
    private readonly provider: LlmProviderClient,
  ) {}

  async analyzeTranscript(input: AnalyzeTranscriptInput): Promise<AnalyzeTranscriptResult> {
    const transcriptText = normalizeRequiredText(input.transcriptText, "transcriptText");
    const versions = resolveReportContractVersions({
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
    });
    const timeoutMs = normalizeTimeoutMs(input.timeoutMs, this.config.timeoutMs);

    try {
      const providerOutput = await withTimeout(
        this.provider.analyze({
          transcriptText,
          promptText: loadReportPromptText(versions.promptVersion),
          promptVersion: versions.promptVersion,
          schemaVersion: versions.schemaVersion,
          model: this.config.model,
          apiKey: this.config.apiKey,
          timeoutMs,
        }),
        timeoutMs,
      );

      const rawText = normalizeRequiredText(providerOutput.rawText, "rawText");
      const parsedJson = providerOutput.parsedJson ?? parseRawJson(rawText);

      return {
        provider: this.config.provider,
        model: this.config.model,
        promptVersion: versions.promptVersion,
        schemaVersion: versions.schemaVersion,
        rawText,
        parsedJson,
      };
    } catch (error) {
      const classified = this.classifyError(error);
      throw new LlmAdapterError({
        code: classified.errorCode,
        retriable: classified.retriable,
        message: classified.errorSummary,
      });
    }
  }

  classifyError(error: unknown): LlmProviderErrorClassification {
    if (error instanceof LlmAdapterError) {
      return {
        errorCode: error.code,
        retriable: error.retriable,
        errorSummary: sanitizeErrorSummary(error.message),
      };
    }

    const providerError = this.provider.classifyError?.(error);
    if (providerError) {
      return normalizeClassification(providerError);
    }

    return {
      errorCode: "llm_provider_failed",
      retriable: false,
      errorSummary: sanitizeErrorSummary(error),
    };
  }
}

function parseRawJson(rawText: string): unknown {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new LlmAdapterError({
      code: "llm_output_invalid_json",
      retriable: false,
      message: "LLM output is not valid JSON",
    });
  }
}

function loadReportPromptText(promptVersion: string): string {
  const cached = promptCache.get(promptVersion);
  if (cached) {
    return cached;
  }

  const promptPath = path.join(PROMPT_DIR, `${promptVersion}.txt`);
  const promptText = readFileSync(promptPath, "utf8");
  promptCache.set(promptVersion, promptText);
  return promptText;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new LlmAdapterError({
          code: "llm_timeout",
          retriable: true,
          message: `LLM request timed out after ${timeoutMs}ms`,
        }),
      );
    }, timeoutMs);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeClassification(
  classification: LlmProviderErrorClassification,
): LlmProviderErrorClassification {
  return {
    errorCode: sanitizeErrorCode(classification.errorCode),
    retriable: classification.retriable,
    errorSummary: sanitizeErrorSummary(classification.errorSummary),
  };
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return normalized;
}

function normalizeTimeoutMs(timeoutMs: number | undefined, fallback: number): number {
  if (timeoutMs === undefined) {
    return fallback;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("timeoutMs must be a positive integer");
  }
  return timeoutMs;
}

function parseOptionalPositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error("LLM_TIMEOUT_MS must be a positive integer");
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("LLM_TIMEOUT_MS must be a positive integer");
  }
  return parsed;
}

function sanitizeErrorCode(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!normalized) {
    return "llm_provider_failed";
  }
  return normalized.slice(0, 64);
}

function sanitizeErrorSummary(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "llm_provider_failed");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return "llm_provider_failed";
  }
  return collapsed.slice(0, 280);
}

function formatMissingLlmApiKeyError(): string {
  return [
    "Missing required LLM environment variable: LLM_API_KEY",
    "Set server-side LLM variables before starting the worker:",
    `LLM_PROVIDER=<provider-id> (default: ${DEFAULT_LLM_PROVIDER}; test default: ${DEFAULT_TEST_LLM_PROVIDER})`,
    `LLM_MODEL=<model-name> (default: ${DEFAULT_LLM_MODEL})`,
    "LLM_API_KEY=<secret-key>",
  ].join("\n");
}

function resolveRepositoryRootDir(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}
