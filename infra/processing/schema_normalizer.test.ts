import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeForStructuredOutputsStrict } from "./schema_normalizer.js";

test("normalizer enforces required-all-keys and additionalProperties=false for object schemas", () => {
  const normalized = normalizeForStructuredOutputsStrict(readReportSchemaV1());
  const objectNodes = collectObjectSchemaNodes(normalized);

  assert.ok(objectNodes.length > 0);

  for (const nodeInfo of objectNodes) {
    const propertyKeys = Object.keys(nodeInfo.node.properties ?? {});
    if (propertyKeys.length === 0) {
      continue;
    }

    assert.equal(
      nodeInfo.node.additionalProperties,
      false,
      `additionalProperties must be false at ${nodeInfo.path}`,
    );

    const required = toStringArray(nodeInfo.node.required);
    assert.deepEqual(
      [...required].sort(),
      [...propertyKeys].sort(),
      `required must include every key in properties at ${nodeInfo.path}`,
    );
  }
});

test("normalizer regression: nextSteps.items.required includes dueDate", () => {
  const normalized = normalizeForStructuredOutputsStrict(readReportSchemaV1());
  const root = asObjectRecord(normalized, "$root");
  const properties = asObjectRecord(root.properties, "$.properties");
  const nextSteps = asObjectRecord(properties.nextSteps, "$.properties.nextSteps");
  const items = asObjectRecord(nextSteps.items, "$.properties.nextSteps.items");
  const required = toStringArray(items.required);

  assert.ok(required.includes("dueDate"));
});

test("normalizer does not mutate scalar types/enums", () => {
  const normalized = normalizeForStructuredOutputsStrict(readReportSchemaV1());
  const root = asObjectRecord(normalized, "$root");
  const properties = asObjectRecord(root.properties, "$.properties");

  const overview = asObjectRecord(properties.overview, "$.properties.overview");
  assert.equal(overview.type, "string");

  const riskLevel = asObjectRecord(properties.riskLevel, "$.properties.riskLevel");
  assert.deepEqual(riskLevel.enum, ["low", "medium", "high"]);
});

test("normalizer applies required-all-keys rule to prompt.txt schema (v2)", () => {
  const normalized = normalizeForStructuredOutputsStrict(readReportSchema("v2"));
  const root = asObjectRecord(normalized, "$root");
  const defs = asObjectRecord(root.$defs, "$.$defs");
  const evidence = asObjectRecord(defs.Evidence, "$.$defs.Evidence");
  const required = toStringArray(evidence.required);

  assert.deepEqual(
    [...required].sort(),
    ["quote", "timecode", "loc", "source_id"].sort(),
  );
});

function collectObjectSchemaNodes(
  schema: unknown,
): Array<{ path: string; node: { properties?: Record<string, unknown>; required?: unknown; additionalProperties?: unknown } }> {
  const nodes: Array<{
    path: string;
    node: { properties?: Record<string, unknown>; required?: unknown; additionalProperties?: unknown };
  }> = [];

  visitSchema(schema, "$", (node, pathValue) => {
    const isObjectSchema = node.type === "object" || "properties" in node;
    if (!isObjectSchema) {
      return;
    }

    if (!isRecord(node.properties)) {
      nodes.push({ path: pathValue, node: {} });
      return;
    }

    nodes.push({
      path: pathValue,
      node: {
        properties: node.properties,
        required: node.required,
        additionalProperties: node.additionalProperties,
      },
    });
  });

  return nodes;
}

function visitSchema(
  node: unknown,
  pathValue: string,
  onNode: (record: Record<string, unknown>, pathValue: string) => void,
): void {
  if (!isRecord(node)) {
    return;
  }

  onNode(node, pathValue);

  if (isRecord(node.properties)) {
    for (const [key, value] of Object.entries(node.properties)) {
      visitSchema(value, `${pathValue}.properties.${key}`, onNode);
    }
  }

  const isArraySchema = node.type === "array" || "items" in node;
  if (isArraySchema && "items" in node) {
    visitSchema(node.items, `${pathValue}.items`, onNode);
  }

  if (Array.isArray(node.prefixItems)) {
    for (let index = 0; index < node.prefixItems.length; index += 1) {
      visitSchema(node.prefixItems[index], `${pathValue}.prefixItems[${index}]`, onNode);
    }
  }

  visitArrayOfSchemas(node.oneOf, `${pathValue}.oneOf`, onNode);
  visitArrayOfSchemas(node.anyOf, `${pathValue}.anyOf`, onNode);
  visitArrayOfSchemas(node.allOf, `${pathValue}.allOf`, onNode);

  visitDictionaryOfSchemas(node.$defs, `${pathValue}.$defs`, onNode);
  visitDictionaryOfSchemas(node.definitions, `${pathValue}.definitions`, onNode);
}

function visitArrayOfSchemas(
  value: unknown,
  pathValue: string,
  onNode: (record: Record<string, unknown>, pathValue: string) => void,
): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    visitSchema(value[index], `${pathValue}[${index}]`, onNode);
  }
}

function visitDictionaryOfSchemas(
  value: unknown,
  pathValue: string,
  onNode: (record: Record<string, unknown>, pathValue: string) => void,
): void {
  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visitSchema(child, `${pathValue}.${key}`, onNode);
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asObjectRecord(value: unknown, pathValue: string): Record<string, unknown> {
  assert.ok(isRecord(value), `Expected object at ${pathValue}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readReportSchemaV1(): unknown {
  return readReportSchema("v1");
}

function readReportSchema(version: string): unknown {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const schemaPath = path.join(root, "schemas", "report", `${version}.json`);
  return JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
}
