import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("v2 prompt and schema are sourced exactly from prompts/prompt.txt", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sourcePath = path.join(root, "prompts", "prompt.txt");
  const promptV2Path = path.join(root, "prompts", "report", "v2.txt");
  const schemaV2Path = path.join(root, "schemas", "report", "v2.json");

  const source = readFileSync(sourcePath, "utf8");
  const parsed = source.match(/transcript_analysis = "([\s\S]*?)"\n\ntranscript_analysis_so = "([\s\S]*?)"\s*$/);
  assert.ok(parsed, "prompts/prompt.txt must contain transcript_analysis and transcript_analysis_so blocks");

  const sourcePrompt = `${parsed[1]}\n`;
  const sourceSchemaJson = JSON.parse(parsed[2]) as unknown;

  const promptV2 = readFileSync(promptV2Path, "utf8");
  const schemaV2Json = JSON.parse(readFileSync(schemaV2Path, "utf8")) as unknown;

  assert.equal(promptV2, sourcePrompt);
  assert.deepEqual(schemaV2Json, sourceSchemaJson);
});
