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
  maxRetries: number;
  logLevel?: OpenAiLogLevel;
  onHttpAttempt?: (input: {
    attempt: number;
    method: string;
    url: string;
  }) => void;
  onHttpError?: (input: {
    attempt: number;
    method: string;
    url: string;
    error: unknown;
  }) => void;
};

type OpenAiProviderLogEvent = (event: string, fields: Record<string, unknown>) => void;
type OpenAiLogLevel = "debug" | "info" | "warn" | "error" | "off";

const REPORT_SCHEMA_DIR = path.join(resolveRepositoryRootDir(), "schemas", "report");
const schemaCache = new Map<string, Record<string, unknown>>();
const DEFAULT_OPENAI_MAX_RETRIES = 2;

export function createOpenAiProvider(options?: {
  createClient?: (input: CreateOpenAiClientInput) => OpenAiClientLike;
  maxRetries?: number;
  logLevel?: OpenAiLogLevel;
  logEvent?: OpenAiProviderLogEvent;
}): LlmProviderClient {
  const createClient = options?.createClient ?? createDefaultOpenAiClient;
  const maxRetries = normalizeMaxRetries(options?.maxRetries);
  const logLevel = options?.logLevel;
  const logEvent = options?.logEvent ?? (() => undefined);

  return {
    analyze: async (input) => analyzeWithOpenAi(createClient, input, { maxRetries, logLevel, logEvent }),
    classifyError: classifyOpenAiError,
  };
}

async function analyzeWithOpenAi(
  createClient: (input: CreateOpenAiClientInput) => OpenAiClientLike,
  input: ProviderAnalyzeInput,
  options: {
    maxRetries: number;
    logLevel?: OpenAiLogLevel;
    logEvent: OpenAiProviderLogEvent;
  },
): Promise<ProviderAnalyzeResult> {
  let requestPhase = "structured_json_schema";
  const client = createClient({
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs,
    maxRetries: options.maxRetries,
    logLevel: options.logLevel,
    onHttpAttempt: (details) => {
      options.logEvent("openai_http_attempt", {
        phase: requestPhase,
        attempt: details.attempt,
        method: details.method,
        url: details.url,
        maxRetries: options.maxRetries,
        model: input.model,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
      });
    },
    onHttpError: (details) => {
      options.logEvent("openai_http_error", {
        phase: requestPhase,
        attempt: details.attempt,
        method: details.method,
        url: details.url,
        maxRetries: options.maxRetries,
        model: input.model,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
        ...extractTransportErrorFields(details.error),
      });
    },
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
    requestPhase = "structured_json_schema";
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

  requestPhase = "fallback_json_object";
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
  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey: input.apiKey,
    timeout: input.timeoutMs,
    maxRetries: input.maxRetries,
    logLevel: input.logLevel,
  };

  if (input.onHttpAttempt || input.onHttpError) {
    clientOptions.fetch = createTelemetryFetch({
      onHttpAttempt: input.onHttpAttempt,
      onHttpError: input.onHttpError,
    });
  }

  return new OpenAI(clientOptions);
}

function createTelemetryFetch(input: {
  onHttpAttempt?: CreateOpenAiClientInput["onHttpAttempt"];
  onHttpError?: CreateOpenAiClientInput["onHttpError"];
}): typeof fetch {
  const baseFetch = globalThis.fetch.bind(globalThis);
  let attempt = 0;

  return async (url, init) => {
    attempt += 1;
    const method = resolveHttpMethod(url, init);
    const resolvedUrl = resolveHttpUrl(url);
    input.onHttpAttempt?.({
      attempt,
      method,
      url: resolvedUrl,
    });
    try {
      return await baseFetch(url, init);
    } catch (error) {
      input.onHttpError?.({
        attempt,
        method,
        url: resolvedUrl,
        error,
      });
      throw error;
    }
  };
}

function resolveHttpUrl(url: Parameters<typeof fetch>[0]): string {
  if (typeof url === "string") {
    return url;
  }
  if (url instanceof URL) {
    return url.toString();
  }
  if (url instanceof Request) {
    return url.url;
  }
  return "unknown";
}

function resolveHttpMethod(url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): string {
  if (typeof init?.method === "string" && init.method.trim()) {
    return init.method.trim().toUpperCase();
  }
  if (url instanceof Request && typeof url.method === "string" && url.method.trim()) {
    return url.method.trim().toUpperCase();
  }
  return "GET";
}

function normalizeMaxRetries(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_OPENAI_MAX_RETRIES;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("OpenAI maxRetries must be a non-negative integer");
  }
  return value;
}

function extractTransportErrorFields(error: unknown): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const parts = extractDiagnosticParts(error);
  for (const [key, value] of parts) {
    fields[key] = value;
  }
  return fields;
}

function extractDiagnosticParts(error: unknown): Array<[string, string]> {
  const root = toObjectRecord(error);
  if (!root) {
    return [];
  }

  const parts: Array<[string, string]> = [];
  let cursor: Record<string, unknown> | null = root;
  let depth = 0;
  while (cursor && depth < 4) {
    const label = depth === 0 ? "" : `cause${depth}_`;
    appendStringPart(parts, `${label}name`, readStringProperty(cursor, "name"));
    appendStringPart(parts, `${label}code`, readStringProperty(cursor, "code"));
    appendStringPart(parts, `${label}message`, compact(readStringProperty(cursor, "message"), 160));
    appendStringPart(parts, `${label}errno`, readNumberOrStringProperty(cursor, "errno"));
    appendStringPart(parts, `${label}syscall`, readStringProperty(cursor, "syscall"));
    appendStringPart(parts, `${label}type`, readStringProperty(cursor, "type"));
    cursor = readObjectProperty(cursor, "cause");
    depth += 1;
  }

  const undiciCode = parts.find(([key, value]) => key.endsWith("code") && /^UND_ERR_/.test(value))?.[1] ?? "";
  appendStringPart(parts, "undici_code", undiciCode);

  return dedupeParts(parts);
}

function appendStringPart(parts: Array<[string, string]>, key: string, value: string): void {
  if (!value) {
    return;
  }
  parts.push([key, value]);
}

function dedupeParts(parts: Array<[string, string]>): Array<[string, string]> {
  const seen = new Set<string>();
  const output: Array<[string, string]> = [];
  for (const part of parts) {
    const signature = `${part[0]}=${part[1]}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    output.push(part);
  }
  return output;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

export function classifyOpenAiError(error: unknown): LlmProviderErrorClassification | null {
  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      errorCode: "llm_timeout",
      retriable: true,
      errorSummary: sanitizeSummary(error),
    };
  }

  if (error instanceof OpenAI.APIConnectionError) {
    return {
      errorCode: "llm_network_error",
      retriable: true,
      errorSummary: sanitizeSummary(error),
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
  const compactBase = raw.replace(/\s+/g, " ").trim();
  const diagnostics = extractDiagnosticContext(error);
  const compact = diagnostics ? `${compactBase} [${diagnostics}]` : compactBase;
  if (!compact) {
    return "llm_provider_failed";
  }
  return compact.slice(0, 280);
}

function extractDiagnosticContext(error: unknown): string {
  const root = toObjectRecord(error);
  if (!root) {
    return "";
  }

  const parts: string[] = [];

  let cursor: Record<string, unknown> | null = root;
  let depth = 0;
  while (cursor && depth < 3) {
    const label = depth === 0 ? "" : `cause${depth}_`;
    const code = readStringProperty(cursor, "code");
    if (code) {
      parts.push(`${label}code=${code}`);
    }

    const errno = readNumberOrStringProperty(cursor, "errno");
    if (errno) {
      parts.push(`${label}errno=${errno}`);
    }

    const syscall = readStringProperty(cursor, "syscall");
    if (syscall) {
      parts.push(`${label}syscall=${syscall}`);
    }

    cursor = readObjectProperty(cursor, "cause");
    depth += 1;
  }

  return [...new Set(parts)].join(" ");
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readObjectProperty(value: unknown, key: string): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  return candidate as Record<string, unknown>;
}

function readStringProperty(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") {
    return "";
  }
  return candidate.trim();
}

function readNumberOrStringProperty(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    return "";
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return String(candidate);
  }
  if (typeof candidate === "string") {
    return candidate.trim();
  }
  return "";
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
