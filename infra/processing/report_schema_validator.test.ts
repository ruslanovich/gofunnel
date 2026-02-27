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

function readFixtureJson(filename: string): unknown {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.join(dir, "fixtures", "report", filename);
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as unknown;
}
