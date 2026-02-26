import "dotenv/config";

export type HttpServerConfig = {
  port: number;
  siteOrigin: string;
  secureCookies: boolean;
};

export function loadHttpServerConfig(): HttpServerConfig {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  const siteOrigin = normalizeOrigin(process.env.APP_ORIGIN ?? `http://localhost:${port}`);
  const secureCookies = process.env.NODE_ENV === "production";

  return {
    port,
    siteOrigin,
    secureCookies,
  };
}

export function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  return url.origin;
}
