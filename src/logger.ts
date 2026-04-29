/**
 * logger.ts — Structured logging with request ID support
 */

import type { MiddlewareHandler } from "hono";

// ---------------------------------------------------------------------------
// Level enum
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ---------------------------------------------------------------------------
// Effective level from LOG_LEVEL env var
// ---------------------------------------------------------------------------

function effectiveLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVELS) return env as LogLevel;
  return "info";
}

// ---------------------------------------------------------------------------
// JSON logger
// ---------------------------------------------------------------------------

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[effectiveLevel()]) return;

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    ...meta,
  };

  const json = JSON.stringify(entry);

  switch (level) {
    case "debug":
    case "info":
      console.info(json);
      break;
    case "warn":
      console.warn(json);
      break;
    case "error":
      console.error(json);
      break;
  }
}

export const logger = {
  debug(msg: string, meta?: Record<string, unknown>) { log("debug", msg, meta); },
  info(msg: string, meta?: Record<string, unknown>) { log("info", msg, meta); },
  warn(msg: string, meta?: Record<string, unknown>) { log("warn", msg, meta); },
  error(msg: string, meta?: Record<string, unknown>) { log("error", msg, meta); },
};

// ---------------------------------------------------------------------------
// requestId middleware
// ---------------------------------------------------------------------------

/**
 * Generates or preserves X-Request-Id and attaches it to the Hono context.
 * Sets response header X-Request-Id.
 */
export const requestId: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header("X-Request-Id");
  const id = incoming ?? crypto.randomUUID();

  c.set("requestId", id);
  await next();

  c.res.headers.set("X-Request-Id", id);
};

// ---------------------------------------------------------------------------
// requestLogger middleware
// ---------------------------------------------------------------------------

/**
 * Logs method, path, status, durationMs, requestId per request.
 * Uses warn level for 4xx, error level for 5xx.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const requestId = c.get("requestId") ?? "unknown";
  const start = Date.now();

  await next();

  const durationMs = Date.now() - start;
  const status = c.res.status;

  const level: LogLevel = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

  const logFn = level === "error" ? logger.error.bind(logger) : level === "warn" ? logger.warn.bind(logger) : logger.info.bind(logger);

  logFn("request completed", {
    method: c.req.method,
    path: c.req.path,
    status,
    durationMs,
    requestId,
  });
};