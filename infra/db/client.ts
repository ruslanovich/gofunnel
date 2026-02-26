import "dotenv/config";

import { Client, Pool } from "pg";

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrl;
}

export function createPgClient(): Client {
  return new Client({
    connectionString: getDatabaseUrl(),
    application_name: "gofunnel-cli",
  });
}

export function createPgPool(applicationName = "gofunnel-http"): Pool {
  return new Pool({
    connectionString: getDatabaseUrl(),
    application_name: applicationName,
  });
}
