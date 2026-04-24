#!/usr/bin/env node
/**
 * server.ts — Hono HTTP server exposing OpenAI-compatible /v1/chat/completions
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { serve } from "@hono/node-server";
import { spawnBridge, resolveTimeout } from "./gemini-bridge.js";
import { spawnStreamBridge } from "./gemini-bridge.js";
import {
  validateChatRequest,
  openaiToGemini,
  geminiToOpenAI,
  type OpenAIChatRequest,
} from "./format.js";
import { SSEFormatter, NDJSONLineReader } from "./streaming.js";

// ---------------------------------------------------------------------------
// App + env config
// ---------------------------------------------------------------------------

const app = new Hono();

const PORT = Number(process.env.PORT ?? "4789");
const DEFAULT_TIMEOUT_MS = resolveTimeout();

// ---------------------------------------------------------------------------
// Health endpoint — lightweight check for the plugin
// ---------------------------------------------------------------------------

app.get("/health", (c: Context) => {
  return c.json({ status: "ok", port: PORT });
});

// ---------------------------------------------------------------------------
// Error response helpers
// ---------------------------------------------------------------------------

function jsonError(c: Context, status: 400 | 502 | 504, message: string) {
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
    unregisterProcess(kill);
  }
}

// ---------------------------------------------------------------------------
// Streaming handler
// ---------------------------------------------------------------------------

function handleStreaming(c: Context, request: OpenAIChatRequest, prompt: string): Response {
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const formatter = new SSEFormatter(request.model);
  const lineReader = new NDJSONLineReader();

  let killBridge: (() => void) | null = null;
  let streamEnded = false;

  const stream = new ReadableStream({
    start(controller) {
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
                  if (sse === `data: [DONE]\n\n`) streamEnded = true;
                } catch { /* controller closed */ }
              }
            }
          },
          onStderr: (_data: string) => {
            // Suppress — Gemini CLI stderr is noisy (YOLO messages, tool output)
          },
          onClose: (exitCode: number | null) => {
            if (!streamEnded) {
              try { controller.enqueue(new TextEncoder().encode(formatter.terminate())); } catch {}
              streamEnded = true;
            }
            if (killBridge) unregisterProcess(killBridge);
            try { controller.close(); } catch {}
          },
          onError: (_err: { kind: string; message: string }) => {
            if (!streamEnded) {
              try { controller.enqueue(new TextEncoder().encode(formatter.terminate())); } catch {}
              streamEnded = true;
            }
            if (killBridge) unregisterProcess(killBridge);
            try { controller.close(); } catch {}
          },
        });

        if (killBridge) registerProcess(killBridge);
      } catch (_err) {
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

// ---------------------------------------------------------------------------
// Start — handle EADDRINUSE gracefully
// ---------------------------------------------------------------------------

const server = serve({ fetch: app.fetch, port: PORT }, () => {});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    process.exit(0); // Clean exit — another instance is running
  }
  process.exit(1);
});
