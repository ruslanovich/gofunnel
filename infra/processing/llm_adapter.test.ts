import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LlmAdapterError,
  createLlmAdapter,
  loadLlmProviderConfig,
  type LlmProviderClient,
  type LlmProviderErrorClassification,
  type ProviderAnalyzeInput,
} from "./llm_adapter.js";
import { createOpenAiProvider } from "./openai_provider.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  LLM_PROVIDER: "fake",
  LLM_MODEL: "test-model-v1",
  LLM_API_KEY: "test-api-key",
};

test("analyzeTranscript returns rawText and parsedJson using default prompt/schema versions", async () => {
  const calls: ProviderAnalyzeInput[] = [];
  const provider = createFakeProvider({
    run: async (input) => {
      calls.push(input);
      return {
        rawText: JSON.stringify({
          overview: "ok",
        }),
      };
    },
  });

  const adapter = createLlmAdapter({
    env: BASE_ENV,
    providers: {
      fake: provider,
    },
  });

  const result = await adapter.analyzeTranscript({
    transcriptText: "hello transcript",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.promptVersion, "v1");
  assert.equal(calls[0]?.schemaVersion, "v1");
  assert.match(calls[0]?.promptText ?? "", /report\/v1/i);
  assert.equal(result.rawText, JSON.stringify({ overview: "ok" }));
  assert.deepEqual(result.parsedJson, { overview: "ok" });
});

test("retriable provider error is normalized as retriable adapter error", async () => {
  const provider = createFakeProvider({
    run: async () => {
      throw new Error("too many requests");
    },
    classifyError: () => ({
      errorCode: "llm_rate_limited",
      retriable: true,
      errorSummary: "provider rate limited request",
    }),
  });

  const adapter = createLlmAdapter({
    env: BASE_ENV,
    providers: {
      fake: provider,
    },
  });

  await assert.rejects(
    () =>
      adapter.analyzeTranscript({
        transcriptText: "hello transcript",
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmAdapterError);
      assert.equal(error.code, "llm_rate_limited");
      assert.equal(error.retriable, true);
      assert.match(error.message, /rate limited/i);
      return true;
    },
  );
});

test("fatal provider error is normalized as non-retriable adapter error", async () => {
  const provider = createFakeProvider({
    run: async () => {
      throw new Error("invalid request");
    },
    classifyError: () => ({
      errorCode: "llm_bad_request",
      retriable: false,
      errorSummary: "invalid LLM request",
    }),
  });

  const adapter = createLlmAdapter({
    env: BASE_ENV,
    providers: {
      fake: provider,
    },
  });

  await assert.rejects(
    () =>
      adapter.analyzeTranscript({
        transcriptText: "hello transcript",
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmAdapterError);
      assert.equal(error.code, "llm_bad_request");
      assert.equal(error.retriable, false);
      return true;
    },
  );
});

test("timeout hook marks errors as retriable timeout failures", async () => {
  const provider = createFakeProvider({
    run: async () => new Promise<never>(() => undefined),
  });

  const adapter = createLlmAdapter({
    env: BASE_ENV,
    providers: {
      fake: provider,
    },
  });

  await assert.rejects(
    () =>
      adapter.analyzeTranscript({
        transcriptText: "hello transcript",
        timeoutMs: 10,
      }),
    (error: unknown) => {
      assert.ok(error instanceof LlmAdapterError);
      assert.equal(error.code, "llm_timeout");
      assert.equal(error.retriable, true);
      return true;
    },
  );
});

test("provider selection defaults to openai outside test env", async () => {
  const calls: ProviderAnalyzeInput[] = [];
  const adapter = createLlmAdapter({
    env: {
      NODE_ENV: "development",
      LLM_API_KEY: "openai-test-key",
    },
    providers: {
      openai: createFakeProvider({
        run: async (input) => {
          calls.push(input);
          return {
            rawText: JSON.stringify({ ok: true }),
          };
        },
      }),
    },
  });

  const result = await adapter.analyzeTranscript({
    transcriptText: "hello transcript",
  });

  assert.equal(calls.length, 1);
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5-mini");
});

test("config defaults to fake in test env and does not require API key", () => {
  const config = loadLlmProviderConfig({
    NODE_ENV: "test",
  });

  assert.equal(config.provider, "fake");
  assert.equal(config.model, "gpt-5-mini");
  assert.equal(config.apiKey, "");
});

test("config allows fake provider explicitly outside test", () => {
  const config = loadLlmProviderConfig({
    NODE_ENV: "development",
    LLM_PROVIDER: "fake",
  });

  assert.equal(config.provider, "fake");
  assert.equal(config.model, "gpt-5-mini");
  assert.equal(config.apiKey, "");
});

test("production fails fast when fake provider is configured", () => {
  assert.throws(
    () =>
      loadLlmProviderConfig({
        NODE_ENV: "production",
        LLM_PROVIDER: "fake",
        LLM_MODEL: "gpt-5-mini",
        LLM_API_KEY: "should-not-matter",
      }),
    /fake provider is not allowed in production/i,
  );
});

test("production fails fast when API key is missing", () => {
  assert.throws(
    () =>
      loadLlmProviderConfig({
        NODE_ENV: "production",
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5-mini",
      }),
    /LLM_API_KEY/i,
  );
});

test("openai provider analyze uses structured output request and returns parsed JSON", async () => {
  const calls: unknown[] = [];
  const provider = createOpenAiProvider({
    createClient: () => ({
      responses: {
        create: async (request) => {
          calls.push(request);
          return {
            output_text: "{\"overview\":\"ok\"}",
          };
        },
      },
    }),
  });

  const result = await provider.analyze({
    transcriptText: "hello transcript",
    promptText: "return json only",
    promptVersion: "v1",
    schemaVersion: "v1",
    model: "gpt-5-mini",
    apiKey: "test-api-key",
    timeoutMs: 2000,
  });

  assert.equal(calls.length, 1);
  const structuredRequest = calls[0] as {
    text?: {
      format?: {
        type?: unknown;
        name?: unknown;
        strict?: unknown;
        schema?: unknown;
        json_schema?: unknown;
      };
    };
  };
  assert.equal(structuredRequest.text?.format?.type, "json_schema");
  assert.equal(structuredRequest.text?.format?.name, "report_v1");
  assert.equal(structuredRequest.text?.format?.strict, true);
  assert.ok(structuredRequest.text?.format?.schema);
  const schema = structuredRequest.text?.format?.schema as {
    properties?: {
      nextSteps?: {
        items?: {
          required?: unknown;
        };
      };
    };
  };
  const nextStepsRequired = schema.properties?.nextSteps?.items?.required;
  assert.ok(Array.isArray(nextStepsRequired));
  assert.ok(nextStepsRequired.includes("dueDate"));
  assert.equal(structuredRequest.text?.format?.json_schema, undefined);
  assert.equal(result.rawText, "{\"overview\":\"ok\"}");
  assert.deepEqual(result.parsedJson, { overview: "ok" });
});

test("openai provider classifies 429/5xx/timeout as retriable", () => {
  const provider = createOpenAiProvider({
    createClient: () => ({
      responses: {
        create: async () => ({
          output_text: "{\"overview\":\"ok\"}",
        }),
      },
    }),
  });

  const rateLimited = provider.classifyError?.({
    status: 429,
    message: "rate limited",
  });
  assert.equal(rateLimited?.retriable, true);

  const serverError = provider.classifyError?.({
    status: 503,
    message: "upstream error",
  });
  assert.equal(serverError?.retriable, true);

  const timeoutError = provider.classifyError?.({
    name: "APIConnectionTimeoutError",
    message: "request timed out",
  });
  assert.equal(timeoutError?.retriable, true);

  const badRequest = provider.classifyError?.({
    status: 400,
    message: "invalid request",
  });
  assert.equal(badRequest?.retriable, false);
});

function createFakeProvider(input: {
  run: (
    providerInput: ProviderAnalyzeInput,
  ) => Promise<{
    rawText: string;
    parsedJson?: unknown;
  }>;
  classifyError?: (error: unknown) => LlmProviderErrorClassification | null;
}): LlmProviderClient {
  return {
    analyze: input.run,
    classifyError: input.classifyError,
  };
}
