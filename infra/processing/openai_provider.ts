import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";

import type {
  LlmProviderClient,
  LlmProviderErrorClassification,
  ProviderAnalyzeInput,
  ProviderAnalyzeResult,
} from "./llm_adapter.js";
import { normalizeForStructuredOutputsStrict } from "./schema_normalizer.js";

type OpenAiClientLike = {
  responses: {
    create: (request: Record<string, unknown>) => Promise<unknown>;
  };
};

type CreateOpenAiClientInput = {
  apiKey: string;
  timeoutMs: number;
};

const REPORT_SCHEMA_DIR = path.join(resolveRepositoryRootDir(), "schemas", "report");
const schemaCache = new Map<string, Record<string, unknown>>();

export function createOpenAiProvider(options?: {
  createClient?: (input: CreateOpenAiClientInput) => OpenAiClientLike;
}): LlmProviderClient {
  const createClient = options?.createClient ?? createDefaultOpenAiClient;
  return {
    analyze: async (input) => analyzeWithOpenAi(createClient, input),
    classifyError: classifyOpenAiError,
  };
}

async function analyzeWithOpenAi(
  createClient: (input: CreateOpenAiClientInput) => OpenAiClientLike,
  input: ProviderAnalyzeInput,
): Promise<ProviderAnalyzeResult> {
  const client = createClient({
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
  });

  const schema = loadReportSchema(input.schemaVersion);
  const structuredRequest = {
    model: input.model,
    instructions: input.promptText,
    input: input.transcriptText,
    text: {
      format: {
        type: "json_schema",
        name: `report_${input.schemaVersion}`,
        schema,
        strict: true,
      },
    },
  } as const;

  try {
    const response = await client.responses.create(structuredRequest);
    const rawText = extractOutputText(response);
    return {
      rawText,
      parsedJson: parseJsonSafe(rawText),
    };
  } catch (error) {
    if (!isStructuredOutputUnsupportedError(error)) {
      throw error;
    }
  }

  const fallbackResponse = await client.responses.create({
    model: input.model,
    instructions: `${input.promptText}\n\nReturn exactly one JSON object and nothing else.`,
    input: input.transcriptText,
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  const fallbackRawText = extractOutputText(fallbackResponse);
  return {
    rawText: fallbackRawText,
    parsedJson: parseJsonSafe(fallbackRawText),
  };
}

function createDefaultOpenAiClient(input: CreateOpenAiClientInput): OpenAiClientLike {
  return new OpenAI({
    apiKey: input.apiKey,
    timeout: input.timeoutMs,
    maxRetries: 0,
  });
}

export function classifyOpenAiError(error: unknown): LlmProviderErrorClassification | null {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      errorCode: "llm_timeout",
      retriable: true,
      errorSummary: sanitizeSummary(error.message),
    };
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return {
      errorCode: "llm_network_error",
      retriable: true,
      errorSummary: sanitizeSummary(error.message),
    };
  }

  if (error instanceof OpenAI.RateLimitError) {
    return {
      errorCode: "llm_rate_limited",
      retriable: true,
      errorSummary: sanitizeSummary(error.message),
    };
  }

  if (error instanceof OpenAI.InternalServerError) {
    return {
      errorCode: "llm_provider_5xx",
      retriable: true,
      errorSummary: sanitizeSummary(error.message),
    };
  }

  const statusCode = getStatusCode(error);
  if (statusCode === 408) {
    return {
      errorCode: "llm_timeout",
      retriable: true,
      errorSummary: sanitizeSummary(error),
    };
  }
  if (statusCode === 429) {
    return {
      errorCode: "llm_rate_limited",
      retriable: true,
      errorSummary: sanitizeSummary(error),
    };
  }
  if (statusCode !== null && statusCode >= 500) {
    return {
      errorCode: "llm_provider_5xx",
      retriable: true,
      errorSummary: sanitizeSummary(error),
    };
  }
  if (statusCode !== null && statusCode >= 400) {
    return {
      errorCode: `llm_provider_${statusCode}`,
      retriable: false,
      errorSummary: sanitizeSummary(error),
    };
  }

  const code = getErrorCode(error);
  if (RETRIABLE_NETWORK_ERROR_CODES.has(code)) {
    return {
      errorCode: "llm_network_error",
      retriable: true,
      errorSummary: sanitizeSummary(error),
    };
  }

  if (hasTimeoutName(error)) {
    return {
      errorCode: "llm_timeout",
      retriable: true,
      errorSummary: sanitizeSummary(error),
    };
  }

  return null;
}

function extractOutputText(response: unknown): string {
  if (typeof response !== "object" || response === null) {
    throw new Error("OpenAI response payload is invalid");
  }

  const outputText = (response as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = (response as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const part of content) {
        if (typeof part !== "object" || part === null) {
          continue;
        }

        const partType = (part as { type?: unknown }).type;
        const text = (part as { text?: unknown }).text;
        if (partType === "output_text" && typeof text === "string" && text.trim()) {
          return text.trim();
        }
      }
    }
  }

  throw new Error("OpenAI response did not contain text output");
}

function loadReportSchema(schemaVersion: string): Record<string, unknown> {
  const cached = schemaCache.get(schemaVersion);
  if (cached) {
    return cached;
  }

  const schemaPath = path.join(REPORT_SCHEMA_DIR, `${schemaVersion}.json`);
  const raw = readFileSync(schemaPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Report schema "${schemaVersion}" must be a JSON object`);
  }

  const schema = parsed as Record<string, unknown>;
  const normalizedSchema = normalizeForStructuredOutputsStrict(schema);
  if (typeof normalizedSchema !== "object" || normalizedSchema === null || Array.isArray(normalizedSchema)) {
    throw new Error(`Report schema "${schemaVersion}" normalized into a non-object`);
  }

  const normalizedObjectSchema = normalizedSchema as Record<string, unknown>;
  schemaCache.set(schemaVersion, normalizedObjectSchema);
  return normalizedObjectSchema;
}

function parseJsonSafe(rawText: string): unknown | undefined {
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return undefined;
  }
}

function getStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const withStatus = error as { status?: unknown; statusCode?: unknown };
  if (typeof withStatus.status === "number") {
    return withStatus.status;
  }
  if (typeof withStatus.statusCode === "number") {
    return withStatus.statusCode;
  }

  return null;
}

function getErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    return "";
  }
  return code;
}

function hasTimeoutName(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (typeof name !== "string") {
    return false;
  }
  return /timeout/i.test(name);
}

function isStructuredOutputUnsupportedError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode !== 400) {
    return false;
  }

  const message = sanitizeSummary(error);
  return /json_schema|structured output|response format|not supported/i.test(message);
}

function sanitizeSummary(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : null;
  const raw = error instanceof Error ? error.message : (message ?? String(error ?? "llm_provider_failed"));
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "llm_provider_failed";
  }
  return compact.slice(0, 280);
}

const RETRIABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

function resolveRepositoryRootDir(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}
