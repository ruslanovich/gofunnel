import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { AdminUserListItem } from "../../app/admin_users/contracts.js";
import { AdminUserAdminError, AdminUserService } from "../../app/admin_users/service.js";
import type { AdminAccessRequest } from "../../app/access_requests/contracts.js";
import {
  AccessRequestAdminError,
  AccessRequestService,
  AccessRequestValidationError,
} from "../../app/access_requests/service.js";
import { AuthError, AuthService } from "../../app/auth/service.js";
import { buildLoginRedirectLocation, sanitizeNextPath } from "../../app/auth/redirects.js";
import {
  InviteAcceptError,
  InviteAdminError,
  INVITE_ACCEPT_MIN_PASSWORD_LENGTH,
  InviteService,
  InviteValidationError,
} from "../../app/invites/service.js";
import { ReportShareService, ShareAccessError } from "../../app/shares/service.js";
import type { AuthenticatedSession } from "../../domain/auth/types.js";
import { PostgresAccessRequestRepository } from "../../infra/access_requests/postgres_access_request_repository.js";
import { PostgresAdminUserRepository } from "../../infra/admin_users/postgres_admin_user_repository.js";
import { PostgresAuthRepository } from "../../infra/auth/postgres_auth_repository.js";
import { createPgPool } from "../../infra/db/client.js";
import { PostgresInviteRepository } from "../../infra/invites/postgres_invite_repository.js";
import { hashOpaqueToken } from "../../infra/security/token_hash.js";
import { PostgresReportShareRepository } from "../../infra/shares/postgres_report_share_repository.js";
import { buildClearSessionCookie, buildSessionCookie, getSessionCookieValue } from "./cookies.js";
import { isAllowedOriginForStateChange } from "./csrf.js";
import type { HttpServerConfig } from "./config.js";
import { loadHttpServerConfig } from "./config.js";

export type AuthHttpServerDeps = {
  authService: AuthService;
  accessRequestService: AccessRequestService;
  adminUserService: AdminUserService;
  inviteService: InviteService;
  reportShareService: ReportShareService;
  siteOrigin: string;
  secureCookies: boolean;
};

export function createAuthHttpServer(deps: AuthHttpServerDeps): Server {
  return createServer(async (req, res) => {
    try {
      await handleRequest(req, res, deps);
    } catch (error) {
      console.error("Unhandled HTTP error", error);
      if (!res.headersSent) {
        sendText(res, 500, "Internal Server Error");
      } else {
        res.end();
      }
    }
  });
}

export function createDefaultAuthHttpServer(config: HttpServerConfig = loadHttpServerConfig()): Server {
  const pool = createPgPool("gofunnel-http");
  const authRepository = new PostgresAuthRepository(pool);
  const accessRequestRepository = new PostgresAccessRequestRepository(pool);
  const adminUserRepository = new PostgresAdminUserRepository(pool);
  const inviteRepository = new PostgresInviteRepository(pool);
  const reportShareRepository = new PostgresReportShareRepository(pool);
  const authService = new AuthService({ repository: authRepository });
  const accessRequestService = new AccessRequestService({
    repository: accessRequestRepository,
    hashRateLimitKey: hashOpaqueToken,
  });
  const adminUserService = new AdminUserService({
    repository: adminUserRepository,
  });
  const inviteService = new InviteService({
    repository: inviteRepository,
  });
  const reportShareService = new ReportShareService({
    repository: reportShareRepository,
  });
  const server = createAuthHttpServer({
    authService,
    accessRequestService,
    adminUserService,
    inviteService,
    reportShareService,
    siteOrigin: config.siteOrigin,
    secureCookies: config.secureCookies,
  });

  server.on("close", () => {
    void pool.end();
  });

  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AuthHttpServerDeps,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://local.invalid");
  const pathname = url.pathname;

  if (isStateChangingApiRequest(method, pathname)) {
    const allowed = isAllowedOriginForStateChange({
      originHeader: req.headers.origin,
      refererHeader: req.headers.referer,
      siteOrigin: deps.siteOrigin,
    });
    if (!allowed) {
      sendText(res, 403, "CSRF check failed");
      return;
    }
  }

  if (method === "GET" && pathname === "/") {
    sendHtml(
      res,
      200,
      `<h1>gofunnel</h1><p><a href=\"/login\">Login</a></p><p><a href=\"/request-access\">Request access</a></p><p><a href=\"/app\">App</a></p><p><a href=\"/admin\">Admin</a></p>`,
    );
    return;
  }

  if (method === "GET" && pathname === "/request-access") {
    sendHtml(res, 200, renderRequestAccessPage());
    return;
  }

  if (method === "GET" && pathname.startsWith("/invite/")) {
    const token = parseInviteTokenFromPath(pathname);
    if (!token) {
      sendText(res, 404, "Not Found");
      return;
    }

    sendHtml(res, 200, renderInviteAcceptPage(token));
    return;
  }

  if (method === "GET" && pathname === "/login") {
    const existingSession = await tryGetSession(req, deps.authService);
    const requestedNext = sanitizeNextPath(url.searchParams.get("next"));
    if (existingSession) {
      redirect(res, 303, requestedNext ?? "/app");
      return;
    }

    sendHtml(res, 200, renderLoginPage(requestedNext));
    return;
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const form = await readUrlEncodedForm(req);
    const email = form.get("email")?.trim() ?? "";
    const password = form.get("password") ?? "";
    const nextPath = sanitizeNextPath(form.get("next"));

    if (!email || !password) {
      sendText(res, 400, "email and password are required");
      return;
    }

    try {
      const login = await deps.authService.login({
        email,
        password,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });

      res.setHeader("Set-Cookie", buildSessionCookie(login.opaqueSessionToken, deps.secureCookies));
      redirect(res, 303, nextPath ?? "/app");
      return;
    } catch (error) {
      if (error instanceof AuthError) {
        sendText(res, error.httpStatus, error.code);
        return;
      }
      throw error;
    }
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const opaqueSessionToken = getSessionCookieValue(req.headers.cookie);
    await deps.authService.logoutByOpaqueToken(opaqueSessionToken);
    res.setHeader("Set-Cookie", buildClearSessionCookie(deps.secureCookies));
    redirect(res, 303, "/login");
    return;
  }

  if (method === "POST" && pathname === "/api/auth/accept-invite") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid_json" });
      return;
    }

    const token = getStringProperty(body, "token");
    const password = getStringProperty(body, "password");
    try {
      const accepted = await deps.inviteService.acceptInvite({
        token,
        password,
      });
      const login = await deps.authService.login({
        email: accepted.user.email,
        password: password ?? "",
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] ?? null,
      });

      res.setHeader("Set-Cookie", buildSessionCookie(login.opaqueSessionToken, deps.secureCookies));
      sendJson(res, 200, {
        ok: true,
        redirect_to: "/app",
      });
      return;
    } catch (error) {
      if (error instanceof InviteValidationError || error instanceof InviteAcceptError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }

      if (error instanceof AuthError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }

      throw error;
    }
  }

  if (method === "POST" && pathname === "/api/access-requests") {
    const form = await readUrlEncodedForm(req);

    try {
      const outcome = await deps.accessRequestService.submitRequest({
        email: form.get("email"),
        name: form.get("name"),
        company: form.get("company"),
        note: form.get("note"),
        website: form.get("website"),
        clientTs: form.get("client_ts"),
        ipAddress: getClientIp(req),
      });

      if (outcome.kind === "rate_limited") {
        logAccessRequestEvent("access_request_rejected", { reason: outcome.reason });
        sendJson(res, 429, {
          ok: false,
          message: ACCESS_REQUEST_RATE_LIMIT_MESSAGE,
        });
        return;
      }

      if (outcome.kind === "silent_drop") {
        logAccessRequestEvent("access_request_dropped", { reason: outcome.reason });
      } else if (outcome.mode === "duplicate_24h") {
        logAccessRequestEvent("access_request_suppressed", { reason: "duplicate_24h" });
      } else {
        logAccessRequestEvent("access_request_accepted", { reason: "created" });
      }

      sendJson(res, 200, {
        ok: true,
        message: ACCESS_REQUEST_SUCCESS_MESSAGE,
      });
      return;
    } catch (error) {
      if (error instanceof AccessRequestValidationError) {
        sendJson(res, error.httpStatus, {
          ok: false,
          error: error.code,
        });
        return;
      }

      throw error;
    }
  }

  if (pathname.startsWith("/api/admin/")) {
    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      sendText(res, 401, "auth_required");
      return;
    }

    if (session.user.role !== "admin") {
      sendText(res, 403, "admin_only");
      return;
    }

    if (method === "GET" && pathname === "/api/admin/access-requests") {
      try {
        const items = await deps.accessRequestService.listForAdmin({
          status: url.searchParams.get("status"),
        });

        sendJson(res, 200, {
          items: items.map(serializeAdminAccessRequest),
        });
        return;
      } catch (error) {
        if (error instanceof AccessRequestAdminError) {
          sendJson(res, error.httpStatus, { error: error.code });
          return;
        }

        throw error;
      }
    }

    if (method === "POST" && pathname === "/api/admin/invites") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }

      const email = getStringProperty(body, "email");
      const accessRequestId = getStringProperty(body, "access_request_id");

      try {
        const created = await deps.inviteService.createInviteForAdmin({
          email,
          accessRequestId,
          createdByUserId: session.user.id,
        });

        sendJson(res, 200, {
          invite_link: `${deps.siteOrigin}/invite/${encodeURIComponent(created.plaintextToken)}`,
        });
        return;
      } catch (error) {
        if (error instanceof InviteValidationError) {
          sendJson(res, error.httpStatus, { error: error.code });
          return;
        }

        if (error instanceof InviteAdminError) {
          sendJson(res, error.httpStatus, { error: error.code });
          return;
        }

        throw error;
      }
    }

    if (method === "GET" && pathname === "/api/admin/users") {
      const items = await deps.adminUserService.listForAdmin();
      sendJson(res, 200, {
        items: items.map(serializeAdminUser),
      });
      return;
    }

    if (method === "PATCH" && pathname.startsWith("/api/admin/users/")) {
      const userId = pathname.slice("/api/admin/users/".length);
      if (!userId) {
        sendText(res, 404, "Not Found");
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }

      const status = getStringProperty(body, "status");
      try {
        const item = await deps.adminUserService.updateStatusForAdmin({
          id: userId,
          status,
        });

        sendJson(res, 200, {
          ok: true,
          item: serializeAdminUser(item),
        });
        return;
      } catch (error) {
        if (error instanceof AdminUserAdminError) {
          sendJson(res, error.httpStatus, { error: error.code });
          return;
        }

        throw error;
      }
    }

    if (method === "PATCH" && pathname.startsWith("/api/admin/access-requests/")) {
      const requestId = pathname.slice("/api/admin/access-requests/".length);
      if (!requestId) {
        sendText(res, 404, "Not Found");
        return;
      }

      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }

      const status = getStringProperty(body, "status");
      try {
        const item = await deps.accessRequestService.updateStatusForAdmin({
          id: requestId,
          status,
          handledByUserId: session.user.id,
        });

        sendJson(res, 200, {
          ok: true,
          item: serializeAdminAccessRequest(item),
        });
        return;
      } catch (error) {
        if (error instanceof AccessRequestAdminError) {
          sendJson(res, error.httpStatus, { error: error.code });
          return;
        }

        throw error;
      }
    }

    sendText(res, 404, "Not Found");
    return;
  }

  if (method === "GET" && pathname.startsWith("/share/")) {
    const token = parseShareTokenFromPath(pathname);
    if (!token) {
      sendText(res, 404, "Not Found");
      return;
    }

    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      redirect(res, 303, buildLoginRedirectLocation(buildPathAndQuery(url)));
      return;
    }

    try {
      const share = await deps.reportShareService.resolveShareByToken({ token });
      sendHtml(res, 200, renderSharePlaceholderPage(share.reportRef));
      return;
    } catch (error) {
      if (error instanceof ShareAccessError) {
        if (error.httpStatus === 410) {
          sendText(res, 410, "Gone");
          return;
        }

        sendText(res, 404, "Not Found");
        return;
      }

      throw error;
    }
  }

  if (pathname === "/app" || pathname.startsWith("/app/")) {
    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      redirect(res, 303, buildLoginRedirectLocation(buildPathAndQuery(url)));
      return;
    }

    sendHtml(res, 200, renderProtectedPage("app", pathname, session));
    return;
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      redirect(res, 303, buildLoginRedirectLocation(buildPathAndQuery(url)));
      return;
    }

    if (session.user.role !== "admin") {
      sendText(res, 403, "admin_only");
      return;
    }

    if (method === "GET" && pathname === "/admin/access-requests") {
      try {
        const items = await deps.accessRequestService.listForAdmin({
          status: url.searchParams.get("status"),
        });
        sendHtml(
          res,
          200,
          renderAdminAccessRequestsPage({
            currentFilter: url.searchParams.get("status"),
            items,
          }),
        );
        return;
      } catch (error) {
        if (error instanceof AccessRequestAdminError) {
          sendText(res, error.httpStatus, error.code);
          return;
        }

        throw error;
      }
    }

    if (method === "GET" && pathname === "/admin/users") {
      const items = await deps.adminUserService.listForAdmin();
      sendHtml(res, 200, renderAdminUsersPage({ items }));
      return;
    }

    sendHtml(res, 200, renderProtectedPage("admin", pathname, session));
    return;
  }

  sendText(res, 404, "Not Found");
}

async function tryGetSession(
  req: IncomingMessage,
  authService: AuthService,
): Promise<AuthenticatedSession | null> {
  const opaqueSessionToken = getSessionCookieValue(req.headers.cookie);
  return authService.validateOpaqueSession(opaqueSessionToken);
}

function isStateChangingApiRequest(method: string, pathname: string): boolean {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function getClientIp(req: IncomingMessage): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    return first || null;
  }
  if (Array.isArray(forwarded)) {
    const firstHeader = forwarded[0] ?? "";
    const first = firstHeader.split(",")[0]?.trim();
    return first || null;
  }

  return req.socket.remoteAddress ?? null;
}

async function readUrlEncodedForm(req: IncomingMessage): Promise<URLSearchParams> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  const body = await readRequestBody(req);
  return new URLSearchParams(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  const body = await readRequestBody(req);
  return JSON.parse(body);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bufferChunk.length;
    if (size > 16 * 1024) {
      throw new Error("Request body too large");
    }
    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function redirect(res: ServerResponse, statusCode: 302 | 303, location: string): void {
  res.statusCode = statusCode;
  res.setHeader("Location", location);
  res.end();
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><body>${html}</body></html>`);
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getStringProperty(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

const ACCESS_REQUEST_SUCCESS_MESSAGE =
  "Request received. If access is approved, we will contact you by email.";
const ACCESS_REQUEST_RATE_LIMIT_MESSAGE = "Unable to submit right now. Please try again later.";

function renderLoginPage(nextPath: string | null): string {
  const hiddenNext = nextPath
    ? `<input type=\"hidden\" name=\"next\" value=\"${escapeHtml(nextPath)}\" />`
    : "";

  return `
    <h1>Login</h1>
    <form method="post" action="/api/auth/login">
      ${hiddenNext}
      <label>Email <input type="email" name="email" required /></label><br />
      <label>Password <input type="password" name="password" required /></label><br />
      <button type="submit">Log in</button>
    </form>
  `;
}

function renderInviteAcceptPage(token: string): string {
  return `
    <h1>Set password</h1>
    <p id="invite-accept-status" aria-live="polite"></p>
    <form id="invite-accept-form">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <label>
        Password
        <input
          type="password"
          name="password"
          minlength="${INVITE_ACCEPT_MIN_PASSWORD_LENGTH}"
          required
          autocomplete="new-password"
        />
      </label><br />
      <button type="submit">Accept invite</button>
    </form>
    <script>
      (() => {
        const form = document.getElementById("invite-accept-form");
        const status = document.getElementById("invite-accept-status");
        if (!(form instanceof HTMLFormElement) || !(status instanceof HTMLElement)) {
          return;
        }

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const tokenInput = form.elements.namedItem("token");
          const passwordInput = form.elements.namedItem("password");
          const submitButton = form.querySelector('button[type="submit"]');
          if (!(tokenInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
            return;
          }

          if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
          }
          status.textContent = "Submitting...";

          try {
            const response = await fetch("/api/auth/accept-invite", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                token: tokenInput.value,
                password: passwordInput.value,
              }),
            });

            let payload = null;
            try {
              payload = await response.json();
            } catch {}

            if (response.ok) {
              if (
                payload &&
                typeof payload === "object" &&
                typeof payload.redirect_to === "string" &&
                payload.redirect_to.startsWith("/")
              ) {
                window.location.assign(payload.redirect_to);
                return;
              }

              window.location.assign("/app");
              return;
            }

            const errorCode =
              payload && typeof payload === "object" && typeof payload.error === "string"
                ? payload.error
                : "request_failed";
            if (errorCode === "invalid_or_expired_token") {
              status.textContent = "Invite link is invalid or expired.";
              return;
            }
            if (errorCode === "password_too_short") {
              status.textContent =
                "Password must be at least ${INVITE_ACCEPT_MIN_PASSWORD_LENGTH} characters.";
              return;
            }
            if (errorCode === "user_exists") {
              status.textContent = "Account already exists. Please log in.";
              return;
            }

            status.textContent = "Unable to accept invite right now.";
          } catch {
            status.textContent = "Unable to accept invite right now.";
          } finally {
            if (submitButton instanceof HTMLButtonElement) {
              submitButton.disabled = false;
            }
          }
        });
      })();
    </script>
  `;
}

function renderRequestAccessPage(): string {
  const clientTs = Date.now();
  return `
    <h1>Request access</h1>
    <p id="request-access-status" aria-live="polite"></p>
    <form id="request-access-form" method="post" action="/api/access-requests">
      <div style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden;" aria-hidden="true">
        <label>Website <input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
      </div>
      <input type="hidden" name="client_ts" value="${clientTs}" />
      <label>Email <input type="email" name="email" required /></label><br />
      <label>Name <input type="text" name="name" /></label><br />
      <label>Company <input type="text" name="company" /></label><br />
      <label>Note <textarea name="note" rows="4" cols="40"></textarea></label><br />
      <button type="submit">Send request</button>
    </form>
    <script>
      (() => {
        const form = document.getElementById("request-access-form");
        const status = document.getElementById("request-access-status");
        if (!(form instanceof HTMLFormElement) || !(status instanceof HTMLElement)) {
          return;
        }

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          status.textContent = "Submitting...";

          const submitButton = form.querySelector("button[type=\\"submit\\"]");
          if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = true;
          }

          try {
            const response = await fetch("/api/access-requests", {
              method: "POST",
              body: new URLSearchParams(new FormData(form)),
            });

            if (response.ok) {
              let message = ${JSON.stringify(ACCESS_REQUEST_SUCCESS_MESSAGE)};
              try {
                const payload = await response.json();
                if (payload && typeof payload.message === "string") {
                  message = payload.message;
                }
              } catch {}

              form.hidden = true;
              status.textContent = message;
              return;
            }

            if (response.status === 400) {
              status.textContent = "Please enter a valid email address.";
              return;
            }

            status.textContent = "Unable to submit right now. Please try again later.";
          } catch {
            status.textContent = "Unable to submit right now. Please try again later.";
          } finally {
            if (submitButton instanceof HTMLButtonElement && !form.hidden) {
              submitButton.disabled = false;
            }
          }
        });
      })();
    </script>
  `;
}

function renderAdminAccessRequestsPage(input: {
  currentFilter: string | null;
  items: AdminAccessRequest[];
}): string {
  const currentFilter = normalizeAdminStatusFilterForUi(input.currentFilter);
  const rows = input.items
    .map((item) => {
      const options = ["new", "contacted", "approved", "rejected"]
        .map(
          (status) =>
            `<option value="${status}"${item.status === status ? " selected" : ""}>${status}</option>`,
        )
        .join("");

      return `
        <tr data-access-request-id="${escapeHtml(item.id)}">
          <td>${escapeHtml(item.createdAt.toISOString())}</td>
          <td>${escapeHtml(item.email)}</td>
          <td>${escapeHtml(item.fullName ?? "")}</td>
          <td>${escapeHtml(item.company ?? "")}</td>
          <td>${escapeHtml(item.message ?? "")}</td>
          <td class="access-request-status-cell">${escapeHtml(item.status)}</td>
          <td class="access-request-handled-at-cell">${escapeHtml(item.handledAt?.toISOString() ?? "")}</td>
          <td>
            <form class="access-request-status-form" data-request-id="${escapeHtml(item.id)}">
              <label>
                <span class="sr-only">Status</span>
                <select name="status">${options}</select>
              </label>
              <button type="submit">Update</button>
            </form>
            <form
              class="access-request-invite-form"
              data-request-id="${escapeHtml(item.id)}"
              data-email="${escapeHtml(item.email)}"
            >
              <button type="submit">Create invite</button>
            </form>
            <div class="access-request-invite-output" hidden>
              <a class="access-request-invite-link" href=""></a>
              <button type="button" class="access-request-copy-button">Copy</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <h1>Admin access requests</h1>
    <p><a href="/admin">Back to admin</a></p>
    <nav aria-label="Status filters">
      ${renderAdminFilterLink("All", null, currentFilter)}
      ${renderAdminFilterLink("new", "new", currentFilter)}
      ${renderAdminFilterLink("contacted", "contacted", currentFilter)}
      ${renderAdminFilterLink("approved", "approved", currentFilter)}
      ${renderAdminFilterLink("rejected", "rejected", currentFilter)}
    </nav>
    <p id="admin-access-requests-status" aria-live="polite"></p>
    <table border="1" cellpadding="4" cellspacing="0">
      <thead>
        <tr>
          <th>created_at</th>
          <th>email</th>
          <th>name</th>
          <th>company</th>
          <th>note</th>
          <th>status</th>
          <th>handled_at</th>
          <th>action</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="8">No access requests</td></tr>'}
      </tbody>
    </table>
    <script>
      (() => {
        const statusNode = document.getElementById("admin-access-requests-status");
        if (!(statusNode instanceof HTMLElement)) {
          return;
        }

        function setInviteOutput(row, inviteLink) {
          if (!(row instanceof HTMLTableRowElement)) {
            return;
          }

          const output = row.querySelector(".access-request-invite-output");
          const inviteLinkNode = row.querySelector(".access-request-invite-link");
          const copyButton = row.querySelector(".access-request-copy-button");
          const statusCell = row.querySelector(".access-request-status-cell");
          const handledAtCell = row.querySelector(".access-request-handled-at-cell");
          const statusSelect = row.querySelector('.access-request-status-form select[name="status"]');
          if (
            !(output instanceof HTMLElement) ||
            !(inviteLinkNode instanceof HTMLAnchorElement) ||
            !(copyButton instanceof HTMLButtonElement)
          ) {
            return;
          }

          output.hidden = false;
          inviteLinkNode.href = inviteLink;
          inviteLinkNode.textContent = inviteLink;
          inviteLinkNode.rel = "noopener noreferrer";
          inviteLinkNode.target = "_blank";
          copyButton.onclick = async () => {
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(inviteLink);
                statusNode.textContent = "Invite link copied.";
                return;
              }
            } catch {}

            const helper = document.createElement("textarea");
            helper.value = inviteLink;
            helper.style.position = "fixed";
            helper.style.left = "-9999px";
            document.body.appendChild(helper);
            helper.focus();
            helper.select();
            try {
              document.execCommand("copy");
              statusNode.textContent = "Invite link copied.";
            } catch {
              statusNode.textContent = "Copy failed. Please copy manually.";
            } finally {
              helper.remove();
            }
          };

          if (statusCell instanceof HTMLElement) {
            statusCell.textContent = "approved";
          }
          if (statusSelect instanceof HTMLSelectElement) {
            statusSelect.value = "approved";
          }
          if (handledAtCell instanceof HTMLElement && !handledAtCell.textContent) {
            handledAtCell.textContent = new Date().toISOString();
          }
        }

        document.querySelectorAll(".access-request-status-form").forEach((form) => {
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const requestId = form.dataset.requestId;
            const statusInput = form.querySelector('select[name="status"]');
            const button = form.querySelector('button[type="submit"]');
            if (!requestId || !(statusInput instanceof HTMLSelectElement)) {
              return;
            }

            if (button instanceof HTMLButtonElement) {
              button.disabled = true;
            }

            statusNode.textContent = "Updating...";
            try {
              const response = await fetch("/api/admin/access-requests/" + encodeURIComponent(requestId), {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: statusInput.value }),
              });

              if (response.ok) {
                statusNode.textContent = "Updated.";
                window.location.reload();
                return;
              }

              let errorCode = "request_failed";
              try {
                const payload = await response.json();
                if (payload && typeof payload.error === "string") {
                  errorCode = payload.error;
                }
              } catch {}
              statusNode.textContent = "Update failed: " + errorCode;
            } catch {
              statusNode.textContent = "Update failed";
            } finally {
              if (button instanceof HTMLButtonElement) {
                button.disabled = false;
              }
            }
          });
        });

        document.querySelectorAll(".access-request-invite-form").forEach((form) => {
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const requestId = form.dataset.requestId;
            const email = form.dataset.email;
            const row = form.closest("tr");
            const button = form.querySelector('button[type="submit"]');
            if (!requestId || !email) {
              return;
            }

            if (button instanceof HTMLButtonElement) {
              button.disabled = true;
            }

            statusNode.textContent = "Creating invite...";
            try {
              const response = await fetch("/api/admin/invites", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  email,
                  access_request_id: requestId,
                }),
              });

              if (response.ok) {
                const payload = await response.json();
                if (payload && typeof payload.invite_link === "string" && payload.invite_link !== "") {
                  setInviteOutput(row, payload.invite_link);
                  statusNode.textContent = "Invite created.";
                  return;
                }
                statusNode.textContent = "Invite created, but link is missing.";
                return;
              }

              let errorCode = "request_failed";
              try {
                const payload = await response.json();
                if (payload && typeof payload.error === "string") {
                  errorCode = payload.error;
                }
              } catch {}
              statusNode.textContent = "Invite creation failed: " + errorCode;
            } catch {
              statusNode.textContent = "Invite creation failed";
            } finally {
              if (button instanceof HTMLButtonElement) {
                button.disabled = false;
              }
            }
          });
        });
      })();
    </script>
  `;
}

function renderAdminUsersPage(input: { items: AdminUserListItem[] }): string {
  const rows = input.items
    .map((item) => {
      const nextStatus = item.status === "active" ? "disabled" : "active";
      const actionLabel = item.status === "active" ? "Disable" : "Enable";

      return `
        <tr>
          <td>${escapeHtml(item.createdAt.toISOString())}</td>
          <td>${escapeHtml(item.email)}</td>
          <td>${escapeHtml(item.role)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.lastLoginAt?.toISOString() ?? "")}</td>
          <td>
            <form class="admin-user-status-form" data-user-id="${escapeHtml(item.id)}" data-next-status="${nextStatus}">
              <button type="submit">${actionLabel}</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <h1>Admin users</h1>
    <p><a href="/admin">Back to admin</a></p>
    <p id="admin-users-status" aria-live="polite"></p>
    <table border="1" cellpadding="4" cellspacing="0">
      <thead>
        <tr>
          <th>created_at</th>
          <th>email</th>
          <th>role</th>
          <th>status</th>
          <th>last_login_at</th>
          <th>action</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="6">No users</td></tr>'}
      </tbody>
    </table>
    <script>
      (() => {
        const statusNode = document.getElementById("admin-users-status");
        if (!(statusNode instanceof HTMLElement)) {
          return;
        }

        document.querySelectorAll(".admin-user-status-form").forEach((form) => {
          if (!(form instanceof HTMLFormElement)) {
            return;
          }

          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const userId = form.dataset.userId;
            const nextStatus = form.dataset.nextStatus;
            const button = form.querySelector('button[type="submit"]');
            if (!userId || (nextStatus !== "active" && nextStatus !== "disabled")) {
              return;
            }

            if (button instanceof HTMLButtonElement) {
              button.disabled = true;
            }

            statusNode.textContent = "Updating...";
            try {
              const response = await fetch("/api/admin/users/" + encodeURIComponent(userId), {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: nextStatus }),
              });

              if (response.ok) {
                statusNode.textContent = "Updated.";
                window.location.reload();
                return;
              }

              let errorCode = "request_failed";
              try {
                const payload = await response.json();
                if (payload && typeof payload.error === "string") {
                  errorCode = payload.error;
                }
              } catch {}
              statusNode.textContent = "Update failed: " + errorCode;
            } catch {
              statusNode.textContent = "Update failed";
            } finally {
              if (button instanceof HTMLButtonElement) {
                button.disabled = false;
              }
            }
          });
        });
      })();
    </script>
  `;
}

function renderAdminFilterLink(
  label: string,
  value: "new" | "contacted" | "approved" | "rejected" | null,
  currentFilter: "new" | "contacted" | "approved" | "rejected" | null,
): string {
  const href = value ? `/admin/access-requests?status=${encodeURIComponent(value)}` : "/admin/access-requests";
  const isCurrent = value === currentFilter;
  return `<a href="${href}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a> `;
}

function normalizeAdminStatusFilterForUi(
  value: string | null,
): "new" | "contacted" | "approved" | "rejected" | null {
  if (value === "new" || value === "contacted" || value === "approved" || value === "rejected") {
    return value;
  }

  return null;
}

function logAccessRequestEvent(event: string, fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event,
      ...fields,
    }),
  );
}

function renderProtectedPage(
  area: "app" | "admin",
  pathname: string,
  session: AuthenticatedSession,
): string {
  return `
    <h1>${area.toUpperCase()} placeholder</h1>
    <p>path: ${escapeHtml(pathname)}</p>
    <p>email: ${escapeHtml(session.user.email)}</p>
    <p>role: ${escapeHtml(session.user.role)}</p>
    <form method="post" action="/api/auth/logout">
      <button type="submit">Logout</button>
    </form>
  `;
}

function renderSharePlaceholderPage(reportRef: string): string {
  return `
    <h1>Shared report placeholder</h1>
    <p>report_ref: ${escapeHtml(reportRef)}</p>
  `;
}

function serializeAdminAccessRequest(item: AdminAccessRequest): Record<string, string | null> {
  return {
    id: item.id,
    created_at: item.createdAt.toISOString(),
    email: item.email,
    name: item.fullName,
    company: item.company,
    note: item.message,
    status: item.status,
    handled_by: item.handledByUserId,
    handled_at: item.handledAt ? item.handledAt.toISOString() : null,
  };
}

function serializeAdminUser(item: AdminUserListItem): Record<string, string | null> {
  return {
    id: item.id,
    created_at: item.createdAt.toISOString(),
    email: item.email,
    role: item.role,
    status: item.status,
    last_login_at: item.lastLoginAt ? item.lastLoginAt.toISOString() : null,
  };
}

function buildPathAndQuery(url: URL): string {
  return `${url.pathname}${url.search}`;
}

function parseInviteTokenFromPath(pathname: string): string | null {
  return parseSinglePathToken(pathname, "/invite/");
}

function parseShareTokenFromPath(pathname: string): string | null {
  return parseSinglePathToken(pathname, "/share/");
}

function parseSinglePathToken(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const rawToken = pathname.slice(prefix.length);
  if (!rawToken || rawToken.includes("/")) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(rawToken).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
