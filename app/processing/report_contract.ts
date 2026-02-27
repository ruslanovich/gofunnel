export const ACTIVE_REPORT_PROMPT_VERSION = "v2";
export const ACTIVE_REPORT_SCHEMA_VERSION = "v2";

export type ReportContractVersions = {
  promptVersion: string;
  schemaVersion: string;
};

export function resolveReportContractVersions(input?: {
  promptVersion?: string;
  schemaVersion?: string;
}): ReportContractVersions {
  return {
    promptVersion: normalizeVersion(input?.promptVersion) ?? ACTIVE_REPORT_PROMPT_VERSION,
    schemaVersion: normalizeVersion(input?.schemaVersion) ?? ACTIVE_REPORT_SCHEMA_VERSION,
  };
}

function normalizeVersion(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
}
