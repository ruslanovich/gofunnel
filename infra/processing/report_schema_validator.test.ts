import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { validateReportPayload } from "./report_schema_validator.js";

test("valid report fixture passes strict schema validation", () => {
  const payload = readFixtureJson("v1_valid.json");
  const result = validateReportPayload(payload, { schemaVersion: "v1" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.schemaVersion, "v1");
  }
});

test("invalid report fixture fails with schema_validation_failed and concise summary", () => {
  const payload = readFixtureJson("v1_invalid_missing_required_and_extra.json");
  const result = validateReportPayload(payload, { schemaVersion: "v1" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "schema_validation_failed");
    assert.ok(result.errors.length > 0);
    assert.ok(result.summary.length > 0);
    assert.ok(result.summary.length <= 280);
    assert.match(result.summary, /(riskLevel|additional)/i);
  }
});

test("v2 prompt contract schema loads and validates payload shape", () => {
  const result = validateReportPayload({}, { schemaVersion: "v2" });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "schema_validation_failed");
    assert.equal(result.schemaVersion, "v2");
  }
});

test("v2 schema defines missing_questions items without allOf", () => {
  const schema = readSchemaJson("v2");
  const defs = asObjectRecord(schema.$defs, "$.$defs");
  const itemsAndMissingQuestions = asObjectRecord(
    defs.ItemsAndMissingQuestions,
    "$.$defs.ItemsAndMissingQuestions",
  );
  const properties = asObjectRecord(
    itemsAndMissingQuestions.properties,
    "$.$defs.ItemsAndMissingQuestions.properties",
  );
  const missingQuestions = asObjectRecord(
    properties.missing_questions,
    "$.$defs.ItemsAndMissingQuestions.properties.missing_questions",
  );
  const items = asObjectRecord(
    missingQuestions.items,
    "$.$defs.ItemsAndMissingQuestions.properties.missing_questions.items",
  );

  assert.equal(items.allOf, undefined);
  assert.equal(items.$ref, "#/$defs/MissingQuestionField");
});

function readFixtureJson(filename: string): unknown {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.join(dir, "fixtures", "report", filename);
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function readSchemaJson(version: string): Record<string, unknown> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(dir, "..", "..", "schemas", "report", `${version}.json`);
  const raw = readFileSync(schemaPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function asObjectRecord(value: unknown, location: string): Record<string, unknown> {
  assert.equal(typeof value, "object", `Expected object at ${location}`);
  assert.notEqual(value, null, `Expected non-null object at ${location}`);
  assert.equal(Array.isArray(value), false, `Expected plain object at ${location}`);
  return value as Record<string, unknown>;
}
