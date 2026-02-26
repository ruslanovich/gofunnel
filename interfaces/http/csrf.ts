import { normalizeOrigin } from "./config.js";

export function isAllowedOriginForStateChange(args: {
  originHeader: string | null | undefined;
  refererHeader: string | null | undefined;
  siteOrigin: string;
}): boolean {
  const siteOrigin = normalizeOrigin(args.siteOrigin);

  const originHeader = args.originHeader?.trim();
  if (originHeader) {
    return safelyNormalizeOrigin(originHeader) === siteOrigin;
  }

  const refererHeader = args.refererHeader?.trim();
  if (refererHeader) {
    return refererHeader.startsWith(`${siteOrigin}/`) || refererHeader === siteOrigin;
  }

  return false;
}

function safelyNormalizeOrigin(raw: string): string | null {
  try {
    return normalizeOrigin(raw);
  } catch {
    return null;
  }
}
