import "dotenv/config";

import { createHmac } from "node:crypto";

export const TOKEN_HASH_VERSION = "hmac-sha256-v1";

export function getTokenPepper(): string {
  const pepper = process.env.TOKEN_HASH_PEPPER?.trim();
  if (!pepper) {
    throw new Error("TOKEN_HASH_PEPPER is required for token hashing");
  }
  return pepper;
}

export function hashOpaqueToken(token: string, pepper = getTokenPepper()): string {
  if (!token) {
    throw new Error("Token must be non-empty");
  }
  return createHmac("sha256", pepper).update(token, "utf8").digest("hex");
}
