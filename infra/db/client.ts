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
  const pool = new Pool({
    connectionString: getDatabaseUrl(),
    application_name: applicationName,
  });

  // Prevent process crashes on idle client disconnects (e.g. transient network resets).
  pool.on("error", (error) => {
    console.error(
      JSON.stringify(
        {
          event: "pg_pool_idle_client_error",
          applicationName,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  });

  return pool;
}
