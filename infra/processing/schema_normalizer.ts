export function normalizeForStructuredOutputsStrict(schema: unknown): unknown {
  return normalizeSchemaNode(schema);
}

function normalizeSchemaNode(node: unknown): unknown {
  if (!isRecord(node)) {
    return Array.isArray(node) ? node.map((item) => normalizeSchemaNode(item)) : node;
  }

  const normalized: Record<string, unknown> = { ...node };

  if (isRecord(node.properties)) {
    const normalizedProperties: Record<string, unknown> = {};
    for (const [key, propertySchema] of Object.entries(node.properties)) {
      normalizedProperties[key] = normalizeSchemaNode(propertySchema);
    }
    normalized.properties = normalizedProperties;
  }

  const hasArrayItems = node.type === "array" || "items" in node;
  if (hasArrayItems && "items" in node) {
    normalized.items = normalizeSchemaNode(node.items);
  }

  if (Array.isArray(node.prefixItems)) {
    normalized.prefixItems = node.prefixItems.map((item) => normalizeSchemaNode(item));
  }

  normalizeSchemaArrayKeyword(normalized, node, "oneOf");
  normalizeSchemaArrayKeyword(normalized, node, "anyOf");
  normalizeSchemaArrayKeyword(normalized, node, "allOf");

  normalizeSchemaMapKeyword(normalized, node, "$defs");
  normalizeSchemaMapKeyword(normalized, node, "definitions");

  const isObjectSchema = node.type === "object" || "properties" in node;
  if (!isObjectSchema) {
    return normalized;
  }

  if (normalized.additionalProperties === undefined) {
    normalized.additionalProperties = false;
  }

  const properties = normalized.properties;
  if (!isRecord(properties)) {
    return normalized;
  }

  const propertyKeys = Object.keys(properties);
  if (propertyKeys.length === 0) {
    return normalized;
  }

  normalized.required = propertyKeys;
  return normalized;
}

function normalizeSchemaArrayKeyword(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: "oneOf" | "anyOf" | "allOf",
): void {
  const value = source[key];
  if (!Array.isArray(value)) {
    return;
  }
  if (key === "allOf") {
    // OpenAI Structured Outputs strict subset does not accept allOf.
    return;
  }
  const normalizedItems = value
    .map((item) => normalizeSchemaNode(item))
    .filter((item) => !isStrictIncompatibleRequiredOnlyFragment(item));

  if (normalizedItems.length === 0) {
    delete target[key];
    return;
  }

  target[key] = normalizedItems;
}

function normalizeSchemaMapKeyword(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: "$defs" | "definitions",
): void {
  const value = source[key];
  if (!isRecord(value)) {
    return;
  }

  const normalizedMap: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(value)) {
    normalizedMap[name] = normalizeSchemaNode(schema);
  }

  target[key] = normalizedMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrictIncompatibleRequiredOnlyFragment(node: unknown): boolean {
  if (!isRecord(node)) {
    return false;
  }

  if (!Array.isArray(node.required) || node.required.length === 0) {
    return false;
  }

  for (const key of Object.keys(node)) {
    if (key === "required") {
      continue;
    }
    if (ANNOTATION_KEYWORDS.has(key)) {
      continue;
    }
    return false;
  }

  return true;
}

const ANNOTATION_KEYWORDS = new Set([
  "title",
  "description",
  "examples",
  "default",
  "$comment",
  "deprecated",
  "readOnly",
  "writeOnly",
]);
