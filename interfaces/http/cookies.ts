import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../app/auth/service.js";

export function parseCookies(cookieHeader: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) {
    return map;
  }

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    map.set(name, decodeCookieValue(value));
  }

  return map;
}

export function getSessionCookieValue(cookieHeader: string | null | undefined): string | null {
  return parseCookies(cookieHeader).get(SESSION_COOKIE_NAME) ?? null;
}

export function buildSessionCookie(opaqueToken: string, secure: boolean): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(opaqueToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
