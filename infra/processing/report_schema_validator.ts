import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv, type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";

import { resolveReportContractVersions } from "../../app/processing/report_contract.js";

const MAX_ERROR_ITEMS = 3;
const MAX_ERROR_SUMMARY_LENGTH = 280;

const REPORT_SCHEMA_DIR = path.join(resolveRepositoryRootDir(), "schemas", "report");

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  allowUnionTypes: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});

const validatorCache = new Map<string, ValidateFunction<unknown>>();

export type SanitizedSchemaValidationError = {
  instancePath: string;
  keyword: string;
  message: string;
};

export type ReportSchemaValidationSuccess = {
  ok: true;
  schemaVersion: string;
};

export type ReportSchemaValidationFailure = {
  ok: false;
  errorCode: "schema_validation_failed";
  schemaVersion: string;
  summary: string;
  errors: SanitizedSchemaValidationError[];
};

export function validateReportPayload(
  payload: unknown,
  options?: { schemaVersion?: string },
): ReportSchemaValidationSuccess | ReportSchemaValidationFailure {
  const schemaVersion = resolveReportContractVersions({
    schemaVersion: options?.schemaVersion,
  }).schemaVersion;

  const validate = getOrCreateValidator(schemaVersion);
  const valid = validate(payload);
  if (valid) {
    return {
      ok: true,
      schemaVersion,
    };
  }

  const errors = sanitizeValidationErrors(validate.errors);
  return {
    ok: false,
    errorCode: "schema_validation_failed",
    schemaVersion,
    summary: formatValidationSummary(errors),
    errors,
  };
}

function getOrCreateValidator(schemaVersion: string): ValidateFunction<unknown> {
  const cached = validatorCache.get(schemaVersion);
  if (cached) {
    return cached;
  }

  const schema = loadSchemaJson(schemaVersion);
  const compiled = ajv.compile(schema);
  validatorCache.set(schemaVersion, compiled);
  return compiled;
}

function loadSchemaJson(schemaVersion: string): AnySchema {
  const schemaPath = path.join(REPORT_SCHEMA_DIR, `${schemaVersion}.json`);
  const raw = readFileSync(schemaPath, "utf8");
  return JSON.parse(raw) as AnySchema;
}

function sanitizeValidationErrors(errors: ErrorObject[] | null | undefined): SanitizedSchemaValidationError[] {
  if (!errors || errors.length === 0) {
    return [
      {
        instancePath: "$",
        keyword: "unknown",
        message: "schema validation failed",
      },
    ];
  }

  return errors.slice(0, MAX_ERROR_ITEMS).map((error) => ({
    instancePath: formatInstancePath(error),
    keyword: sanitizeText(error.keyword, 64, "unknown"),
    message: sanitizeText(error.message, 140, "schema violation"),
  }));
}

function formatValidationSummary(errors: SanitizedSchemaValidationError[]): string {
  const parts = errors.map((error) => `${error.instancePath}: ${error.message}`);
  return sanitizeText(parts.join("; "), MAX_ERROR_SUMMARY_LENGTH, "schema validation failed");
}

function formatInstancePath(error: ErrorObject): string {
  const pathValue = error.instancePath?.trim();
  if (pathValue) {
    return pathValue;
  }

  const missingProperty = extractMissingProperty(error);
  if (missingProperty) {
    return `$.${missingProperty}`;
  }

  return "$";
}

function extractMissingProperty(error: ErrorObject): string | null {
  if (error.keyword !== "required") {
    return null;
  }
  const params = error.params as { missingProperty?: unknown };
  if (typeof params.missingProperty !== "string") {
    return null;
  }
  return sanitizeText(params.missingProperty, 64, "");
}

function sanitizeText(value: unknown, maxLength: number, fallback: string): string {
  const raw = String(value ?? "");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return fallback;
  }
  return collapsed.slice(0, maxLength);
}

function resolveRepositoryRootDir(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}
