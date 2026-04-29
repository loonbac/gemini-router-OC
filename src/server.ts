#!/usr/bin/env node
/**
 * server.ts — Hono HTTP server exposing OpenAI-compatible /v1/chat/completions
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import http from "node:http";
import { spawnBridge, resolveTimeout } from "./gemini-bridge.js";
import { spawnStreamBridge } from "./gemini-bridge.js";
import {
  validateChatRequest,
  openaiToGemini,
  geminiToOpenAI,
  type OpenAIChatRequest,
} from "./format.js";
import { SSEFormatter, NDJSONLineReader } from "./streaming.js";
import { resolveEffectivePort } from "./user-port.js";
import { logger, requestId, requestLogger } from "./logger.js";
import { modelsRegistry, type ModelMetadata } from "./models-data.js";

// ---------------------------------------------------------------------------
// App + env config
// ---------------------------------------------------------------------------

const app = new Hono();

// Middleware — order matters: requestId first, then requestLogger
app.use(requestId);
app.use(requestLogger);

// ---------------------------------------------------------------------------
// Metrics tracking — in-memory state for gemini_router_info tool
// ---------------------------------------------------------------------------

const MetricsTracker = {
  totalRequests: 0,
  totalLatencyMs: 0,

  recordRequest(latencyMs: number) {
    this.totalRequests++;
    this.totalLatencyMs += latencyMs;
  },

  getAverageLatencyMs(): number {
    if (this.totalRequests === 0) return 0;
    return this.totalLatencyMs / this.totalRequests;
  },

  reset() {
    this.totalRequests = 0;
    this.totalLatencyMs = 0;
  },
};

export const RouterState = {
  version: "1.0.0",
  startTime: Date.now(),
  activeRequests: 0,

  incrementActiveRequests() {
    this.activeRequests++;
  },

  decrementActiveRequests() {
    if (this.activeRequests > 0) this.activeRequests--;
  },

  recordLatency(latencyMs: number) {
    MetricsTracker.recordRequest(latencyMs);
  },

  getAverageLatencyMs(): number {
    return MetricsTracker.getAverageLatencyMs();
  },

  getTotalRequests(): number {
    return MetricsTracker.totalRequests;
  },
};

const PORT = resolveEffectivePort();
const DEFAULT_TIMEOUT_MS = resolveTimeout();

// ---------------------------------------------------------------------------
// Health endpoint — lightweight check for the plugin
// ---------------------------------------------------------------------------

app.get("/health", (c: Context) => {
  return c.json({ status: "ok", port: PORT });
});

// ---------------------------------------------------------------------------
// GET /v1/models — OpenAI-compatible models list
// ---------------------------------------------------------------------------

app.get("/v1/models", (c: Context) => {
  return c.json({
    object: "list",
    data: modelsRegistry.map((model: ModelMetadata) => ({
      id: model.id,
      object: model.object,
      created: model.created,
      owned_by: model.owned_by,
      context_window: model.context_window,
      max_output_tokens: model.max_output_tokens,
      capabilities: model.capabilities,
    })),
  });
});

// ---------------------------------------------------------------------------
// Error response helpers
// ---------------------------------------------------------------------------

function jsonError(c: Context, status: 400 | 502 | 504, message: string) {
  c.res.headers.set("X-Request-Id", c.get("requestId") ?? "unknown");
  return c.json({ error: { message, type: "invalid_request_error", code: status } }, status);
}

// ---------------------------------------------------------------------------
// Active process tracking — for graceful shutdown
// ---------------------------------------------------------------------------

const activeProcesses: Set<() => void> = new Set();

function registerProcess(killFn: () => void) {
  activeProcesses.add(killFn);
}

function unregisterProcess(killFn: () => void) {
  activeProcesses.delete(killFn);
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions
// ---------------------------------------------------------------------------

app.post("/v1/chat/completions", async (c: Context) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(c, 400, "Request body must be valid JSON");
  }

  const validation = validateChatRequest(body);
  if (!validation.ok) {
    return jsonError(c, 400, validation.error);
  }

  const request: OpenAIChatRequest = validation.data;
  const prompt = openaiToGemini(request);

  if (!request.stream) {
    return handleNonStreaming(c, request, prompt);
  }

  return handleStreaming(c, request, prompt);
});

// ---------------------------------------------------------------------------
// Non-streaming handler
// ---------------------------------------------------------------------------

async function handleNonStreaming(c: Context, request: OpenAIChatRequest, prompt: string) {
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  RouterState.incrementActiveRequests();

  const { promise, kill } = spawnBridge({
    prompt,
    model: request.model,
    stream: false,
    timeoutMs,
  });

  registerProcess(kill);

  try {
    const { stdout, stderr, exitCode } = await promise;

    let geminiOutput: unknown;
    try {
      geminiOutput = JSON.parse(stdout);
    } catch {
      return jsonError(c, 502, "Gemini CLI returned invalid JSON");
    }

    if (exitCode !== 0) {
      return jsonError(c, 502, `Gemini CLI exited with code ${exitCode}`);
    }

    const openAIResponse = geminiToOpenAI(geminiOutput as Parameters<typeof geminiToOpenAI>[0], request.model);
    const latencyMs = Date.now() - startTime;
    RouterState.recordLatency(latencyMs);
    c.res.headers.set("X-Request-Id", c.get("requestId") ?? "unknown");
    return c.json(openAIResponse);
  } catch (err) {
    kill();

    if (err && typeof err === "object" && "kind" in err) {
      const bErr = err as { kind: string; message: string };
      if (bErr.kind === "timeout") return jsonError(c, 504, "Gemini CLI request timed out");
      if (bErr.kind === "spawn") return jsonError(c, 502, `Failed to invoke Gemini CLI: ${bErr.message}`);
    }

    return jsonError(c, 502, "Gemini CLI bridge failed");
  } finally {
    RouterState.decrementActiveRequests();
    unregisterProcess(kill);
  }
}

// ---------------------------------------------------------------------------
// Streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(c: Context, request: OpenAIChatRequest, prompt: string): Response {
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  RouterState.incrementActiveRequests();

  const formatter = new SSEFormatter(request.model);
  const lineReader = new NDJSONLineReader();

  let killBridge: (() => void) | null = null;
  let streamEnded = false;

  const stream = new ReadableStream({
    start(controller) {
      const keepAliveInterval = setInterval(() => {
        if (!streamEnded) {
          try {
            controller.enqueue(new TextEncoder().encode(formatter.keepAlive()));
          } catch {
            clearInterval(keepAliveInterval);
          }
        } else {
          clearInterval(keepAliveInterval);
        }
      }, 5000);

      try {
        killBridge = spawnStreamBridge({
          prompt,
          model: request.model,
          stream: true,
          timeoutMs,
          onStdout: (data: string) => {
            if (streamEnded) return;
            const lines = lineReader.feed(data);
            for (const line of lines) {
              const sse = formatter.processLine(line);
              if (sse !== null) {
                try {
                  controller.enqueue(new TextEncoder().encode(sse));
                  if (sse === `data: [DONE]\n\n`) {
                    streamEnded = true;
                    clearInterval(keepAliveInterval);
                  }
                } catch { /* controller closed */ }
              }
            }
          },
          onStderr: (_data: string) => {
            // Suppress — Gemini CLI stderr is noisy (YOLO messages, tool output)
          },
          onClose: (exitCode: number | null) => {
            clearInterval(keepAliveInterval);
            if (!streamEnded) {
              try { controller.enqueue(new TextEncoder().encode(formatter.terminate())); } catch {}
              streamEnded = true;
            }
            RouterState.recordLatency(Date.now() - startTime);
            RouterState.decrementActiveRequests();
            if (killBridge) unregisterProcess(killBridge);
            try { controller.close(); } catch {}
          },
          onError: (_err: { kind: string; message: string }) => {
            clearInterval(keepAliveInterval);
            if (!streamEnded) {
              try { controller.enqueue(new TextEncoder().encode(formatter.terminate())); } catch {}
              streamEnded = true;
            }
            RouterState.recordLatency(Date.now() - startTime);
            RouterState.decrementActiveRequests();
            if (killBridge) unregisterProcess(killBridge);
            try { controller.close(); } catch {}
          },
        });

        if (killBridge) registerProcess(killBridge);
      } catch (_err) {
        clearInterval(keepAliveInterval);
        // spawnStreamBridge failed
        try { controller.enqueue(new TextEncoder().encode(formatter.terminate())); } catch {}
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      if (killBridge && !streamEnded) {
        killBridge();
        streamEnded = true;
      }
    },
  });

  c.req.raw.signal?.addEventListener("abort", () => {
    if (killBridge && !streamEnded) {
      killBridge();
      streamEnded = true;
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": c.get("requestId") ?? "unknown",
    },
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown() {
  for (const kill of activeProcesses) kill();
  activeProcesses.clear();
}

process.on("SIGTERM", async () => { await shutdown(); process.exit(0); });
process.on("SIGINT", async () => { await shutdown(); process.exit(0); });

// Auto-shutdown when parent process dies
const parentPid = process.env.ROUTER_PARENT_PID;
if (parentPid) {
  setInterval(() => {
    try { process.kill(Number(parentPid), 0); } catch { process.exit(0); }
  }, 3000);
}

// ---------------------------------------------------------------------------
// Health probe for EADDRINUSE — check if the process on that port is ours
// ---------------------------------------------------------------------------

async function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Start — handle EADDRINUSE gracefully
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== "test") {
  const server = serve({ fetch: app.fetch, port: PORT }, () => {});

  server.on("error", async (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Probe the port's /health endpoint
      const isOurProcess = await probeHealth(PORT);
      if (isOurProcess) {
        // Another instance of our router is running — clean exit
        process.exit(0);
      }
      // A different process owns the port — fail with error
      logger.error(`Port ${PORT} is occupied by a non-router process. Exiting with error.`);
      process.exit(1);
    }
    process.exit(1);
  });
}
