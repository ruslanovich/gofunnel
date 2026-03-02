import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Busboy, type BusboyHeaders } from "@fastify/busboy";

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
  FileDetailsService,
  FileReportError,
  FileReportService,
  FileListService,
  FileListValidationError,
  FILE_UPLOAD_MAX_BYTES,
  FileUploadError,
  FileUploadService,
  FileUploadValidationError,
  normalizeListLimit,
} from "../../app/files/service.js";
import type { FileDetailsItem, FileListCursor, FileListItem } from "../../app/files/contracts.js";
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
import { PostgresFileRepository } from "../../infra/files/postgres_file_repository.js";
import { PostgresInviteRepository } from "../../infra/invites/postgres_invite_repository.js";
import { PostgresProcessingJobRepository } from "../../infra/processing/postgres_processing_job_repository.js";
import { hashOpaqueToken } from "../../infra/security/token_hash.js";
import { PostgresReportShareRepository } from "../../infra/shares/postgres_report_share_repository.js";
import { createS3StorageService, loadS3StorageEnv } from "../../infra/storage/s3_client.js";
import { buildClearSessionCookie, buildSessionCookie, getSessionCookieValue } from "./cookies.js";
import { isAllowedOriginForStateChange } from "./csrf.js";
import type { HttpServerConfig } from "./config.js";
import { loadHttpServerConfig } from "./config.js";
import { renderReportDocument } from "./report_ui/render_report_page.js";
import { buttonClassName, renderBadge, renderCard, renderEmptyState } from "./ui/components.js";
import {
  REPORT_UI_COPY,
  UI_COPY,
  toAccessRequestStatusCopy,
  toFileStatusCopy,
  toUserRoleCopy,
  toUserStatusCopy,
} from "./ui/copy.js";
import { renderDocument, renderPageLayout } from "./ui/layout.js";
import { BASE_UI_CSS } from "./ui/tokens.js";

export type AuthHttpServerDeps = {
  authService: AuthService;
  accessRequestService: AccessRequestService;
  adminUserService: AdminUserService;
  inviteService: InviteService;
  reportShareService: ReportShareService;
  fileUploadService: FileUploadService;
  fileListService: FileListService;
  fileDetailsService: FileDetailsService;
  fileReportService: FileReportService;
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
  const fileRepository = new PostgresFileRepository(pool);
  const processingJobRepository = new PostgresProcessingJobRepository(pool);
  const s3Env = loadS3StorageEnv(process.env);
  const s3Storage = createS3StorageService();
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
  const fileUploadService = new FileUploadService({
    repository: fileRepository,
    jobQueueRepository: processingJobRepository,
    storage: s3Storage,
    storageBucket: s3Env.S3_BUCKET,
    logEvent: logEvent,
  });
  const fileListService = new FileListService({
    repository: fileRepository,
  });
  const fileDetailsService = new FileDetailsService({
    repository: fileRepository,
  });
  const fileReportService = new FileReportService({
    repository: fileRepository,
    storage: s3Storage,
  });
  const server = createAuthHttpServer({
    authService,
    accessRequestService,
    adminUserService,
    inviteService,
    reportShareService,
    fileUploadService,
    fileListService,
    fileDetailsService,
    fileReportService,
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

  if (method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (method === "GET" && pathname === "/") {
    sendHtml(
      res,
      200,
      renderPageLayout({
        title: "gofunnel",
        description: "Сервис для обработки материалов встреч и управления доступом.",
        contentHtml: renderCard(`
          <div class="gf-toolbar">
            <a class="${buttonClassName({ variant: "primary" })}" href="/login">Вход</a>
            <a class="${buttonClassName({ variant: "secondary" })}" href="/request-access">Запросить доступ</a>
            <a class="${buttonClassName({ variant: "ghost" })}" href="/app">Приложение</a>
            <a class="${buttonClassName({ variant: "ghost" })}" href="/admin">Админка</a>
          </div>
        `),
        narrow: true,
      }),
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

  if (method === "POST" && pathname === "/api/files/upload") {
    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      sendText(res, 401, "auth_required");
      return;
    }

    let uploadPayload: MultipartUploadPayload;
    try {
      uploadPayload = await readMultipartUploadPayload(req);
    } catch (error) {
      if (error instanceof MultipartUploadError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }
      throw error;
    }

    try {
      const uploaded = await deps.fileUploadService.upload({
        userId: session.user.id,
        originalFilename: uploadPayload.filename,
        mimeType: uploadPayload.mimeType,
        sizeBytes: uploadPayload.bytes.length,
        bytes: uploadPayload.bytes,
      });

      sendJson(res, 200, {
        ok: true,
        file_id: uploaded.fileId,
        status: uploaded.status,
      });
      return;
    } catch (error) {
      if (error instanceof FileUploadValidationError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }

      if (error instanceof FileUploadError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }

      throw error;
    }
  }

  if (method === "GET" && pathname === "/api/files") {
    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      sendText(res, 401, "auth_required");
      return;
    }

    let cursor: FileListCursor | null = null;
    try {
      cursor = decodeFileListCursor(url.searchParams.get("cursor"));
    } catch (error) {
      if (error instanceof FileListCursorDecodeError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }
      throw error;
    }

    try {
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = parseListLimit(rawLimit);
      const listed = await deps.fileListService.listForUser({
        userId: session.user.id,
        limit: normalizeListLimit(parsedLimit),
        cursor,
      });

      sendJson(res, 200, {
        items: listed.items.map(serializeFileListItem),
        next_cursor: listed.nextCursor ? encodeFileListCursor(listed.nextCursor) : null,
      });
      return;
    } catch (error) {
      if (error instanceof FileListValidationError) {
        sendJson(res, error.httpStatus, { error: error.code });
        return;
      }
      throw error;
    }
  }

  if (method === "GET" && pathname.startsWith("/api/files/")) {
    const reportFileId = parseFileIdFromReportPath(pathname);
    if (reportFileId) {
      const session = await tryGetSession(req, deps.authService);
      if (!session) {
        sendText(res, 401, "auth_required");
        return;
      }

      if (!isCanonicalUuid(reportFileId)) {
        sendJson(res, 400, { error: "invalid_id" });
        return;
      }

      try {
        const report = await deps.fileReportService.getForUser({
          id: reportFileId,
          userId: session.user.id,
        });

        if (!report) {
          sendText(res, 404, "Not Found");
          return;
        }

        sendJson(res, 200, report.report);
        return;
      } catch (error) {
        if (error instanceof FileReportError) {
          if (error.code === "report_not_ready") {
            sendJson(res, error.httpStatus, { error: error.code });
            return;
          }

          logEvent("report_fetch_failed", {
            fileId: reportFileId,
            error: sanitizeFileErrorMessageForResponse(error.details) ?? error.code,
          });
          sendJson(res, error.httpStatus, { error: error.code });
          return;
        }

        throw error;
      }
    }

    const fileId = parseFileIdFromPath(pathname);
    if (!fileId) {
      sendText(res, 404, "Not Found");
      return;
    }

    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      sendText(res, 401, "auth_required");
      return;
    }

    if (!isCanonicalUuid(fileId)) {
      sendJson(res, 400, { error: "invalid_id" });
      return;
    }

    const item = await deps.fileDetailsService.getForUser({
      id: fileId,
      userId: session.user.id,
    });
    if (!item) {
      sendText(res, 404, "Not Found");
      return;
    }

    sendJson(res, 200, serializeFileDetailsItem(item));
    return;
  }

  if (method === "GET" && pathname.startsWith("/files/")) {
    const fileId = parseFileIdFromStandaloneReportPath(pathname);
    if (!fileId) {
      sendText(res, 404, "Not Found");
      return;
    }

    const session = await tryGetSession(req, deps.authService);
    if (!session) {
      redirect(res, 303, buildLoginRedirectLocation(buildPathAndQuery(url)));
      return;
    }

    if (!isCanonicalUuid(fileId)) {
      sendJson(res, 400, { error: "invalid_id" });
      return;
    }

    try {
      const report = await deps.fileReportService.getForUser({
        id: fileId,
        userId: session.user.id,
      });
      if (!report) {
        sendText(res, 404, "Not Found");
        return;
      }

      sendStandaloneHtml(
        res,
        200,
        renderReportDocument({
          title: "Отчёт по созвону",
          subtitle: `Файл: ${report.id}`,
          report: report.report,
          meta: {
            reportRef: report.id,
            source: "app",
            generatedAt: new Date().toISOString(),
          },
        }),
      );
      return;
    } catch (error) {
      if (error instanceof FileReportError) {
        if (error.code === "report_not_ready") {
          sendStandaloneHtml(
            res,
            200,
            renderReportDocument({
              title: "Отчёт по созвону",
              subtitle: `Файл: ${fileId} • отчёт ещё не готов`,
              report: {
                meta: {
                  schema_version: "unknown",
                },
              },
              meta: {
                reportRef: fileId,
                source: "app",
                generatedAt: new Date().toISOString(),
              },
            }),
          );
          return;
        }

        sendText(res, error.httpStatus, error.code);
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
      let shareReport: unknown = {
        meta: {
          schema_version: "unknown",
        },
      };
      let subtitle = `Share ref: ${share.reportRef}`;

      if (isCanonicalUuid(share.reportRef)) {
        try {
          const report = await deps.fileReportService.getForUser({
            id: share.reportRef,
            userId: session.user.id,
          });
          if (report) {
            shareReport = report.report;
            subtitle = `Share ref: ${share.reportRef} • готово к просмотру`;
          } else {
            subtitle = `Share ref: ${share.reportRef} • отчёт не найден`;
          }
        } catch (error) {
          if (error instanceof FileReportError) {
            if (error.code === "report_not_ready") {
              subtitle = `Share ref: ${share.reportRef} • отчёт ещё не готов`;
            } else {
              subtitle = `Share ref: ${share.reportRef} • не удалось загрузить отчёт`;
            }
          } else {
            throw error;
          }
        }
      } else {
        subtitle = `Share ref: ${share.reportRef} • legacy reference`;
      }

      sendStandaloneHtml(
        res,
        200,
        renderReportDocument({
          title: "Отчёт по созвону",
          subtitle,
          report: shareReport,
          meta: {
            reportRef: share.reportRef,
            source: "share",
            generatedAt: new Date().toISOString(),
          },
        }),
      );
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

    if (method === "GET" && pathname === "/app") {
      sendHtml(res, 200, renderAppDashboardPage(session));
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

    if (method === "GET" && pathname === "/admin") {
      redirect(res, 303, "/admin/access-requests");
      return;
    }

    if (method === "GET" && pathname === "/admin/access-requests") {
      try {
        const items = await deps.accessRequestService.listForAdmin({
          status: null,
        });
        sendHtml(
          res,
          200,
          renderAdminAccessRequestsPage({
            initialStatusFilter: url.searchParams.get("status"),
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

type MultipartUploadPayload = {
  filename: string;
  mimeType: string | null;
  bytes: Buffer;
};

class MultipartUploadError extends Error {
  readonly httpStatus: 400 | 413;
  readonly code: "invalid_multipart" | "file_too_large";

  constructor(code: "invalid_multipart" | "file_too_large") {
    super(code);
    this.name = "MultipartUploadError";
    this.code = code;
    this.httpStatus = code === "file_too_large" ? 413 : 400;
  }
}

class FileListCursorDecodeError extends Error {
  readonly httpStatus = 400;
  readonly code = "invalid_cursor";

  constructor() {
    super("invalid_cursor");
    this.name = "FileListCursorDecodeError";
  }
}

async function readMultipartUploadPayload(req: IncomingMessage): Promise<MultipartUploadPayload> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new MultipartUploadError("invalid_multipart");
  }

  return new Promise<MultipartUploadPayload>((resolve, reject) => {
    const headers: BusboyHeaders = {
      ...req.headers,
      "content-type": contentType,
    };
    const parser = new Busboy({
      headers,
      limits: {
        files: 1,
        fileSize: FILE_UPLOAD_MAX_BYTES,
      },
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let seenFileField = false;
    let finished = false;
    let filename = "";
    let mimeType: string | null = null;

    const rejectOnce = (error: Error): void => {
      if (finished) {
        return;
      }
      finished = true;
      req.unpipe(parser);
      req.resume();
      reject(error);
    };

    const resolveOnce = (payload: MultipartUploadPayload): void => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(payload);
    };

    parser.on(
      "file",
      (
        fieldname: string,
        stream: NodeJS.ReadableStream,
        incomingFilename: string,
        _encoding: string,
        incomingMimeType: string,
      ) => {
        if (fieldname !== "file") {
          stream.resume();
          return;
        }

        seenFileField = true;
        filename = incomingFilename;
        const normalizedMimeType = incomingMimeType.trim().toLowerCase();
        mimeType = normalizedMimeType === "" ? null : normalizedMimeType;

        stream.on("limit", () => {
          rejectOnce(new MultipartUploadError("file_too_large"));
        });

        stream.on("data", (chunk: Buffer | string) => {
          const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bufferChunk.length;
          if (size > FILE_UPLOAD_MAX_BYTES) {
            rejectOnce(new MultipartUploadError("file_too_large"));
            return;
          }
          chunks.push(bufferChunk);
        });

        stream.on("error", (error: unknown) => {
          void error;
          rejectOnce(new MultipartUploadError("invalid_multipart"));
        });
      },
    );

    parser.on("filesLimit", () => {
      rejectOnce(new MultipartUploadError("invalid_multipart"));
    });

    parser.on("error", (error: unknown) => {
      void error;
      rejectOnce(new MultipartUploadError("invalid_multipart"));
    });

    parser.on("finish", () => {
      if (!seenFileField) {
        rejectOnce(new MultipartUploadError("invalid_multipart"));
        return;
      }

      resolveOnce({
        filename,
        mimeType,
        bytes: Buffer.concat(chunks, size),
      });
    });

    req.on("aborted", () => {
      rejectOnce(new MultipartUploadError("invalid_multipart"));
    });

    req.pipe(parser);
  });
}

function redirect(res: ServerResponse, statusCode: 302 | 303, location: string): void {
  res.statusCode = statusCode;
  res.setHeader("Location", location);
  res.end();
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(renderDocument(html, BASE_UI_CSS));
}

function sendStandaloneHtml(res: ServerResponse, statusCode: number, htmlDocument: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(htmlDocument);
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
  "Заявка принята. Если доступ будет одобрен, мы свяжемся с вами по электронной почте.";
const ACCESS_REQUEST_RATE_LIMIT_MESSAGE =
  "Не удалось отправить заявку. Попробуйте еще раз позже.";
const RETRY_ACTION_LABEL = UI_COPY.common.retry;

function renderLoginPage(nextPath: string | null): string {
  const hiddenNext = nextPath
    ? `<input type=\"hidden\" name=\"next\" value=\"${escapeHtml(nextPath)}\" />`
    : "";

  return renderPageLayout({
    title: "Вход в gofunnel",
    description: "Введите данные рабочей учетной записи, чтобы открыть реестр файлов и отчеты.",
    narrow: true,
    contentHtml: `
      ${renderCard(`
        <p id="login-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
        <form id="login-form" method="post" action="/api/auth/login" class="gf-grid">
          ${hiddenNext}
          <label class="gf-field">
            <span class="gf-label">${UI_COPY.common.email}</span>
            <input type="email" name="email" required autocomplete="email" placeholder="name@company.ru" />
            <span class="gf-field__hint">Используйте ту ${UI_COPY.common.emailLower}, на которую уже открыт доступ.</span>
          </label>
          <label class="gf-field">
            <span class="gf-label">Пароль</span>
            <input
              type="password"
              name="password"
              required
              autocomplete="current-password"
              placeholder="Введите пароль"
            />
          </label>
          <button id="login-submit" class="${buttonClassName({ variant: "primary", size: "lg" })}" type="submit">Войти</button>
        </form>
        <p class="gf-field__hint">Если забыли пароль, обратитесь к администратору вашей рабочей среды.</p>
      `)}
      <p class="gf-auth-links">
        Нет доступа? <a href="/request-access">Запросить доступ</a>.
      </p>
      <script>
        (() => {
          const form = document.getElementById("login-form");
          const status = document.getElementById("login-status");
          const submitButton = document.getElementById("login-submit");
          if (
            !(form instanceof HTMLFormElement) ||
            !(status instanceof HTMLElement) ||
            !(submitButton instanceof HTMLButtonElement)
          ) {
            return;
          }

          const emailInput = form.elements.namedItem("email");
          const passwordInput = form.elements.namedItem("password");
          const nextInput = form.elements.namedItem("next");
          if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
            return;
          }

          const defaultButtonText = "Войти";

          const setStatus = (tone, message, details = []) => {
            status.className = "gf-alert gf-alert--" + tone;
            const lines = [message];
            for (const detail of details) {
              if (typeof detail === "string" && detail.trim() !== "") {
                lines.push(detail.trim());
              }
            }
            status.textContent = lines.join("\\n");
          };

          const setSubmitState = (pending) => {
            const requiredFilled =
              emailInput.value.trim() !== "" && passwordInput.value.trim() !== "";
            submitButton.disabled = pending || !requiredFilled;
            if (pending) {
              submitButton.textContent = "Входим...";
              return;
            }
            if (submitButton.textContent !== "${RETRY_ACTION_LABEL}") {
              submitButton.textContent = defaultButtonText;
            }
          };

          const parsePayload = (raw) => {
            if (typeof raw !== "string" || raw.trim() === "") {
              return null;
            }
            try {
              const parsed = JSON.parse(raw);
              return parsed && typeof parsed === "object" ? parsed : null;
            } catch {
              return null;
            }
          };

          const extractServerDetails = (payload, rawText) => {
            let errorCode = "";
            let errorMessage = "";

            if (payload && typeof payload === "object") {
              if (typeof payload.error_code === "string") {
                errorCode = payload.error_code.trim();
              } else if (typeof payload.error === "string") {
                errorCode = payload.error.trim();
              }
              if (typeof payload.error_message === "string") {
                errorMessage = payload.error_message.trim();
              } else if (typeof payload.message === "string") {
                errorMessage = payload.message.trim();
              }
            }

            if (!errorCode && !errorMessage && typeof rawText === "string") {
              const cleaned = rawText.trim();
              if (cleaned !== "" && cleaned.length <= 240 && !cleaned.startsWith("<")) {
                errorCode = cleaned;
              }
            }

            return {
              errorCode,
              errorMessage,
            };
          };

          const resolveFriendlyError = (statusCode, errorCode) => {
            if (statusCode === 401 || errorCode === "invalid_credentials") {
              return "Не удалось войти. Проверьте ${UI_COPY.common.emailLower} и пароль.";
            }
            if (statusCode === 403 || errorCode === "user_disabled") {
              return "Вход недоступен. Обратитесь к администратору.";
            }
            if (statusCode >= 500) {
              return "Не удалось выполнить вход из-за ошибки на сервере. ${RETRY_ACTION_LABEL}.";
            }
            return "Не удалось выполнить вход. ${RETRY_ACTION_LABEL}.";
          };

          const syncSubmitButton = () => {
            if (submitButton.textContent !== "${RETRY_ACTION_LABEL}") {
              submitButton.textContent = defaultButtonText;
            }
            setSubmitState(false);
          };

          emailInput.addEventListener("input", syncSubmitButton);
          passwordInput.addEventListener("input", syncSubmitButton);
          syncSubmitButton();

          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            setSubmitState(true);
            setStatus("info", "Проверяем данные...");

            try {
              const response = await fetch(form.action, {
                method: "POST",
                body: new URLSearchParams(new FormData(form)),
              });

              if (response.ok) {
                const redirectTarget =
                  nextInput instanceof HTMLInputElement &&
                  typeof nextInput.value === "string" &&
                  nextInput.value.startsWith("/")
                    ? nextInput.value
                    : "/app";
                window.location.assign(redirectTarget);
                return;
              }

              const rawText = await response.text();
              const payload = parsePayload(rawText);
              const serverDetails = extractServerDetails(payload, rawText);
              const details = [];
              if (serverDetails.errorMessage) {
                details.push("Сообщение: " + serverDetails.errorMessage);
              }
              if (serverDetails.errorCode) {
                details.push("Код ошибки: " + serverDetails.errorCode);
              }
              setStatus(
                response.status >= 500 ? "warning" : "danger",
                resolveFriendlyError(response.status, serverDetails.errorCode),
                details,
              );
              submitButton.textContent = response.status >= 500 ? "${RETRY_ACTION_LABEL}" : defaultButtonText;
            } catch {
              setStatus("warning", "Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.");
              submitButton.textContent = "${RETRY_ACTION_LABEL}";
            } finally {
              setSubmitState(false);
            }
          });
        })();
      </script>
    `,
  });
}

function renderInviteAcceptPage(token: string): string {
  return renderPageLayout({
    title: "Создание пароля",
    description: "Подтвердите приглашение и задайте пароль для рабочего аккаунта.",
    narrow: true,
    contentHtml: `
      ${renderCard(`
        <p id="invite-accept-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
        <form id="invite-accept-form" class="gf-grid">
          <input type="hidden" name="token" value="${escapeHtml(token)}" />
          <label class="gf-field">
            <span class="gf-label">Пароль</span>
            <input
              type="password"
              name="password"
              minlength="${INVITE_ACCEPT_MIN_PASSWORD_LENGTH}"
              required
              autocomplete="new-password"
            />
          </label>
          <button class="${buttonClassName({ variant: "primary", size: "lg" })}" type="submit">Принять приглашение</button>
        </form>
      `)}
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
            status.textContent = "Отправка...";

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
                status.textContent = "Ссылка-приглашение недействительна или устарела.";
                return;
              }
              if (errorCode === "password_too_short") {
                status.textContent =
                  "Минимальная длина пароля: ${INVITE_ACCEPT_MIN_PASSWORD_LENGTH} символов.";
                return;
              }
              if (errorCode === "user_exists") {
                status.textContent = "Аккаунт уже существует. Выполните вход.";
                return;
              }

              status.textContent = "Не удалось принять приглашение. Повторите попытку.";
            } catch {
              status.textContent = "Не удалось принять приглашение. Повторите попытку.";
            } finally {
              if (submitButton instanceof HTMLButtonElement) {
                submitButton.disabled = false;
              }
            }
          });
        })();
      </script>
    `,
  });
}

function renderRequestAccessPage(): string {
  const clientTs = Date.now();
  return renderPageLayout({
    title: "Запрос доступа",
    description: "Оставьте контакты и комментарий. Мы рассмотрим заявку и ответим по электронной почте.",
    narrow: true,
    contentHtml: `
      ${renderCard(`
        <p id="request-access-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
        <section id="request-access-success" class="gf-alert gf-alert--success" hidden>
          Заявка отправлена. Мы свяжемся с вами по электронной почте после проверки.
          <a href="/login">Вернуться ко входу</a>.
        </section>
        <form id="request-access-form" method="post" action="/api/access-requests" class="gf-grid">
          <div class="gf-honeypot" aria-hidden="true">
            <label>Сайт <input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
          </div>
          <input type="hidden" name="client_ts" value="${clientTs}" />
          <label class="gf-field">
            <span class="gf-label">${UI_COPY.common.email}</span>
            <input type="email" name="email" required autocomplete="email" placeholder="name@company.ru" />
            <span class="gf-field__hint">Используйте рабочую ${UI_COPY.common.emailLower}, чтобы мы могли связаться с вами.</span>
          </label>
          <div class="gf-grid gf-grid--two">
            <label class="gf-field">
              <span class="gf-label">Имя</span>
              <input type="text" name="name" autocomplete="name" placeholder="Как к вам обращаться" />
            </label>
            <label class="gf-field">
              <span class="gf-label">Компания</span>
              <input type="text" name="company" autocomplete="organization" placeholder="Название компании" />
            </label>
          </div>
          <label class="gf-field">
            <span class="gf-label">Комментарий</span>
            <textarea name="note" rows="4" cols="40" placeholder="Кратко опишите, для чего нужен доступ"></textarea>
          </label>
          <button id="request-access-submit" class="${buttonClassName({ variant: "primary", size: "lg" })}" type="submit">Отправить заявку</button>
        </form>
      `)}
      <script>
        (() => {
          const form = document.getElementById("request-access-form");
          const status = document.getElementById("request-access-status");
          const successState = document.getElementById("request-access-success");
          const submitButton = document.getElementById("request-access-submit");
          if (
            !(form instanceof HTMLFormElement) ||
            !(status instanceof HTMLElement) ||
            !(successState instanceof HTMLElement) ||
            !(submitButton instanceof HTMLButtonElement)
          ) {
            return;
          }

          const emailInput = form.elements.namedItem("email");
          const nameInput = form.elements.namedItem("name");
          const companyInput = form.elements.namedItem("company");
          const noteInput = form.elements.namedItem("note");
          if (!(emailInput instanceof HTMLInputElement)) {
            return;
          }

          const resetFieldStyles = () => {
            emailInput.style.borderColor = "";
            if (nameInput instanceof HTMLInputElement) {
              nameInput.style.borderColor = "";
            }
            if (companyInput instanceof HTMLInputElement) {
              companyInput.style.borderColor = "";
            }
            if (noteInput instanceof HTMLTextAreaElement) {
              noteInput.style.borderColor = "";
            }
          };

          const setFieldError = (field) => {
            if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
              field.style.borderColor = "var(--gf-danger-text)";
            }
          };

          const setStatus = (tone, message, details = []) => {
            status.className = "gf-alert gf-alert--" + tone;
            const lines = [message];
            for (const detail of details) {
              if (typeof detail === "string" && detail.trim() !== "") {
                lines.push(detail.trim());
              }
            }
            status.textContent = lines.join("\\n");
          };

          const setSubmitState = (pending) => {
            submitButton.disabled = pending;
            submitButton.textContent = pending ? "Отправляем..." : "Отправить заявку";
          };

          const parsePayload = (raw) => {
            if (typeof raw !== "string" || raw.trim() === "") {
              return null;
            }
            try {
              const parsed = JSON.parse(raw);
              return parsed && typeof parsed === "object" ? parsed : null;
            } catch {
              return null;
            }
          };

          const extractServerDetails = (payload, rawText) => {
            let errorCode = "";
            let errorMessage = "";

            if (payload && typeof payload === "object") {
              if (typeof payload.error_code === "string") {
                errorCode = payload.error_code.trim();
              } else if (typeof payload.error === "string") {
                errorCode = payload.error.trim();
              }
              if (typeof payload.error_message === "string") {
                errorMessage = payload.error_message.trim();
              } else if (typeof payload.message === "string") {
                errorMessage = payload.message.trim();
              }
            }

            if (!errorCode && !errorMessage && typeof rawText === "string") {
              const cleaned = rawText.trim();
              if (cleaned !== "" && cleaned.length <= 240 && !cleaned.startsWith("<")) {
                errorCode = cleaned;
              }
            }

            return {
              errorCode,
              errorMessage,
            };
          };

          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            successState.hidden = true;
            resetFieldStyles();
            setSubmitState(true);
            setStatus("info", "Проверяем заявку...");

            try {
              const response = await fetch("/api/access-requests", {
                method: "POST",
                body: new URLSearchParams(new FormData(form)),
              });

              if (response.ok) {
                form.hidden = true;
                setStatus("success", "Заявка отправлена. Мы свяжемся с вами по электронной почте.");
                successState.hidden = false;
                return;
              }

              const rawText = await response.text();
              const payload = parsePayload(rawText);
              const serverDetails = extractServerDetails(payload, rawText);
              const details = [];
              if (serverDetails.errorMessage) {
                details.push("Сообщение: " + serverDetails.errorMessage);
              }
              if (serverDetails.errorCode) {
                details.push("Код ошибки: " + serverDetails.errorCode);
              }

              if (response.status === 400) {
                setFieldError(emailInput);
                setStatus("danger", "Проверьте корректность данных формы и попробуйте снова.", details);
                return;
              }

              if (response.status === 429) {
                setStatus("warning", "Не удалось отправить заявку: слишком много попыток. Попробуйте позже.", details);
                return;
              }

              setStatus("danger", "Не удалось отправить заявку. Попробуйте позже.", details);
            } catch {
              setStatus("warning", "Не удалось связаться с сервером. Попробуйте позже.");
            } finally {
              if (!form.hidden) {
                setSubmitState(false);
              }
            }
          });
        })();
      </script>
    `,
  });
}

function renderAdminAccessRequestsPage(input: {
  initialStatusFilter: string | null;
  items: AdminAccessRequest[];
}): string {
  const initialStatusFilter = normalizeAdminStatusFilterForUi(input.initialStatusFilter);
  const rows = input.items
    .map((item) => {
      const statusUi = toAccessRequestStatusCopy(item.status);
      const createdAt = item.createdAt.toISOString();
      const fullName = item.fullName ?? "";
      const company = item.company ?? "";
      const note = item.message ?? "";
      const isApproved = item.status === "approved";
      const isRejected = item.status === "rejected";
      const isContacted = item.status === "contacted";

      return `
        <tr
          data-access-row
          data-access-request-id="${escapeHtml(item.id)}"
          data-email="${escapeHtml(item.email.toLowerCase())}"
          data-name="${escapeHtml(fullName.toLowerCase())}"
          data-status="${escapeHtml(item.status)}"
          class="gf-table-row--hover"
        >
          <td>
            <div>${escapeHtml(item.email)}</div>
            ${company ? `<div class="gf-cell-muted">Компания: ${escapeHtml(company)}</div>` : ""}
            ${note ? `<div class="gf-cell-muted">Комментарий: ${escapeHtml(note)}</div>` : ""}
          </td>
          <td>${fullName ? escapeHtml(fullName) : '<span class="gf-cell-muted">—</span>'}</td>
          <td>
            <time data-access-created-at datetime="${escapeHtml(createdAt)}">${escapeHtml(createdAt)}</time>
          </td>
          <td>
            ${renderBadge(escapeHtml(statusUi.label), statusUi.tone, {
              attributes: "data-access-status-badge",
            })}
          </td>
          <td>
            <div class="gf-toolbar">
              <form class="access-request-status-form" data-request-id="${escapeHtml(item.id)}" data-next-status="approved">
                <button
                  class="${buttonClassName({ variant: isApproved ? "secondary" : "primary", size: "sm" })}"
                  type="submit"
                  ${isApproved ? "disabled" : ""}
                >
                  Одобрить
                </button>
              </form>
              <form class="access-request-status-form" data-request-id="${escapeHtml(item.id)}" data-next-status="rejected">
                <button
                  class="${buttonClassName({ variant: "secondary", size: "sm" })}"
                  type="submit"
                  ${isRejected ? "disabled" : ""}
                >
                  Отклонить
                </button>
              </form>
              <form class="access-request-status-form" data-request-id="${escapeHtml(item.id)}" data-next-status="contacted">
                <button
                  class="${buttonClassName({ variant: "ghost", size: "sm" })}"
                  type="submit"
                  ${isContacted ? "disabled" : ""}
                >
                  Связались
                </button>
              </form>
            </div>
            <form
              class="access-request-invite-form gf-toolbar"
              data-request-id="${escapeHtml(item.id)}"
              data-email="${escapeHtml(item.email)}"
            >
              <button class="${buttonClassName({ variant: "secondary", size: "sm" })}" type="submit">Создать приглашение</button>
            </form>
            <div class="access-request-invite-output gf-toolbar" hidden>
              <a class="access-request-invite-link" href=""></a>
              <button class="${buttonClassName({ variant: "ghost", size: "sm" })} access-request-copy-button" type="button">Копировать</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return renderPageLayout({
    title: "Заявки на доступ",
    description: "Проверяйте входящие заявки, меняйте статусы и выпускайте приглашения.",
    topNavHtml: `
      <a class="gf-nav-link" href="/admin/users">Пользователи</a>
      <a class="gf-nav-link" href="/app">Вернуться в приложение</a>
    `,
    contentHtml: `
      ${renderCard(`
        <div class="gf-control-row" aria-label="Локальные фильтры заявок">
          <label class="gf-field gf-field--compact gf-control">
            <span class="gf-label">Поиск</span>
            <input
              id="admin-access-search"
              type="text"
              autocomplete="off"
              placeholder="Поиск по эл. почте или имени"
            />
          </label>
          <label class="gf-field gf-field--compact gf-control">
            <span class="gf-label">Статус</span>
            <select id="admin-access-status-filter">
              <option value="all"${initialStatusFilter === null ? " selected" : ""}>Все</option>
              <option value="new"${initialStatusFilter === "new" ? " selected" : ""}>Новые</option>
              <option value="contacted"${initialStatusFilter === "contacted" ? " selected" : ""}>Связались</option>
              <option value="approved"${initialStatusFilter === "approved" ? " selected" : ""}>Одобрены</option>
              <option value="rejected"${initialStatusFilter === "rejected" ? " selected" : ""}>Отклонены</option>
            </select>
          </label>
          <div class="gf-field gf-field--compact gf-control">
            <span class="gf-label">Показано</span>
            <p id="admin-access-visible-count" class="gf-field__hint">0</p>
          </div>
        </div>
        <p id="admin-access-requests-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
        <div class="gf-table-wrap">
          <table class="gf-table">
            <thead>
              <tr>
                <th>${UI_COPY.common.email}</th>
                <th>Имя</th>
                <th>Создано</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody id="admin-access-requests-body">
              ${rows}
              <tr id="admin-access-requests-empty-row" hidden>
                <td colspan="5">
                  <div class="gf-empty-inline">
                    <p id="admin-access-requests-empty-title" class="gf-empty-inline__title">Заявок пока нет</p>
                    <p id="admin-access-requests-empty-hint" class="gf-empty-inline__hint">Когда появятся новые заявки, они отобразятся в таблице.</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `)}
      <script>
        (() => {
          const statusNode = document.getElementById("admin-access-requests-status");
          const searchInput = document.getElementById("admin-access-search");
          const statusFilter = document.getElementById("admin-access-status-filter");
          const visibleCountNode = document.getElementById("admin-access-visible-count");
          const body = document.getElementById("admin-access-requests-body");
          const emptyRow = document.getElementById("admin-access-requests-empty-row");
          const emptyTitleNode = document.getElementById("admin-access-requests-empty-title");
          const emptyHintNode = document.getElementById("admin-access-requests-empty-hint");
          if (
            !(statusNode instanceof HTMLElement) ||
            !(searchInput instanceof HTMLInputElement) ||
            !(statusFilter instanceof HTMLSelectElement) ||
            !(visibleCountNode instanceof HTMLElement) ||
            !(body instanceof HTMLTableSectionElement) ||
            !(emptyRow instanceof HTMLTableRowElement) ||
            !(emptyTitleNode instanceof HTMLElement) ||
            !(emptyHintNode instanceof HTMLElement)
          ) {
            return;
          }

          const allRows = Array.from(body.querySelectorAll("tr[data-access-row]"));

          function setStatus(tone, message) {
            statusNode.className = "gf-alert gf-alert--" + tone;
            statusNode.textContent = message;
          }

          function formatDate(value) {
            if (typeof value !== "string") {
              return "—";
            }
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) {
              return value;
            }
            return parsed.toLocaleString("ru-RU");
          }

          const accessStatusUiMap = ${JSON.stringify({
            new: toAccessRequestStatusCopy("new"),
            contacted: toAccessRequestStatusCopy("contacted"),
            approved: toAccessRequestStatusCopy("approved"),
            rejected: toAccessRequestStatusCopy("rejected"),
          })};

          function toStatusUi(status) {
            const resolved = accessStatusUiMap[String(status || "")];
            if (resolved) return resolved;
            return { label: String(status || "—"), tone: "info" };
          }

          function updateEmptyState(visibleRows) {
            const hasFilters = searchInput.value.trim() !== "" || statusFilter.value !== "all";
            const showEmpty = visibleRows === 0;
            emptyRow.hidden = !showEmpty;
            if (!showEmpty) {
              return;
            }
            if (allRows.length === 0) {
              emptyTitleNode.textContent = "Заявок пока нет";
              emptyHintNode.textContent = "Когда появятся новые заявки, они отобразятся в таблице.";
              return;
            }
            if (hasFilters) {
              emptyTitleNode.textContent = "Ничего не найдено";
              emptyHintNode.textContent = "Измените параметры поиска или фильтра.";
              return;
            }
            emptyTitleNode.textContent = "Заявок пока нет";
            emptyHintNode.textContent = "Когда появятся новые заявки, они отобразятся в таблице.";
          }

          function applyLocalFilters() {
            const query = searchInput.value.trim().toLowerCase();
            const selectedStatus = statusFilter.value;
            let visibleRows = 0;

            for (const row of allRows) {
              if (!(row instanceof HTMLTableRowElement)) {
                continue;
              }

              const email = String(row.dataset.email || "");
              const name = String(row.dataset.name || "");
              const rowStatus = String(row.dataset.status || "");
              const searchMatch = query === "" || email.includes(query) || name.includes(query);
              const statusMatch = selectedStatus === "all" || rowStatus === selectedStatus;
              const visible = searchMatch && statusMatch;
              row.hidden = !visible;
              if (visible) {
                visibleRows += 1;
              }
            }

            visibleCountNode.textContent = String(visibleRows);
            updateEmptyState(visibleRows);
          }

          function updateRowStatus(row, nextStatus) {
            if (!(row instanceof HTMLTableRowElement)) {
              return;
            }

            row.dataset.status = nextStatus;
            const badge = row.querySelector("[data-access-status-badge]");
            if (badge instanceof HTMLElement) {
              const statusUi = toStatusUi(nextStatus);
              badge.className = "gf-badge gf-badge--" + statusUi.tone;
              badge.textContent = statusUi.label;
            }

            row.querySelectorAll(".access-request-status-form").forEach((form) => {
              if (!(form instanceof HTMLFormElement)) {
                return;
              }
              const submitButton = form.querySelector('button[type="submit"]');
              if (!(submitButton instanceof HTMLButtonElement)) {
                return;
              }
              submitButton.disabled = form.dataset.nextStatus === nextStatus;
            });
          }

          function setInviteOutput(row, inviteLink) {
            if (!(row instanceof HTMLTableRowElement)) {
              return;
            }

            const output = row.querySelector(".access-request-invite-output");
            const inviteLinkNode = row.querySelector(".access-request-invite-link");
            const copyButton = row.querySelector(".access-request-copy-button");
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
                  setStatus("success", "Ссылка приглашения скопирована.");
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
                setStatus("success", "Ссылка приглашения скопирована.");
              } catch {
                setStatus("warning", "Не удалось скопировать ссылку. Скопируйте вручную.");
              } finally {
                helper.remove();
              }
            };
          }

          body.querySelectorAll("time[data-access-created-at]").forEach((timeNode) => {
            if (!(timeNode instanceof HTMLTimeElement)) {
              return;
            }
            timeNode.textContent = formatDate(timeNode.dateTime);
          });

          document.querySelectorAll(".access-request-status-form").forEach((form) => {
            if (!(form instanceof HTMLFormElement)) {
              return;
            }

            form.addEventListener("submit", async (event) => {
              event.preventDefault();
              const requestId = form.dataset.requestId;
              const nextStatus = form.dataset.nextStatus;
              const button = form.querySelector('button[type="submit"]');
              if (
                !requestId ||
                (nextStatus !== "new" &&
                  nextStatus !== "contacted" &&
                  nextStatus !== "approved" &&
                  nextStatus !== "rejected")
              ) {
                return;
              }

              const row = form.closest("tr");
              const defaultLabel =
                button instanceof HTMLButtonElement ? button.textContent || "Обновить" : "Обновить";

              if (button instanceof HTMLButtonElement) {
                button.disabled = true;
                button.textContent = "Обновляем...";
              }

              setStatus("info", "Обновляем статус заявки...");
              try {
                const response = await fetch("/api/admin/access-requests/" + encodeURIComponent(requestId), {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ status: nextStatus }),
                });

                if (response.ok) {
                  updateRowStatus(row, nextStatus);
                  applyLocalFilters();
                  setStatus("success", "Статус заявки обновлён.");
                  return;
                }

                let errorCode = "request_failed";
                try {
                  const payload = await response.json();
                  if (payload && typeof payload.error === "string") {
                    errorCode = payload.error;
                  }
                } catch {}
                setStatus("danger", "Не удалось обновить статус: " + errorCode);
              } catch {
                setStatus("danger", "Не удалось обновить статус.");
              } finally {
                if (button instanceof HTMLButtonElement) {
                  button.textContent = defaultLabel;
                }
                if (row instanceof HTMLTableRowElement) {
                  const currentStatus = row.dataset.status;
                  updateRowStatus(row, currentStatus || "");
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

              const defaultLabel = button instanceof HTMLButtonElement ? button.textContent || "Создать приглашение" : "Создать приглашение";
              if (button instanceof HTMLButtonElement) {
                button.disabled = true;
                button.textContent = "Создаём...";
              }

              setStatus("info", "Создаём приглашение...");
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
                    updateRowStatus(row, "approved");
                    applyLocalFilters();
                    setStatus("success", "Приглашение создано.");
                    return;
                  }
                  setStatus("warning", "Приглашение создано, но ссылка не получена.");
                  return;
                }

                let errorCode = "request_failed";
                try {
                  const payload = await response.json();
                  if (payload && typeof payload.error === "string") {
                    errorCode = payload.error;
                  }
                } catch {}
                setStatus("danger", "Не удалось создать приглашение: " + errorCode);
              } catch {
                setStatus("danger", "Не удалось создать приглашение.");
              } finally {
                if (button instanceof HTMLButtonElement) {
                  button.textContent = defaultLabel;
                  button.disabled = false;
                }
              }
            });
          });

          searchInput.addEventListener("input", () => {
            applyLocalFilters();
          });
          statusFilter.addEventListener("change", () => {
            applyLocalFilters();
          });

          applyLocalFilters();
        })();
      </script>
    `,
  });
}

function renderAdminUsersPage(input: { items: AdminUserListItem[] }): string {
  const rows = input.items
    .map((item) => {
      const nextStatus = item.status === "active" ? "disabled" : "active";
      const actionLabel = item.status === "active" ? "Отключить" : "Включить";
      const createdAt = item.createdAt.toISOString();
      const roleUi = toUserRoleCopy(item.role);
      const statusUi = toUserStatusCopy(item.status);

      return `
        <tr
          data-user-row
          data-user-id="${escapeHtml(item.id)}"
          data-email="${escapeHtml(item.email.toLowerCase())}"
          data-role="${escapeHtml(item.role)}"
          data-status="${escapeHtml(item.status)}"
          class="gf-table-row--hover"
        >
          <td>${escapeHtml(item.email)}</td>
          <td>
            ${renderBadge(escapeHtml(roleUi.label), roleUi.tone, {
              attributes: "data-user-role-badge",
            })}
          </td>
          <td>
            ${renderBadge(escapeHtml(statusUi.label), statusUi.tone, {
              attributes: "data-user-status-badge",
            })}
          </td>
          <td>
            <time data-user-created-at datetime="${escapeHtml(createdAt)}">${escapeHtml(createdAt)}</time>
            ${
              item.lastLoginAt
                ? `<div class="gf-cell-muted">Последний вход: <time data-user-last-login-at datetime="${escapeHtml(item.lastLoginAt.toISOString())}">${escapeHtml(item.lastLoginAt.toISOString())}</time></div>`
                : '<div class="gf-cell-muted">Последний вход: —</div>'
            }
          </td>
          <td>
            <form class="admin-user-status-form" data-user-id="${escapeHtml(item.id)}" data-next-status="${nextStatus}">
              <button class="${buttonClassName({ variant: "secondary", size: "sm" })}" type="submit">${actionLabel}</button>
            </form>
          </td>
        </tr>
      `;
    })
    .join("");

  return renderPageLayout({
    title: "Пользователи",
    description: "Управляйте статусами пользователей и доступом к системе.",
    topNavHtml: `
      <a class="gf-nav-link" href="/admin/access-requests">Заявки</a>
      <a class="gf-nav-link" href="/app">Вернуться в приложение</a>
    `,
    contentHtml: `
      ${renderCard(`
        <div class="gf-control-row" aria-label="Локальные фильтры пользователей">
          <label class="gf-field gf-field--compact gf-control">
            <span class="gf-label">Поиск</span>
            <input id="admin-users-search" type="text" autocomplete="off" placeholder="Поиск по эл. почте" />
          </label>
          <label class="gf-field gf-field--compact gf-control">
            <span class="gf-label">Роль</span>
            <select id="admin-users-role-filter">
              <option value="all">Все роли</option>
              <option value="admin">Администратор</option>
              <option value="user">Пользователь</option>
            </select>
          </label>
          <label class="gf-field gf-field--compact gf-control">
            <span class="gf-label">Статус</span>
            <select id="admin-users-status-filter">
              <option value="all">Все статусы</option>
              <option value="active">Активен</option>
              <option value="disabled">Отключён</option>
            </select>
          </label>
        </div>
        <p id="admin-users-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
        <div class="gf-table-wrap">
          <table class="gf-table">
            <thead>
              <tr>
                <th>${UI_COPY.common.email}</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Создано</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody id="admin-users-body">
              ${rows}
              <tr id="admin-users-empty-row" hidden>
                <td colspan="5">
                  <div class="gf-empty-inline">
                    <p id="admin-users-empty-title" class="gf-empty-inline__title">Пользователей пока нет</p>
                    <p id="admin-users-empty-hint" class="gf-empty-inline__hint">Когда появятся пользователи, они отобразятся в таблице.</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `)}
      <script>
        (() => {
          const statusNode = document.getElementById("admin-users-status");
          const searchInput = document.getElementById("admin-users-search");
          const roleFilter = document.getElementById("admin-users-role-filter");
          const statusFilter = document.getElementById("admin-users-status-filter");
          const body = document.getElementById("admin-users-body");
          const emptyRow = document.getElementById("admin-users-empty-row");
          const emptyTitleNode = document.getElementById("admin-users-empty-title");
          const emptyHintNode = document.getElementById("admin-users-empty-hint");
          if (
            !(statusNode instanceof HTMLElement) ||
            !(searchInput instanceof HTMLInputElement) ||
            !(roleFilter instanceof HTMLSelectElement) ||
            !(statusFilter instanceof HTMLSelectElement) ||
            !(body instanceof HTMLTableSectionElement) ||
            !(emptyRow instanceof HTMLTableRowElement) ||
            !(emptyTitleNode instanceof HTMLElement) ||
            !(emptyHintNode instanceof HTMLElement)
          ) {
            return;
          }

          const allRows = Array.from(body.querySelectorAll("tr[data-user-row]"));

          function setStatus(tone, message) {
            statusNode.className = "gf-alert gf-alert--" + tone;
            statusNode.textContent = message;
          }

          function formatDate(value) {
            if (typeof value !== "string") {
              return "—";
            }
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) {
              return value;
            }
            return parsed.toLocaleString("ru-RU");
          }

          const userStatusUiMap = ${JSON.stringify({
            active: toUserStatusCopy("active"),
            disabled: toUserStatusCopy("disabled"),
          })};

          function toStatusUi(status) {
            const resolved = userStatusUiMap[String(status || "")];
            if (resolved) return resolved;
            return { label: String(status || "—"), tone: "info" };
          }

          function updateEmptyState(visibleRows) {
            const hasFilters =
              searchInput.value.trim() !== "" || roleFilter.value !== "all" || statusFilter.value !== "all";
            const showEmpty = visibleRows === 0;
            emptyRow.hidden = !showEmpty;
            if (!showEmpty) {
              return;
            }
            if (allRows.length === 0) {
              emptyTitleNode.textContent = "Пользователей пока нет";
              emptyHintNode.textContent = "Когда появятся пользователи, они отобразятся в таблице.";
              return;
            }
            if (hasFilters) {
              emptyTitleNode.textContent = "Ничего не найдено";
              emptyHintNode.textContent = "Измените параметры поиска или фильтра.";
              return;
            }
            emptyTitleNode.textContent = "Пользователей пока нет";
            emptyHintNode.textContent = "Когда появятся пользователи, они отобразятся в таблице.";
          }

          function applyLocalFilters() {
            const query = searchInput.value.trim().toLowerCase();
            const selectedRole = roleFilter.value;
            const selectedStatus = statusFilter.value;
            let visibleRows = 0;

            for (const row of allRows) {
              if (!(row instanceof HTMLTableRowElement)) {
                continue;
              }

              const email = String(row.dataset.email || "");
              const role = String(row.dataset.role || "");
              const status = String(row.dataset.status || "");
              const searchMatch = query === "" || email.includes(query);
              const roleMatch = selectedRole === "all" || role === selectedRole;
              const statusMatch = selectedStatus === "all" || status === selectedStatus;
              const visible = searchMatch && roleMatch && statusMatch;
              row.hidden = !visible;
              if (visible) {
                visibleRows += 1;
              }
            }

            updateEmptyState(visibleRows);
          }

          function updateRowStatus(row, nextStatus) {
            if (!(row instanceof HTMLTableRowElement)) {
              return;
            }
            row.dataset.status = nextStatus;

            const statusBadge = row.querySelector("[data-user-status-badge]");
            if (statusBadge instanceof HTMLElement) {
              const statusUi = toStatusUi(nextStatus);
              statusBadge.className = "gf-badge gf-badge--" + statusUi.tone;
              statusBadge.textContent = statusUi.label;
            }

            const form = row.querySelector(".admin-user-status-form");
            if (!(form instanceof HTMLFormElement)) {
              return;
            }
            const button = form.querySelector('button[type="submit"]');
            if (!(button instanceof HTMLButtonElement)) {
              return;
            }

            const nextActionStatus = nextStatus === "active" ? "disabled" : "active";
            form.dataset.nextStatus = nextActionStatus;
            button.textContent = nextActionStatus === "disabled" ? "Отключить" : "Включить";
          }

          body.querySelectorAll("time[data-user-created-at], time[data-user-last-login-at]").forEach((timeNode) => {
            if (!(timeNode instanceof HTMLTimeElement)) {
              return;
            }
            timeNode.textContent = formatDate(timeNode.dateTime);
          });

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

              const row = form.closest("tr");
              const defaultLabel =
                button instanceof HTMLButtonElement ? button.textContent || "Обновить" : "Обновить";
              let updated = false;

              if (button instanceof HTMLButtonElement) {
                button.disabled = true;
                button.textContent = "Обновляем...";
              }

              setStatus("info", "Обновляем пользователя...");
              try {
                const response = await fetch("/api/admin/users/" + encodeURIComponent(userId), {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ status: nextStatus }),
                });

                if (response.ok) {
                  updateRowStatus(row, nextStatus);
                  applyLocalFilters();
                  setStatus("success", "Статус пользователя обновлён.");
                  updated = true;
                  return;
                }

                let errorCode = "request_failed";
                try {
                  const payload = await response.json();
                  if (payload && typeof payload.error === "string") {
                    errorCode = payload.error;
                  }
                } catch {}
                setStatus("danger", "Не удалось обновить пользователя: " + errorCode);
              } catch {
                setStatus("danger", "Не удалось обновить пользователя.");
              } finally {
                if (button instanceof HTMLButtonElement) {
                  if (!updated) {
                    button.textContent = defaultLabel;
                  }
                  button.disabled = false;
                }
              }
            });
          });

          searchInput.addEventListener("input", () => {
            applyLocalFilters();
          });
          roleFilter.addEventListener("change", () => {
            applyLocalFilters();
          });
          statusFilter.addEventListener("change", () => {
            applyLocalFilters();
          });

          applyLocalFilters();
        })();
      </script>
    `,
  });
}

function normalizeAdminStatusFilterForUi(
  value: string | null,
): "new" | "contacted" | "approved" | "rejected" | null {
  if (value === "new" || value === "contacted" || value === "approved" || value === "rejected") {
    return value;
  }

  return null;
}

function toUserRoleLabel(role: "admin" | "user" | string): string {
  return toUserRoleCopy(role).label;
}

function logAccessRequestEvent(event: string, fields: Record<string, unknown>): void {
  logEvent(event, fields);
}

function logEvent(event: string, fields: Record<string, unknown>): void {
  console.info(
    JSON.stringify({
      event,
      ...fields,
    }),
  );
}

function renderAppDashboardPage(session: AuthenticatedSession): string {
  const topNavHtml =
    session.user.role === "admin"
      ? `<a class="gf-nav-link" href="/admin/access-requests">Админка</a>`
      : "";

  return renderPageLayout({
    title: "Файлы",
    description: "Загрузки и результаты обработки.",
    topNavHtml,
    headerActionsHtml: `
      <span class="gf-pill">${escapeHtml(session.user.email)}</span>
      <span class="gf-pill">${escapeHtml(toUserRoleLabel(session.user.role))}</span>
      <form method="post" action="/api/auth/logout">
        <button class="${buttonClassName({ variant: "ghost", size: "sm" })}" type="submit">Выйти</button>
      </form>
    `,
    contentHtml: `
      ${renderCard(
        `
          <div class="gf-toolbar gf-toolbar--space gf-app-cta">
            <div>
              <h2 class="gf-section-title">Обработанные транскрипты</h2>
              <p class="gf-section-description">Загрузите .txt или .vtt, чтобы добавить файл в очередь обработки.</p>
            </div>
            <div class="gf-meta">
              <span>Автообновление списка: каждые 7 секунд</span>
            </div>
          </div>

          <p id="app-files-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
          <p>
            <button
              id="app-retry-button"
              class="${buttonClassName({ variant: "secondary", size: "sm" })}"
              type="button"
              hidden
            >
              Повторить
            </button>
          </p>

          <div class="gf-stats-grid" aria-label="Сводка по файлам">
            <article class="gf-stat-card">
              <p class="gf-stat-card__label">В списке</p>
              <p id="app-stat-total" class="gf-stat-card__value">0</p>
            </article>
            <article class="gf-stat-card">
              <p class="gf-stat-card__label">В очереди</p>
              <p id="app-stat-queued" class="gf-stat-card__value">0</p>
            </article>
            <article class="gf-stat-card">
              <p class="gf-stat-card__label">В обработке</p>
              <p id="app-stat-processing" class="gf-stat-card__value">0</p>
            </article>
            <article class="gf-stat-card">
              <p class="gf-stat-card__label">Готово</p>
              <p id="app-stat-ready" class="gf-stat-card__value">0</p>
            </article>
            <article class="gf-stat-card">
              <p class="gf-stat-card__label">С ошибкой</p>
              <p id="app-stat-failed" class="gf-stat-card__value">0</p>
            </article>
          </div>

          <form id="app-upload-form" class="gf-grid">
            <label class="gf-field">
              <span class="gf-label">Файл для обработки</span>
              <input id="app-upload-input" type="file" name="file" accept=".txt,.vtt" required />
              <span class="gf-field__hint">Поддерживаемые форматы: <b>.txt</b>, <b>.vtt</b></span>
            </label>
            <div class="gf-toolbar">
              <button id="app-upload-button" class="${buttonClassName({ variant: "primary" })}" type="submit">Загрузить</button>
              <button id="app-refresh-button" class="${buttonClassName({ variant: "secondary" })}" type="button">Обновить</button>
            </div>
          </form>
        `,
        "gf-card--muted",
      )}
      ${renderCard(`
        <div class="gf-toolbar gf-toolbar--space">
          <div class="gf-control-row">
            <label class="gf-field gf-field--compact gf-control">
              <span class="gf-label">Поиск</span>
              <input id="app-search-input" type="text" placeholder="Поиск по имени файла" autocomplete="off" />
            </label>
            <label class="gf-field gf-field--compact gf-control">
              <span class="gf-label">Статус</span>
              <select id="app-status-filter">
                <option value="all">Все</option>
                <option value="queued">В очереди</option>
                <option value="processing">В обработке</option>
                <option value="succeeded">Готово</option>
                <option value="failed">Ошибка</option>
              </select>
            </label>
            <label class="gf-field gf-field--compact gf-control">
              <span class="gf-label">Сортировка</span>
              <select id="app-sort-select">
                <option value="created_desc">Сначала новые</option>
                <option value="created_asc">Сначала старые</option>
                <option value="name_asc">Имя файла (А-Я)</option>
                <option value="status">Статус</option>
              </select>
            </label>
          </div>
        </div>
        <div class="gf-table-wrap">
          <table id="app-files-table" class="gf-table">
            <thead>
              <tr>
                <th>Файл</th>
                <th>Статус</th>
                <th>Загружен</th>
                <th>Размер</th>
                <th>Ошибка</th>
                <th>Длительность <span class="gf-col-hint">${UI_COPY.common.inDevelopmentShort}</span></th>
                <th>Участники <span class="gf-col-hint">${UI_COPY.common.inDevelopmentShort}</span></th>
                <th>Язык <span class="gf-col-hint">${UI_COPY.common.inDevelopmentShort}</span></th>
                <th>Качество <span class="gf-col-hint">${UI_COPY.common.inDevelopmentShort}</span></th>
              </tr>
            </thead>
            <tbody id="app-files-body">
              <tr>
                <td colspan="9">
                  <div class="gf-empty-inline">
                    <p class="gf-empty-inline__title">Файлов пока нет</p>
                    <p class="gf-empty-inline__hint">Загрузите .txt/.vtt, чтобы получить отчёт</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <button id="app-load-more-button" class="${buttonClassName({ variant: "ghost" })}" type="button" hidden>Показать еще</button>
        </p>
      `)}

      <div
        id="app-file-overlay"
        class="gf-overlay"
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-file-overlay-title"
      >
        <div class="gf-overlay__panel gf-file-overlay">
          <header class="gf-file-overlay__header">
            <div>
              <p class="gf-file-overlay__eyebrow">Детали файла</p>
              <h2 id="app-file-overlay-title" class="gf-file-overlay__title">—</h2>
            </div>
            <div class="gf-toolbar">
              ${renderBadge("Загрузка…", "info", { attributes: 'id="app-file-overlay-badge"' })}
              <button
                id="app-file-overlay-close"
                class="${buttonClassName({ variant: "secondary", size: "sm" })} gf-file-overlay__close-icon"
                type="button"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
          </header>

          <div class="gf-file-overlay__body">
            <section class="gf-file-overlay__section">
              <h3 class="gf-file-overlay__section-title">Метаданные</h3>
              <dl class="gf-file-overlay__meta-list">
                <div class="gf-file-overlay__meta-row">
                  <dt>Загружен</dt>
                  <dd id="app-file-overlay-meta-uploaded">—</dd>
                </div>
                <div class="gf-file-overlay__meta-row">
                  <dt>Размер</dt>
                  <dd id="app-file-overlay-meta-size">—</dd>
                </div>
                <div class="gf-file-overlay__meta-row">
                  <dt>Формат</dt>
                  <dd id="app-file-overlay-meta-format">—</dd>
                </div>
              </dl>
            </section>

            <section class="gf-file-overlay__section">
              <h3 class="gf-file-overlay__section-title">Статус</h3>
              <p id="app-file-overlay-status" class="gf-alert gf-alert--info" aria-live="polite"></p>
              <p id="app-file-overlay-status-hint" class="gf-file-overlay__hint"></p>
              <div id="app-file-overlay-content" class="gf-pre gf-pre--compact"></div>
            </section>

            <section id="app-file-overlay-error-section" class="gf-file-overlay__section" hidden>
              <h3 class="gf-file-overlay__section-title">Ошибка</h3>
              <p class="gf-file-overlay__error-line">
                <span class="gf-file-overlay__error-label">Код ошибки:</span>
                <span id="app-file-overlay-error-code">—</span>
              </p>
              <p class="gf-file-overlay__error-line">
                <span class="gf-file-overlay__error-label">Сообщение:</span>
                <span id="app-file-overlay-error-message">—</span>
              </p>
            </section>
          </div>

          <footer class="gf-file-overlay__footer">
            <p id="app-file-overlay-footer" class="gf-file-overlay__footer-note">Нажмите Esc, чтобы закрыть окно.</p>
            <button
              id="app-file-overlay-close-footer"
              class="${buttonClassName({ variant: "secondary", size: "sm" })}"
              type="button"
            >
              Закрыть
            </button>
          </footer>
        </div>
      </div>

      <script>
        (() => {
          const LIST_FIRST_PAGE_URL = "/api/files?limit=20";
          const POLL_INTERVAL_MS = 7000;
          const OVERLAY_POLL_INTERVAL_MS = 5000;
          const TABLE_COLUMN_COUNT = 9;
          const statusNode = document.getElementById("app-files-status");
          const retryButton = document.getElementById("app-retry-button");
          const uploadForm = document.getElementById("app-upload-form");
          const uploadInput = document.getElementById("app-upload-input");
          const uploadButton = document.getElementById("app-upload-button");
          const refreshButton = document.getElementById("app-refresh-button");
          const loadMoreButton = document.getElementById("app-load-more-button");
          const searchInput = document.getElementById("app-search-input");
          const statusFilter = document.getElementById("app-status-filter");
          const sortSelect = document.getElementById("app-sort-select");
          const filesBody = document.getElementById("app-files-body");
          const statTotal = document.getElementById("app-stat-total");
          const statQueued = document.getElementById("app-stat-queued");
          const statProcessing = document.getElementById("app-stat-processing");
          const statReady = document.getElementById("app-stat-ready");
          const statFailed = document.getElementById("app-stat-failed");
          const overlay = document.getElementById("app-file-overlay");
          const overlayClose = document.getElementById("app-file-overlay-close");
          const overlayCloseFooter = document.getElementById("app-file-overlay-close-footer");
          const overlayTitle = document.getElementById("app-file-overlay-title");
          const overlayBadge = document.getElementById("app-file-overlay-badge");
          const overlayMetaUploaded = document.getElementById("app-file-overlay-meta-uploaded");
          const overlayMetaSize = document.getElementById("app-file-overlay-meta-size");
          const overlayMetaFormat = document.getElementById("app-file-overlay-meta-format");
          const overlayStatus = document.getElementById("app-file-overlay-status");
          const overlayStatusHint = document.getElementById("app-file-overlay-status-hint");
          const overlayContent = document.getElementById("app-file-overlay-content");
          const overlayErrorSection = document.getElementById("app-file-overlay-error-section");
          const overlayErrorCode = document.getElementById("app-file-overlay-error-code");
          const overlayErrorMessage = document.getElementById("app-file-overlay-error-message");
          const overlayFooter = document.getElementById("app-file-overlay-footer");

          if (
            !(statusNode instanceof HTMLElement) ||
            !(retryButton instanceof HTMLButtonElement) ||
            !(uploadForm instanceof HTMLFormElement) ||
            !(uploadInput instanceof HTMLInputElement) ||
            !(uploadButton instanceof HTMLButtonElement) ||
            !(refreshButton instanceof HTMLButtonElement) ||
            !(loadMoreButton instanceof HTMLButtonElement) ||
            !(searchInput instanceof HTMLElement) ||
            !(statusFilter instanceof HTMLElement) ||
            !(sortSelect instanceof HTMLElement) ||
            !(filesBody instanceof HTMLTableSectionElement) ||
            !(statTotal instanceof HTMLElement) ||
            !(statQueued instanceof HTMLElement) ||
            !(statProcessing instanceof HTMLElement) ||
            !(statReady instanceof HTMLElement) ||
            !(statFailed instanceof HTMLElement) ||
            !(overlay instanceof HTMLElement) ||
            !(overlayClose instanceof HTMLButtonElement) ||
            !(overlayCloseFooter instanceof HTMLButtonElement) ||
            !(overlayTitle instanceof HTMLElement) ||
            !(overlayBadge instanceof HTMLElement) ||
            !(overlayMetaUploaded instanceof HTMLElement) ||
            !(overlayMetaSize instanceof HTMLElement) ||
            !(overlayMetaFormat instanceof HTMLElement) ||
            !(overlayStatus instanceof HTMLElement) ||
            !(overlayStatusHint instanceof HTMLElement) ||
            !(overlayContent instanceof HTMLElement) ||
            !(overlayErrorSection instanceof HTMLElement) ||
            !(overlayErrorCode instanceof HTMLElement) ||
            !(overlayErrorMessage instanceof HTMLElement) ||
            !(overlayFooter instanceof HTMLElement)
          ) {
            return;
          }

          let nextCursor = null;
          let allItems = [];
          let isUploading = false;
          let isLoadingFirstPage = false;
          let isLoadingMore = false;
          let overlayPollTimer = null;
          let overlayRequestToken = 0;
          let overlayActiveFileId = null;
          let selectedRowFileId = null;

          function setStatus(message, tone) {
            statusNode.textContent = message;
            statusNode.className = "gf-alert gf-alert--" + (tone || "info");
          }

          function clearStatus() {
            setStatus("", "info");
          }

          function showRetryButton(visible) {
            retryButton.hidden = !visible;
            retryButton.disabled = !visible || isLoadingFirstPage || isLoadingMore || isUploading;
          }

          function getExtension(filename) {
            if (typeof filename !== "string") {
              return "";
            }
            const normalized = filename.trim().toLowerCase();
            const dotIndex = normalized.lastIndexOf(".");
            if (dotIndex < 0 || dotIndex === normalized.length - 1) {
              return "";
            }
            return normalized.slice(dotIndex + 1);
          }

          function isSupportedFileName(filename) {
            const extension = getExtension(filename);
            return extension === "txt" || extension === "vtt";
          }

          function formatDate(value) {
            if (typeof value !== "string") {
              return "—";
            }
            const parsed = new Date(value);
            if (Number.isNaN(parsed.getTime())) {
              return value;
            }
            return parsed.toLocaleString("ru-RU");
          }

          function formatSize(value) {
            if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
              return "—";
            }
            if (value < 1024) {
              return value + " Б";
            }
            if (value < 1024 * 1024) {
              return (value / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " КБ";
            }
            return (value / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " МБ";
          }

          const fileStatusUiMap = ${JSON.stringify({
            queued: toFileStatusCopy("queued"),
            uploaded: toFileStatusCopy("uploaded"),
            processing: toFileStatusCopy("processing"),
            succeeded: toFileStatusCopy("succeeded"),
            failed: toFileStatusCopy("failed"),
          })};
          const reportUiCopy = ${JSON.stringify(REPORT_UI_COPY)};
          const reportBadgeToneMap = {
            high: "success",
            medium: "warning",
            low: "danger",
            present: "success",
            missing: "danger",
            not_discussed: "warning",
            uncertain: "info",
          };

          function formatFileStatus(status) {
            const resolved = fileStatusUiMap[String(status || "")];
            if (resolved) return resolved;
            if (typeof status === "string" && status.trim() !== "") {
              return { label: status, tone: "info" };
            }
            return { label: "—", tone: "info" };
          }

          function getSelectedStatusFilter() {
            const value = String(statusFilter.value || "all");
            if (
              value === "queued" ||
              value === "uploaded" ||
              value === "processing" ||
              value === "succeeded" ||
              value === "failed"
            ) {
              return value;
            }
            return "all";
          }

          function getSelectedSortMode() {
            const value = String(sortSelect.value || "created_desc");
            if (value === "created_asc" || value === "name_asc" || value === "status") {
              return value;
            }
            return "created_desc";
          }

          function getCreatedAtTimestamp(item) {
            if (!item || typeof item.created_at !== "string") {
              return 0;
            }
            const parsed = new Date(item.created_at);
            const timestamp = parsed.getTime();
            return Number.isNaN(timestamp) ? 0 : timestamp;
          }

          function normalizeFilename(item) {
            if (!item || typeof item.original_filename !== "string") {
              return "";
            }
            return item.original_filename.toLowerCase();
          }

          function applyLocalControls(items) {
            const searchQuery = String(searchInput.value || "").trim().toLowerCase();
            const statusValue = getSelectedStatusFilter();
            const sortMode = getSelectedSortMode();

            let result = [...items];
            if (searchQuery !== "") {
              result = result.filter((item) => normalizeFilename(item).includes(searchQuery));
            }
            if (statusValue !== "all") {
              result = result.filter((item) => item && typeof item.status === "string" && item.status === statusValue);
            }

            result.sort((left, right) => {
              if (sortMode === "created_asc") {
                return getCreatedAtTimestamp(left) - getCreatedAtTimestamp(right);
              }
              if (sortMode === "name_asc") {
                return normalizeFilename(left).localeCompare(normalizeFilename(right), "ru");
              }
              if (sortMode === "status") {
                const leftStatus = left && typeof left.status === "string" ? left.status : "";
                const rightStatus = right && typeof right.status === "string" ? right.status : "";
                const statusCompare = leftStatus.localeCompare(rightStatus, "ru");
                if (statusCompare !== 0) {
                  return statusCompare;
                }
                return normalizeFilename(left).localeCompare(normalizeFilename(right), "ru");
              }
              return getCreatedAtTimestamp(right) - getCreatedAtTimestamp(left);
            });

            return result;
          }

          function clearRows() {
            filesBody.replaceChildren();
          }

          function appendLoadingRows() {
            clearRows();
            for (let index = 0; index < 4; index += 1) {
              const row = document.createElement("tr");
              for (let cellIndex = 0; cellIndex < TABLE_COLUMN_COUNT; cellIndex += 1) {
                const cell = document.createElement("td");
                const skeleton = document.createElement("span");
                skeleton.className = "gf-skeleton";
                skeleton.textContent = " ";
                cell.appendChild(skeleton);
                row.appendChild(cell);
              }
              filesBody.appendChild(row);
            }
          }

          function appendEmptyRow(title, hint) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            const wrapper = document.createElement("div");
            const titleNode = document.createElement("p");
            const hintNode = document.createElement("p");
            cell.colSpan = TABLE_COLUMN_COUNT;
            wrapper.className = "gf-empty-inline";
            titleNode.className = "gf-empty-inline__title";
            hintNode.className = "gf-empty-inline__hint";
            titleNode.textContent = title;
            hintNode.textContent = hint;
            wrapper.appendChild(titleNode);
            wrapper.appendChild(hintNode);
            cell.appendChild(wrapper);
            row.appendChild(cell);
            filesBody.appendChild(row);
          }

          function appendSoonPlaceholder(cell) {
            const valueNode = document.createElement("div");
            const hintNode = document.createElement("div");
            valueNode.textContent = "—";
            hintNode.className = "gf-cell-muted";
            hintNode.textContent = "${UI_COPY.common.inDevelopmentShort}";
            cell.appendChild(valueNode);
            cell.appendChild(hintNode);
          }

          function syncSelectedRowState() {
            for (const row of filesBody.children) {
              const fileId = row && typeof row.__fileId === "string" ? row.__fileId : "";
              row.className =
                fileId !== "" && selectedRowFileId === fileId
                  ? "gf-table-row--clickable gf-table-row--selected"
                  : "gf-table-row--clickable";
            }
          }

          function openOverlay() {
            overlay.hidden = false;
          }

          function stopOverlayPolling() {
            if (overlayPollTimer === null) {
              return;
            }
            window.clearTimeout(overlayPollTimer);
            overlayPollTimer = null;
          }

          function scheduleOverlayPolling(fileId) {
            stopOverlayPolling();
            overlayPollTimer = window.setTimeout(() => {
              overlayPollTimer = null;
              if (overlay.hidden || overlayActiveFileId !== fileId) {
                return;
              }
              void openFileDetails(fileId, { isPolling: true });
            }, OVERLAY_POLL_INTERVAL_MS);
          }

          function closeOverlay() {
            stopOverlayPolling();
            overlayRequestToken += 1;
            overlayActiveFileId = null;
            selectedRowFileId = null;
            syncSelectedRowState();
            overlay.hidden = true;
            resetOverlayView();
          }

          function updateLoadMoreButton() {
            loadMoreButton.hidden = nextCursor === null;
            loadMoreButton.disabled = isLoadingFirstPage || isLoadingMore || isUploading || nextCursor === null;
            refreshButton.disabled = isLoadingFirstPage || isLoadingMore || isUploading;
            showRetryButton(!retryButton.hidden);
          }

          function updateStats(items) {
            let queued = 0;
            let processing = 0;
            let ready = 0;
            let failed = 0;
            for (const item of items) {
              const status = item && typeof item.status === "string" ? item.status : "";
              if (status === "queued" || status === "uploaded") {
                queued += 1;
              } else if (status === "processing") {
                processing += 1;
              } else if (status === "succeeded") {
                ready += 1;
              } else if (status === "failed") {
                failed += 1;
              }
            }
            statTotal.textContent = String(items.length);
            statQueued.textContent = String(queued);
            statProcessing.textContent = String(processing);
            statReady.textContent = String(ready);
            statFailed.textContent = String(failed);
          }

          function sanitizeReportPayload(value) {
            if (Array.isArray(value)) {
              return value.map((item) => sanitizeReportPayload(item));
            }
            if (!value || typeof value !== "object") {
              return value;
            }

            const source = value;
            const sanitized = {};
            for (const key of Object.keys(source)) {
              if (key === "raw_llm_output") {
                continue;
              }
              sanitized[key] = sanitizeReportPayload(source[key]);
            }
            return sanitized;
          }

          function normalizeReportKey(key) {
            if (typeof key !== "string") {
              return "";
            }
            return key.trim();
          }

          function humanizeReportKey(key) {
            const normalized = normalizeReportKey(key);
            if (normalized === "") {
              return reportUiCopy.unknownField;
            }
            const spaced = normalized
              .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
              .replace(/[_-]+/g, " ")
              .trim();
            if (spaced === "") {
              return reportUiCopy.unknownField;
            }
            return spaced.charAt(0).toUpperCase() + spaced.slice(1);
          }

          function formatReportKey(key, options) {
            const normalized = normalizeReportKey(key);
            const isSection = Boolean(options && options.section);
            const dictionary = isSection ? reportUiCopy.sectionLabels : reportUiCopy.fieldLabels;
            if (normalized !== "" && dictionary && typeof dictionary[normalized] === "string") {
              const value = dictionary[normalized].trim();
              if (value !== "") {
                return value;
              }
            }
            return humanizeReportKey(normalized);
          }

          function formatReportEnumValue(value) {
            if (typeof value !== "string") {
              return null;
            }
            const normalized = value.trim().toLowerCase();
            if (normalized === "") {
              return null;
            }
            if (reportUiCopy.enumLabels && typeof reportUiCopy.enumLabels[normalized] === "string") {
              const label = reportUiCopy.enumLabels[normalized].trim();
              if (label !== "") {
                return label;
              }
            }
            return null;
          }

          function formatReportScalar(value) {
            if (value === null || value === undefined) {
              return "—";
            }
            if (typeof value === "boolean") {
              return value ? "Да" : "Нет";
            }
            if (typeof value === "number") {
              if (!Number.isFinite(value)) {
                return "—";
              }
              return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
            }
            if (typeof value === "string") {
              const normalized = value.trim();
              if (normalized === "") {
                return "—";
              }
              return formatReportEnumValue(normalized) || normalized;
            }
            return String(value);
          }

          function isReportScalar(value) {
            return (
              value === null ||
              value === undefined ||
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            );
          }

          function isReportObject(value) {
            return Boolean(value) && typeof value === "object" && !Array.isArray(value);
          }

          function createReportBadge(label, tone) {
            const badgeNode = document.createElement("span");
            badgeNode.className = "gf-badge gf-badge--" + (tone || "info");
            badgeNode.textContent = label;
            return badgeNode;
          }

          function resolveReportBadge(fieldKey, value) {
            if (typeof value !== "string") {
              return null;
            }
            const normalizedKey = normalizeReportKey(fieldKey).toLowerCase();
            const normalizedValue = value.trim().toLowerCase();
            if (normalizedValue === "") {
              return null;
            }

            if (
              normalizedKey === "status" ||
              normalizedKey === "confidence" ||
              Object.prototype.hasOwnProperty.call(reportBadgeToneMap, normalizedValue)
            ) {
              return {
                label: formatReportEnumValue(normalizedValue) || formatReportScalar(value),
                tone: reportBadgeToneMap[normalizedValue] || "info",
              };
            }

            return null;
          }

          function createReportTextNode(value) {
            const textNode = document.createElement("p");
            textNode.className = "gf-report-text";
            textNode.textContent = formatReportScalar(value);
            return textNode;
          }

          function createReportScalarNode(fieldKey, value) {
            const wrapperNode = document.createElement("div");
            wrapperNode.className = "gf-report-scalar";
            const badge = resolveReportBadge(fieldKey, value);
            if (badge) {
              wrapperNode.appendChild(createReportBadge(badge.label, badge.tone));
              return wrapperNode;
            }
            wrapperNode.appendChild(createReportTextNode(value));
            return wrapperNode;
          }

          function createReportKeyValueRow(key, value) {
            const rowNode = document.createElement("div");
            rowNode.className = "gf-report-kv-row";
            const keyNode = document.createElement("p");
            keyNode.className = "gf-report-kv-key";
            keyNode.textContent = formatReportKey(key);
            const valueNode = document.createElement("div");
            valueNode.className = "gf-report-kv-value";
            valueNode.appendChild(createReportScalarNode(key, value));
            rowNode.appendChild(keyNode);
            rowNode.appendChild(valueNode);
            return rowNode;
          }

          function createReportAnchorId(key, index) {
            const raw = normalizeReportKey(key).toLowerCase();
            const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            if (slug !== "") {
              return "gf-report-section-" + slug;
            }
            return "gf-report-section-" + String(index + 1);
          }

          function formatReportCollectionMeta(value) {
            if (Array.isArray(value)) {
              return String(value.length) + " " + reportUiCopy.itemCountSuffix;
            }
            if (isReportObject(value)) {
              return String(Object.keys(value).length) + " " + reportUiCopy.sectionCountSuffix;
            }
            return "";
          }

          function formatReportSectionMeta(key, value) {
            const normalized = normalizeReportKey(key);
            if (normalized === "meta" && isReportObject(value) && typeof value.schema_version === "string") {
              const schemaVersion = value.schema_version.trim();
              if (schemaVersion !== "") {
                return reportUiCopy.schemaPrefix + " " + schemaVersion;
              }
            }
            if (normalized === "passport" && isReportObject(value) && isReportObject(value.stage)) {
              const stageValue = typeof value.stage.value === "string" ? formatReportScalar(value.stage.value) : "";
              const stageMode = typeof value.stage.mode === "string" ? formatReportScalar(value.stage.mode) : "";
              if (stageValue !== "" && stageMode !== "") {
                return stageValue + " • " + stageMode;
              }
              if (stageValue !== "") {
                return stageValue;
              }
            }
            if (normalized === "pilot_poc" && isReportObject(value) && isReportObject(value.status)) {
              const statusValue = typeof value.status.value === "string" ? formatReportScalar(value.status.value) : "";
              if (statusValue !== "") {
                return statusValue;
              }
            }
            return formatReportCollectionMeta(value);
          }

          function createReportToolbarButton(label, onClick) {
            const buttonNode = document.createElement("button");
            buttonNode.type = "button";
            buttonNode.className = "gf-report-toolbar__button";
            buttonNode.textContent = label;
            buttonNode.addEventListener("click", onClick);
            return buttonNode;
          }

          function createReportToolbarNode(disclosureRegistry) {
            const toolbarNode = document.createElement("div");
            toolbarNode.className = "gf-report-toolbar";

            const setAllDisclosures = (open) => {
              for (const disclosureNode of disclosureRegistry) {
                disclosureNode.open = open;
              }
            };

            toolbarNode.appendChild(createReportToolbarButton(reportUiCopy.expandAll, () => setAllDisclosures(true)));
            toolbarNode.appendChild(createReportToolbarButton(reportUiCopy.collapseAll, () => setAllDisclosures(false)));
            toolbarNode.appendChild(
              createReportToolbarButton(reportUiCopy.print, () => {
                if (typeof window.print === "function") {
                  window.print();
                }
              }),
            );
            return toolbarNode;
          }

          function createReportTocNode(sectionDescriptors) {
            const tocNode = document.createElement("nav");
            tocNode.className = "gf-report-pills";
            for (const descriptor of sectionDescriptors) {
              const linkNode = document.createElement("a");
              linkNode.className = "gf-report-pill gf-report-pill--link";
              linkNode.href = "#" + descriptor.anchorId;
              linkNode.textContent = descriptor.label;
              linkNode.addEventListener("click", (event) => {
                event.preventDefault();
                const sectionNode = document.getElementById(descriptor.anchorId);
                if (sectionNode && typeof sectionNode.scrollIntoView === "function") {
                  sectionNode.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              });
              tocNode.appendChild(linkNode);
            }
            return tocNode;
          }

          function createReportDisclosure(title, contentNode, options) {
            const detailsNode = document.createElement("details");
            detailsNode.className = "gf-report-disclosure";
            if (Boolean(options && options.open)) {
              detailsNode.open = true;
            }
            if (options && Array.isArray(options.registry)) {
              options.registry.push(detailsNode);
            }

            const summaryNode = document.createElement("summary");
            summaryNode.className = "gf-report-disclosure__summary";

            const summaryLeadNode = document.createElement("span");
            summaryLeadNode.className = "gf-report-disclosure__lead";

            const chevronNode = document.createElement("span");
            chevronNode.className = "gf-report-disclosure__chev";
            summaryLeadNode.appendChild(chevronNode);

            const titleNode = document.createElement("span");
            titleNode.className = "gf-report-disclosure__title";
            titleNode.textContent = title;
            summaryLeadNode.appendChild(titleNode);

            summaryNode.appendChild(summaryLeadNode);

            const metaText = options && typeof options.meta === "string" ? options.meta.trim() : "";
            if (metaText !== "") {
              const metaNode = document.createElement("span");
              metaNode.className = "gf-report-disclosure__meta";
              metaNode.textContent = reportUiCopy.detailsCountPrefix + ": " + metaText;
              summaryNode.appendChild(metaNode);
            }

            const bodyNode = document.createElement("div");
            bodyNode.className = "gf-report-disclosure__content";
            bodyNode.appendChild(contentNode);

            detailsNode.appendChild(summaryNode);
            detailsNode.appendChild(bodyNode);
            return detailsNode;
          }

          function createReportArrayNode(key, values, depth, context) {
            if (values.length === 0) {
              return createReportTextNode("—");
            }

            const allScalars = values.every((item) => isReportScalar(item));
            if (allScalars) {
              const chipsNode = document.createElement("div");
              chipsNode.className = "gf-report-chips";
              for (const item of values) {
                const chipNode = document.createElement("span");
                chipNode.className = "gf-report-chip";
                chipNode.textContent = formatReportScalar(item);
                chipsNode.appendChild(chipNode);
              }
              return chipsNode;
            }

            const stackNode = document.createElement("div");
            stackNode.className = "gf-report-stack";
            for (let index = 0; index < values.length; index += 1) {
              const item = values[index];
              const label = reportUiCopy.untitledItem + " " + String(index + 1);
              const itemContent = createReportValueNode(key, item, depth + 1, context);
              const itemMeta = Array.isArray(item) ? String(item.length) : "";
              const itemNode = createReportDisclosure(label, itemContent, {
                open: index === 0 && depth <= 1,
                meta: itemMeta,
                registry: context ? context.disclosureRegistry : null,
              });
              stackNode.appendChild(itemNode);
            }
            return stackNode;
          }

          function createReportObjectNode(value, depth, context) {
            const entries = Object.entries(value);
            if (entries.length === 0) {
              return createReportTextNode("—");
            }

            const containerNode = document.createElement("div");
            containerNode.className = "gf-report-stack";
            const scalarEntries = [];
            const nestedEntries = [];

            for (const [key, itemValue] of entries) {
              if (isReportScalar(itemValue)) {
                scalarEntries.push([key, itemValue]);
              } else {
                nestedEntries.push([key, itemValue]);
              }
            }

            if (scalarEntries.length > 0) {
              const kvNode = document.createElement("div");
              kvNode.className = "gf-report-kv";
              for (const [key, itemValue] of scalarEntries) {
                kvNode.appendChild(createReportKeyValueRow(key, itemValue));
              }
              containerNode.appendChild(kvNode);
            }

            for (const [key, itemValue] of nestedEntries) {
              const label = formatReportKey(key);
              const bodyNode = createReportValueNode(key, itemValue, depth + 1, context);
              if (depth === 0) {
                const subsectionNode = document.createElement("section");
                subsectionNode.className = "gf-report-subsection";
                const titleNode = document.createElement("h5");
                titleNode.className = "gf-report-subsection__title";
                titleNode.textContent = label;
                subsectionNode.appendChild(titleNode);
                subsectionNode.appendChild(bodyNode);
                containerNode.appendChild(subsectionNode);
                continue;
              }

              const meta =
                Array.isArray(itemValue) ? String(itemValue.length) : isReportObject(itemValue) ? String(Object.keys(itemValue).length) : "";
              containerNode.appendChild(
                createReportDisclosure(label, bodyNode, {
                  open: depth <= 1,
                  meta,
                  registry: context ? context.disclosureRegistry : null,
                }),
              );
            }

            return containerNode;
          }

          function createReportValueNode(key, value, depth, context) {
            if (Array.isArray(value)) {
              return createReportArrayNode(key, value, depth, context);
            }
            if (isReportObject(value)) {
              return createReportObjectNode(value, depth, context);
            }
            return createReportScalarNode(key, value);
          }

          function createReportHeaderNode(payload, sectionDescriptors, disclosureRegistry) {
            const headerNode = document.createElement("section");
            headerNode.className = "gf-report-summary";

            const topNode = document.createElement("div");
            topNode.className = "gf-report-summary__top";

            const headingNode = document.createElement("div");
            headingNode.className = "gf-report-summary__heading";

            const titleNode = document.createElement("h4");
            titleNode.className = "gf-report-summary__title";
            titleNode.textContent = reportUiCopy.title;
            headingNode.appendChild(titleNode);

            const infoParts = [];
            const schemaVersion =
              payload &&
              payload.meta &&
              typeof payload.meta === "object" &&
              typeof payload.meta.schema_version === "string" &&
              payload.meta.schema_version.trim() !== ""
                ? payload.meta.schema_version.trim()
                : "";
            if (schemaVersion !== "") {
              infoParts.push(reportUiCopy.schemaPrefix + ": " + schemaVersion);
            }

            const primaryType =
              payload &&
              payload.meta &&
              payload.meta.meeting_type &&
              typeof payload.meta.meeting_type === "object" &&
              payload.meta.meeting_type.primary &&
              typeof payload.meta.meeting_type.primary === "object"
                ? payload.meta.meeting_type.primary
                : null;
            if (primaryType) {
              const label =
                typeof primaryType.label === "string" ? formatReportScalar(primaryType.label) : "";
              const confidence =
                typeof primaryType.confidence === "string" ? formatReportScalar(primaryType.confidence) : "";
              if (label !== "") {
                infoParts.push(reportUiCopy.typePrefix + ": " + label + (confidence !== "" ? " (" + confidence + ")" : ""));
              }
            }

            const source =
              payload && payload.meta && payload.meta.source && typeof payload.meta.source === "object"
                ? payload.meta.source
                : null;
            if (source) {
              const formatText = typeof source.transcript_format === "string" ? formatReportScalar(source.transcript_format) : "";
              const languageText = typeof source.language === "string" ? formatReportScalar(source.language) : "";
              const sourceParts = [];
              if (formatText !== "") {
                sourceParts.push(formatText);
              }
              if (languageText !== "") {
                sourceParts.push(languageText);
              }
              if (sourceParts.length > 0) {
                infoParts.push(reportUiCopy.sourcePrefix + ": " + sourceParts.join(" / "));
              }
            }

            const subtitleNode = document.createElement("p");
            subtitleNode.className = "gf-report-summary__subtitle";
            subtitleNode.textContent = infoParts.length > 0 ? infoParts.join(" • ") : reportUiCopy.summaryFallback;
            headingNode.appendChild(subtitleNode);
            topNode.appendChild(headingNode);
            topNode.appendChild(createReportToolbarNode(disclosureRegistry));
            headerNode.appendChild(topNode);

            if (sectionDescriptors.length > 0) {
              headerNode.appendChild(createReportTocNode(sectionDescriptors));
            }

            return headerNode;
          }

          function createReportSectionNode(key, value, options, context) {
            const sectionNode = document.createElement("section");
            sectionNode.className = "gf-report-card";
            if (options && typeof options.anchorId === "string" && options.anchorId.trim() !== "") {
              sectionNode.id = options.anchorId;
            }

            const headNode = document.createElement("div");
            headNode.className = "gf-report-card__head";
            const titleNode = document.createElement("h5");
            titleNode.className = "gf-report-card__title";
            titleNode.textContent = formatReportKey(key, { section: Boolean(options && options.section) });
            headNode.appendChild(titleNode);

            const metaNode = document.createElement("p");
            metaNode.className = "gf-report-card__meta";
            metaNode.textContent = formatReportSectionMeta(key, value);
            if (metaNode.textContent !== "") {
              headNode.appendChild(metaNode);
            }

            const bodyNode = document.createElement("div");
            bodyNode.className = "gf-report-card__body";
            bodyNode.appendChild(createReportValueNode(key, value, 0, context));

            sectionNode.appendChild(headNode);
            sectionNode.appendChild(bodyNode);
            return sectionNode;
          }

          function createReportNode(value) {
            const documentNode = document.createElement("div");
            documentNode.className = "gf-report-doc";
            const context = { disclosureRegistry: [] };

            if (!isReportObject(value)) {
              if (Array.isArray(value)) {
                documentNode.appendChild(
                  createReportSectionNode(reportUiCopy.untitledSection, value, { section: false }, context),
                );
                return documentNode;
              }
              if (isReportScalar(value)) {
                documentNode.appendChild(createReportScalarNode("", value));
                return documentNode;
              }
              documentNode.appendChild(createReportTextNode(reportUiCopy.noData));
              return documentNode;
            }

            const sectionDescriptors = [];
            const renderedKeys = new Set();
            let sectionIndex = 0;

            for (const key of reportUiCopy.sectionOrder || []) {
              if (!Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
              }
              renderedKeys.add(key);
              sectionDescriptors.push({
                key,
                section: true,
                label: formatReportKey(key, { section: true }),
                anchorId: createReportAnchorId(key, sectionIndex),
              });
              sectionIndex += 1;
            }

            for (const [key] of Object.entries(value)) {
              if (renderedKeys.has(key)) {
                continue;
              }
              sectionDescriptors.push({
                key,
                section: false,
                label: formatReportKey(key, { section: false }),
                anchorId: createReportAnchorId(key, sectionIndex),
              });
              sectionIndex += 1;
            }

            documentNode.appendChild(createReportHeaderNode(value, sectionDescriptors, context.disclosureRegistry));
            for (const descriptor of sectionDescriptors) {
              documentNode.appendChild(
                createReportSectionNode(
                  descriptor.key,
                  value[descriptor.key],
                  { section: descriptor.section, anchorId: descriptor.anchorId },
                  context,
                ),
              );
            }

            return documentNode;
          }

          function collectReportSearchText(value) {
            if (Array.isArray(value)) {
              return value.map((item) => collectReportSearchText(item)).join(" ");
            }
            if (value && typeof value === "object") {
              const parts = [];
              for (const [key, itemValue] of Object.entries(value)) {
                parts.push(String(key));
                parts.push(collectReportSearchText(itemValue));
              }
              return parts.join(" ");
            }
            return formatReportScalar(value);
          }

          function formatProcessingDetails(payload) {
            const details = [];
            const attempts = payload && typeof payload.attempts === "number"
              ? payload.attempts
              : payload && typeof payload.processing_attempts === "number"
                ? payload.processing_attempts
                : null;
            const maxAttempts = payload && typeof payload.max_attempts === "number" ? payload.max_attempts : null;
            if (attempts !== null) {
              details.push(
                "Попытка: " + String(attempts) + (maxAttempts !== null ? "/" + String(maxAttempts) : ""),
              );
            }
            if (payload && typeof payload.next_run_at === "string" && payload.next_run_at.trim() !== "") {
              details.push("Следующий запуск: " + payload.next_run_at);
            }
            if (payload && typeof payload.last_error_code === "string" && payload.last_error_code.trim() !== "") {
              details.push("Код последней ошибки: " + payload.last_error_code);
            }
            if (payload && typeof payload.last_error_message === "string" && payload.last_error_message.trim() !== "") {
              details.push("Последняя ошибка: " + payload.last_error_message);
            }
            return details.join("\\n");
          }

          function formatFileFormat(payload) {
            if (payload && typeof payload.extension === "string" && payload.extension.trim() !== "") {
              return payload.extension.toUpperCase();
            }
            if (payload && typeof payload.original_filename === "string") {
              const extracted = getExtension(payload.original_filename);
              if (extracted) {
                return extracted.toUpperCase();
              }
            }
            return "—";
          }

          function buildStandaloneReportUrl(fileId) {
            return "/files/" + encodeURIComponent(fileId) + "/report";
          }

          function openStandaloneReport(fileId) {
            const reportUrl = buildStandaloneReportUrl(fileId);
            if (window && window.location && typeof window.location.assign === "function") {
              window.location.assign(reportUrl);
              return true;
            }
            if (window && window.location && typeof window.location === "object") {
              window.location.href = reportUrl;
              return true;
            }
            return false;
          }

          function setOverlayBadge(label, tone) {
            overlayBadge.className = "gf-badge gf-badge--" + (tone || "info");
            overlayBadge.textContent = label;
          }

          function setOverlayStatusState(tone, message, hint) {
            overlayStatus.className = "gf-alert gf-alert--" + (tone || "info");
            overlayStatus.textContent = message;
            overlayStatusHint.textContent = hint || "";
          }

          function setOverlayContentText(text, options) {
            const placeholder = Boolean(options && options.placeholder);
            overlayContent.className = placeholder ? "gf-pre gf-pre--compact gf-pre--placeholder" : "gf-pre gf-pre--compact";
            overlayContent.replaceChildren();
            overlayContent.textContent = text;
            overlayContent.__reportText = text;
          }

          function setOverlayReportContent(payload) {
            const sanitized = sanitizeReportPayload(payload);
            overlayContent.className = "gf-report-view";
            overlayContent.textContent = "";
            overlayContent.replaceChildren();
            overlayContent.appendChild(createReportNode(sanitized));
            overlayContent.__reportText = collectReportSearchText(sanitized);
          }

          function setOverlayErrorSection(payload) {
            const errorCode =
              payload && typeof payload.error_code === "string" && payload.error_code.trim() !== ""
                ? payload.error_code
                : "";
            const errorMessage =
              payload && typeof payload.error_message === "string" && payload.error_message.trim() !== ""
                ? payload.error_message
                : "";
            overlayErrorSection.hidden = errorCode === "" && errorMessage === "";
            overlayErrorCode.textContent = errorCode || "—";
            overlayErrorMessage.textContent = errorMessage || "—";
          }

          function setOverlayMetadata(payload) {
            overlayTitle.textContent =
              payload && typeof payload.original_filename === "string" && payload.original_filename.trim() !== ""
                ? payload.original_filename
                : "Без имени";
            overlayMetaUploaded.textContent = formatDate(payload ? payload.created_at : null);
            overlayMetaSize.textContent = formatSize(payload ? payload.size_bytes : null);
            overlayMetaFormat.textContent = formatFileFormat(payload);
          }

          function getKnownFileName(fileId) {
            for (const item of allItems) {
              if (!item || typeof item.id !== "string" || item.id !== fileId) {
                continue;
              }
              if (typeof item.original_filename === "string" && item.original_filename.trim() !== "") {
                return item.original_filename;
              }
            }
            return "";
          }

          function resetOverlayView() {
            overlayTitle.textContent = "—";
            overlayMetaUploaded.textContent = "—";
            overlayMetaSize.textContent = "—";
            overlayMetaFormat.textContent = "—";
            setOverlayBadge("Загрузка…", "info");
            setOverlayStatusState("info", "", "");
            setOverlayContentText("", { placeholder: false });
            overlayErrorSection.hidden = true;
            overlayErrorCode.textContent = "—";
            overlayErrorMessage.textContent = "—";
            overlayFooter.textContent = "Нажмите Esc, чтобы закрыть окно.";
          }

          function applyOverlayLoadingState(fileName) {
            overlayTitle.textContent = fileName && fileName.trim() !== "" ? fileName : "Загрузка…";
            overlayMetaUploaded.textContent = "—";
            overlayMetaSize.textContent = "—";
            overlayMetaFormat.textContent = "—";
            setOverlayBadge("Загрузка…", "info");
            setOverlayStatusState("info", "Загрузка…", "Получаем актуальные данные по файлу.");
            setOverlayContentText("Загрузка…", { placeholder: true });
            overlayErrorSection.hidden = true;
            overlayErrorCode.textContent = "—";
            overlayErrorMessage.textContent = "—";
            overlayFooter.textContent = "Можно закрыть окно и вернуться позже.";
          }

          function applyOverlayNotFoundState() {
            setOverlayBadge("Недоступно", "warning");
            setOverlayStatusState("warning", "Файл не найден", "Проверьте список файлов и попробуйте открыть детали заново.");
            setOverlayContentText("", { placeholder: false });
            overlayErrorSection.hidden = true;
            overlayFooter.textContent = "Если файл удалён или недоступен, выберите другой файл из таблицы.";
          }

          function applyOverlayUnavailableState(message) {
            setOverlayBadge("Недоступно", "warning");
            setOverlayStatusState("warning", "Недоступно", message);
            setOverlayContentText("", { placeholder: false });
            overlayErrorSection.hidden = true;
            overlayFooter.textContent = "Закройте окно и попробуйте снова позже.";
          }

          async function fetchListPage(cursor) {
            const url = cursor
              ? LIST_FIRST_PAGE_URL + "&cursor=" + encodeURIComponent(cursor)
              : LIST_FIRST_PAGE_URL;
            const response = await fetch(url, {
              headers: {
                Accept: "application/json",
              },
            });

            if (!response.ok) {
              throw new Error("list_request_failed:" + String(response.status));
            }

            const payload = await response.json();
            const items = payload && Array.isArray(payload.items) ? payload.items : [];
            const decodedNextCursor =
              payload && typeof payload.next_cursor === "string" && payload.next_cursor !== ""
                ? payload.next_cursor
                : null;
            return { items, nextCursor: decodedNextCursor };
          }

          async function openFileDetails(fileId, options) {
            const isPolling = Boolean(options && options.isPolling);
            const fileName =
              options && typeof options.fileName === "string" && options.fileName.trim() !== ""
                ? options.fileName
                : getKnownFileName(fileId);
            if (!isPolling) {
              overlayActiveFileId = fileId;
              selectedRowFileId = fileId;
              syncSelectedRowState();
              openOverlay();
              applyOverlayLoadingState(fileName);
            }

            stopOverlayPolling();
            const requestToken = ++overlayRequestToken;
            try {
              const response = await fetch("/api/files/" + encodeURIComponent(fileId), {
                headers: {
                  Accept: "application/json",
                },
              });

              if (overlayRequestToken !== requestToken || overlayActiveFileId !== fileId) {
                return;
              }

              if (response.status === 404) {
                applyOverlayNotFoundState();
                return;
              }
              if (!response.ok) {
                applyOverlayUnavailableState("Не удалось загрузить метаданные файла.");
                return;
              }

              const payload = await response.json();
              const status = payload && typeof payload.status === "string" ? payload.status : "";
              setOverlayMetadata(payload);

              if (status === "failed") {
                setOverlayBadge("Ошибка", "danger");
                setOverlayStatusState("danger", "Ошибка обработки", "Не удалось обработать файл.");
                setOverlayErrorSection(payload);
                const processingDetails = formatProcessingDetails(payload);
                setOverlayContentText(processingDetails || "Дополнительных деталей нет.", { placeholder: false });
                overlayFooter.textContent = "Исправьте исходный файл и загрузите его повторно.";
                return;
              }

              if (status !== "succeeded") {
                const processingUi = formatFileStatus(status);
                setOverlayBadge(processingUi.label, processingUi.tone);
                setOverlayStatusState("info", "Обрабатываем файл…", "Можно закрыть окно и вернуться позже.");
                overlayErrorSection.hidden = true;
                const processingDetails = formatProcessingDetails(payload);
                setOverlayContentText(processingDetails || "Ожидаем завершения обработки.", { placeholder: false });
                overlayFooter.textContent = "Состояние обновляется автоматически каждые 5 секунд.";
                scheduleOverlayPolling(fileId);
                return;
              }

              const redirected = openStandaloneReport(fileId);
              if (redirected) {
                closeOverlay();
                return;
              }
              applyOverlayUnavailableState("Не удалось открыть страницу отчёта.");
            } catch {
              if (overlayRequestToken !== requestToken || overlayActiveFileId !== fileId) {
                return;
              }
              applyOverlayUnavailableState("Не удалось загрузить метаданные файла.");
              if (!overlay.hidden) {
                scheduleOverlayPolling(fileId);
              }
            }
          }

          function makeFileRow(item) {
            const row = document.createElement("tr");
            const filenameCell = document.createElement("td");
            const statusCell = document.createElement("td");
            const createdAtCell = document.createElement("td");
            const sizeCell = document.createElement("td");
            const errorCell = document.createElement("td");
            const durationCell = document.createElement("td");
            const speakersCell = document.createElement("td");
            const languageCell = document.createElement("td");
            const qualityCell = document.createElement("td");

            const fileId = item && typeof item.id === "string" ? item.id : "";
            const status = item && typeof item.status === "string" ? item.status : "";
            const statusUi = formatFileStatus(status);
            const statusBadge = document.createElement("span");
            statusBadge.className = "gf-badge gf-badge--" + statusUi.tone;
            statusBadge.textContent = statusUi.label;

            filenameCell.textContent = item && typeof item.original_filename === "string" ? item.original_filename : "—";
            statusCell.appendChild(statusBadge);
            createdAtCell.textContent = formatDate(item ? item.created_at : null);
            sizeCell.textContent = formatSize(item ? item.size_bytes : null);
            errorCell.textContent = status === "failed" ? "Ошибка обработки" : "—";
            appendSoonPlaceholder(durationCell);
            appendSoonPlaceholder(speakersCell);
            appendSoonPlaceholder(languageCell);
            appendSoonPlaceholder(qualityCell);

            row.appendChild(filenameCell);
            row.appendChild(statusCell);
            row.appendChild(createdAtCell);
            row.appendChild(sizeCell);
            row.appendChild(errorCell);
            row.appendChild(durationCell);
            row.appendChild(speakersCell);
            row.appendChild(languageCell);
            row.appendChild(qualityCell);
            row.className = "gf-table-row--clickable";
            row.tabIndex = 0;
            row.__fileId = fileId;

            const openHandler = () => {
              if (!fileId) {
                return;
              }
              if (status === "succeeded") {
                openStandaloneReport(fileId);
                return;
              }
              const fileName = item && typeof item.original_filename === "string" ? item.original_filename : "";
              void openFileDetails(fileId, { fileName });
            };
            row.addEventListener("click", openHandler);
            row.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openHandler();
              }
            });

            return row;
          }

          function renderRows() {
            const filtered = applyLocalControls(allItems);
            clearRows();
            for (const item of filtered) {
              filesBody.appendChild(makeFileRow(item));
            }
            if (filtered.length === 0) {
              if (allItems.length === 0) {
                appendEmptyRow("Файлов пока нет", "Загрузите .txt/.vtt, чтобы получить отчёт");
              } else {
                appendEmptyRow("Ничего не найдено", "Измените параметры поиска или фильтра.");
              }
            }
            syncSelectedRowState();
          }

          async function loadFirstPage(reason) {
            if (isLoadingFirstPage || isLoadingMore || isUploading) {
              return;
            }
            isLoadingFirstPage = true;
            updateLoadMoreButton();
            showRetryButton(false);
            if (reason !== "poll") {
              setStatus("Загружаем список файлов...", "info");
              appendLoadingRows();
            }
            try {
              const result = await fetchListPage(null);
              allItems = result.items;
              nextCursor = result.nextCursor;
              renderRows();
              updateStats(allItems);
              if (allItems.length === 0) {
                setStatus("Файлов пока нет.", "info");
              } else if (reason !== "poll") {
                clearStatus();
              }
            } catch {
              if (reason !== "poll") {
                setStatus("Не удалось загрузить список файлов.", "danger");
                showRetryButton(true);
                if (allItems.length === 0) {
                  appendEmptyRow("Ошибка загрузки", "Нажмите «Повторить», чтобы обновить список.");
                }
              }
            } finally {
              isLoadingFirstPage = false;
              updateLoadMoreButton();
            }
          }

          async function loadMore() {
            if (isLoadingMore || isLoadingFirstPage || isUploading || nextCursor === null) {
              return;
            }
            const cursor = nextCursor;
            isLoadingMore = true;
            updateLoadMoreButton();
            setStatus("Загружаем следующую страницу...", "info");
            try {
              const result = await fetchListPage(cursor);
              allItems = allItems.concat(result.items);
              nextCursor = result.nextCursor;
              renderRows();
              updateStats(allItems);
              clearStatus();
            } catch {
              setStatus("Не удалось загрузить следующую страницу.", "danger");
            } finally {
              isLoadingMore = false;
              updateLoadMoreButton();
            }
          }

          function setUploadUi(uploading) {
            isUploading = uploading;
            uploadInput.disabled = uploading;
            uploadButton.disabled = uploading;
            uploadButton.textContent = uploading ? "Загрузка..." : "Загрузить";
            searchInput.disabled = uploading;
            statusFilter.disabled = uploading;
            sortSelect.disabled = uploading;
            updateLoadMoreButton();
          }

          uploadInput.addEventListener("change", () => {
            const file = uploadInput.files && uploadInput.files[0] ? uploadInput.files[0] : null;
            if (!file) {
              return;
            }
            if (!isSupportedFileName(file.name)) {
              setStatus("Выберите файл в формате .txt или .vtt.", "warning");
            } else {
              clearStatus();
            }
          });

          uploadForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const file = uploadInput.files && uploadInput.files[0] ? uploadInput.files[0] : null;
            if (!file) {
              setStatus("Выберите файл для загрузки.", "warning");
              return;
            }
            if (!isSupportedFileName(file.name)) {
              setStatus("Выберите файл в формате .txt или .vtt.", "warning");
              return;
            }

            setUploadUi(true);
            setStatus("Загружаем файл...", "info");
            const formData = new FormData();
            formData.append("file", file);
            try {
              const response = await fetch("/api/files/upload", {
                method: "POST",
                body: formData,
              });
              if (response.ok) {
                uploadInput.value = "";
                setStatus("Файл загружен. Обновляем список...", "success");
                await loadFirstPage("upload");
                return;
              }
              if (response.status === 413) {
                setStatus("Файл слишком большой.", "warning");
                return;
              }

              let errorCode = "";
              try {
                const payload = await response.json();
                if (payload && typeof payload.error === "string") {
                  errorCode = payload.error;
                }
              } catch {}

              if (errorCode === "invalid_file_type") {
                setStatus("Выберите файл в формате .txt или .vtt.", "warning");
                return;
              }
              setStatus("Не удалось загрузить файл.", "danger");
            } catch {
              setStatus("Не удалось загрузить файл.", "danger");
            } finally {
              setUploadUi(false);
            }
          });

          refreshButton.addEventListener("click", () => {
            void loadFirstPage("manual");
          });

          retryButton.addEventListener("click", () => {
            void loadFirstPage("manual");
          });

          loadMoreButton.addEventListener("click", () => {
            void loadMore();
          });

          searchInput.addEventListener("input", () => {
            renderRows();
          });
          statusFilter.addEventListener("change", () => {
            renderRows();
          });
          sortSelect.addEventListener("change", () => {
            renderRows();
          });

          overlayClose.addEventListener("click", closeOverlay);
          overlayCloseFooter.addEventListener("click", closeOverlay);
          overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
              closeOverlay();
            }
          });
          document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !overlay.hidden) {
              closeOverlay();
            }
          });

          window.setInterval(() => {
            if (document.hidden) {
              return;
            }
            void loadFirstPage("poll");
          }, POLL_INTERVAL_MS);

          resetOverlayView();
          updateStats([]);
          void loadFirstPage("initial");
        })();
      </script>
    `,
  });
}

function renderProtectedPage(
  area: "app" | "admin",
  pathname: string,
  session: AuthenticatedSession,
): string {
  return renderPageLayout({
    title: area === "admin" ? "Раздел администрирования" : "Раздел приложения",
    description: UI_COPY.common.featureInDevelopment,
    narrow: true,
    headerActionsHtml: `
      <form method="post" action="/api/auth/logout">
        <button class="${buttonClassName({ variant: "ghost", size: "sm" })}" type="submit">Выйти</button>
      </form>
    `,
    contentHtml: renderEmptyState({
      title: UI_COPY.placeholder.title,
      description: `Путь: ${escapeHtml(pathname)}. Пользователь: ${escapeHtml(session.user.email)} (${escapeHtml(toUserRoleLabel(session.user.role))}). ${UI_COPY.common.featureInDevelopment}`,
      actionHtml: `<a class="${buttonClassName({ variant: "secondary" })}" href="/app">${UI_COPY.common.appBackAction}</a>`,
    }),
  });
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

function serializeFileListItem(item: FileListItem): {
  id: string;
  original_filename: string;
  extension: string;
  size_bytes: number;
  status: string;
  created_at: string;
  updated_at: string;
} {
  return {
    id: item.id,
    original_filename: item.originalFilename,
    extension: item.extension,
    size_bytes: item.sizeBytes,
    status: item.status,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

function serializeFileDetailsItem(item: FileDetailsItem): {
  id: string;
  original_filename: string;
  extension: string;
  size_bytes: number;
  status: string;
  created_at: string;
  updated_at: string;
  processing_attempts: number;
  attempts: number | null;
  max_attempts: number | null;
  next_run_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  error_code: string | null;
  error_message: string | null;
} {
  const isFailed = item.status === "failed";
  return {
    id: item.id,
    original_filename: item.originalFilename,
    extension: item.extension,
    size_bytes: item.sizeBytes,
    status: item.status,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
    processing_attempts: item.processingAttempts,
    attempts: item.attempts,
    max_attempts: item.maxAttempts,
    next_run_at: item.nextRunAt ? item.nextRunAt.toISOString() : null,
    last_error_code: item.lastErrorCode,
    last_error_message: sanitizeFileErrorMessageForResponse(item.lastErrorMessage),
    error_code: isFailed ? item.errorCode : null,
    error_message: isFailed ? sanitizeFileErrorMessageForResponse(item.errorMessage) : null,
  };
}

function parseListLimit(rawValue: string | null): number | null {
  if (rawValue == null || rawValue.trim() === "") {
    return null;
  }

  if (!/^\d+$/.test(rawValue.trim())) {
    throw new FileListValidationError();
  }

  return Number.parseInt(rawValue, 10);
}

function encodeFileListCursor(cursor: FileListCursor): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeFileListCursor(rawCursor: string | null): FileListCursor | null {
  if (rawCursor == null || rawCursor.trim() === "") {
    return null;
  }

  try {
    const payload = Buffer.from(rawCursor, "base64url").toString("utf8");
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const createdAtRaw = parsed.created_at;
    const id = parsed.id;
    if (typeof createdAtRaw !== "string" || typeof id !== "string") {
      throw new FileListCursorDecodeError();
    }

    const createdAt = new Date(createdAtRaw);
    if (Number.isNaN(createdAt.getTime()) || !isCanonicalUuid(id)) {
      throw new FileListCursorDecodeError();
    }

    return { createdAt, id };
  } catch (error) {
    if (error instanceof FileListCursorDecodeError) {
      throw error;
    }
    throw new FileListCursorDecodeError();
  }
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

function parseFileIdFromPath(pathname: string): string | null {
  return parseSinglePathToken(pathname, "/api/files/");
}

function parseFileIdFromReportPath(pathname: string): string | null {
  const prefix = "/api/files/";
  const suffix = "/report";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }

  const rawToken = pathname.slice(prefix.length, pathname.length - suffix.length);
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

function parseFileIdFromStandaloneReportPath(pathname: string): string | null {
  const prefix = "/files/";
  const suffix = "/report";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }

  const rawToken = pathname.slice(prefix.length, pathname.length - suffix.length);
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

function isCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sanitizeFileErrorMessageForResponse(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }

  return collapsed.slice(0, 280);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
