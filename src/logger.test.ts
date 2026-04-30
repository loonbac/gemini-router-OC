/**
 * logger.test.ts — Tests for src/logger.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, requestId, requestLogger } from "./logger.js";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Logger unit tests
// ---------------------------------------------------------------------------

describe("logger", () => {
  const originalEnv = process.env;
  let consoleSpy: { log: any; info: any; debug: any; warn: any; error: any };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LOG_LEVEL;
    consoleSpy = {
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("logger.info emits JSON with timestamp, level, message", () => {
    logger.info("hello world");
    expect(consoleSpy.info).toHaveBeenCalled();
    const logLine = JSON.parse(consoleSpy.info.mock.calls[0][0]);
    expect(logLine.timestamp).toBeDefined();
    expect(logLine.level).toBe("info");
    expect(logLine.message).toBe("hello world");
  });

  it("logger.warn emits JSON with level warn", () => {
    logger.warn("something bad");
    expect(consoleSpy.warn).toHaveBeenCalled();
    const logLine = JSON.parse(consoleSpy.warn.mock.calls[0][0]);
    expect(logLine.level).toBe("warn");
    expect(logLine.message).toBe("something bad");
  });

  it("logger.error emits JSON with level error", () => {
    logger.error("failed");
    expect(consoleSpy.error).toHaveBeenCalled();
    const logLine = JSON.parse(consoleSpy.error.mock.calls[0][0]);
    expect(logLine.level).toBe("error");
    expect(logLine.message).toBe("failed");
  });

  it("info logs respect LOG_LEVEL=warn (suppress info)", async () => {
    process.env.LOG_LEVEL = "warn";
    const { logger: logger2 } = await import("./logger.js");
    logger2.info("should be suppressed");
    expect(consoleSpy.info).not.toHaveBeenCalled();
  });

  it("invalid LOG_LEVEL falls back to info", async () => {
    process.env.LOG_LEVEL = "garbage";
    const { logger: logger2 } = await import("./logger.js");
    logger2.info("should appear");
    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it("logger.debug emits when LOG_LEVEL=debug", async () => {
    process.env.LOG_LEVEL = "debug";
    const { logger: logger2 } = await import("./logger.js");
    logger2.debug("should appear");
    expect(consoleSpy.debug).toHaveBeenCalled();
    const logLine = JSON.parse(consoleSpy.debug.mock.calls[0][0]);
    expect(logLine.level).toBe("debug");
  });
});

// ---------------------------------------------------------------------------
// requestId middleware tests
// ---------------------------------------------------------------------------

describe("requestId middleware", () => {
  it("generates a UUID when X-Request-Id is absent", async () => {
    const app = new Hono();
    app.use(requestId);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test");
    const reqId = res.headers.get("X-Request-Id");
    expect(reqId).toBeDefined();
    expect(reqId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("preserves client-provided X-Request-Id", async () => {
    const app = new Hono();
    app.use(requestId);
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("/test", {
      headers: { "X-Request-ID": "client-abc-123" },
    });
    expect(res.headers.get("X-Request-Id")).toBe("client-abc-123");
  });

  it("requestId is available in context via c.get('requestId')", async () => {
    const app = new Hono();
    app.use(requestId);
    let capturedId: unknown;
    app.get("/test", (c) => {
      capturedId = (c as any).get("requestId");
      return c.text("ok");
    });

    await app.request("/test");
    expect(capturedId).toBeDefined();
    expect(typeof capturedId).toBe("string");
    expect((capturedId as string)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

// ---------------------------------------------------------------------------
// requestLogger middleware tests
// ---------------------------------------------------------------------------

describe("requestLogger middleware", () => {
  let logSpy: any;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LOG_LEVEL = "debug";
    logSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("logs method, path, status, duration, requestId", async () => {
    const app = new Hono();
    app.use(requestId);
    app.use(requestLogger);
    app.get("/test", (c) => c.text("ok"));

    await app.request("/test", { headers: { "X-Request-ID": "req-test-123" } });

    expect(logSpy).toHaveBeenCalled();
    const logLine = JSON.parse(logSpy.mock.calls[0][0]);
    expect(logLine.level).toBe("debug");
    expect(logLine.method).toBe("GET");
    expect(logLine.path).toBe("/test");
    expect(logLine.status).toBe(200);
    expect(logLine.durationMs).toBeDefined();
    expect(typeof logLine.durationMs).toBe("number");
    expect(logLine.requestId).toBe("req-test-123");
  });

  it("logs warn level for 4xx responses", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new Hono();
    app.use(requestId);
    app.use(requestLogger);
    app.get("/test", (c) => c.text("not found", 404));

    await app.request("/test");

    expect(warnSpy).toHaveBeenCalled();
    const logLine = JSON.parse(warnSpy.mock.calls[0][0]);
    expect(logLine.level).toBe("warn");
    expect(logLine.status).toBe(404);
  });

  it("logs error level for 5xx responses", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono();
    app.use(requestId);
    app.use(requestLogger);
    app.get("/test", (c) => c.text("server error", 500));

    await app.request("/test");

    expect(errorSpy).toHaveBeenCalled();
    const logLine = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(logLine.level).toBe("error");
    expect(logLine.status).toBe(500);
  });

  it("uses generated requestId when client doesn't provide one", async () => {
    const app = new Hono();
    app.use(requestId);
    app.use(requestLogger);
    app.get("/test", (c) => c.text("ok"));

    await app.request("/test");

    expect(logSpy).toHaveBeenCalled();
    const logLine = JSON.parse(logSpy.mock.calls[0][0]);
    expect(logLine.level).toBe("debug");
    expect(logLine.requestId).toBeDefined();
    expect(typeof logLine.requestId).toBe("string");
  });
});