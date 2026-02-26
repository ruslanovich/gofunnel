export function sanitizeNextPath(rawNext: string | null | undefined): string | null {
  if (!rawNext) {
    return null;
  }

  const next = rawNext.trim();
  if (!next.startsWith("/")) {
    return null;
  }

  if (next.startsWith("//")) {
    return null;
  }

  return next;
}

export function buildLoginRedirectLocation(nextPath: string): string {
  return `/login?next=${encodeURIComponent(nextPath)}`;
}
