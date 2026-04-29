/**
 * integration.test.ts — Integration tests for request flow with mocked CLI
 *
 * Tests HTTP layer (middleware, routing, response construction) by mocking
 * spawnBridge and spawnStreamBridge. This lets us verify:
 * - Full non-streaming request flow
 * - Full streaming request flow (SSE)
 * - Request ID propagation in headers and logs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requestId, requestLogger } from "./logger.js";
import {
  validateChatRequest,
  openaiToGemini,
  geminiToOpenAI,
  type OpenAIChatRequest,
} from "./format.js";
import { SSEFormatter, NDJSONLineReader } from "./streaming.js";
import { modelsRegistry, type ModelMetadata } from "./models-data.js";

// ---------------------------------------------------------------------------
// Mock gemini-bridge
// ---------------------------------------------------------------------------

const mockSpawnBridge = vi.fn();
const mockSpawnStreamBridge = vi.fn();

vi.mock("./gemini-bridge.js", () => ({
  spawnBridge: mockSpawnBridge,
  spawnStreamBridge: mockSpawnStreamBridge,
  resolveTimeout: () => 120_000,
  buildArgs: (config: any) =>
    ["-p", config.prompt, "-m", config.model, "-o", config.stream ? "stream-json" : "json", "-y"],
}));

vi.mock("./user-port.js", () => ({
  getUserPort: vi.fn(() => 47891),
  resolveEffectivePort: vi.fn(() => 47891),
}));

// ---------------------------------------------------------------------------
// Build test app (mirrors server.ts structure)
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 120_000;

function buildTestApp() {
  const app = new Hono();

  // Middleware
  app.use(requestId);
  app.use(requestLogger);

  app.get("/health", (c) => c.json({ status: "ok", port: 47891 }));

  app.get("/v1/models", (c) =>
    c.json({
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
    })
  );

  function jsonError(c: any, status: 400 | 502 | 504, message: string) {
    c.res.headers.set("X-Request-Id", c.get("requestId") ?? "unknown");
    return c.json(
      { error: { message, type: "invalid_request_error", code: status } },
      status
    );
  }

  async function handleNonStreaming(c: any, request: OpenAIChatRequest, prompt: string) {
    const { promise, kill } = mockSpawnBridge({
      prompt,
      model: request.model,
      stream: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });

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

      const openAIResponse = geminiToOpenAI(
        geminiOutput as Parameters<typeof geminiToOpenAI>[0],
        request.model
      );
      c.res.headers.set("X-Request-Id", c.get("requestId") ?? "unknown");
      return c.json(openAIResponse);
    } catch (err: any) {
      kill();

      if (err && typeof err === "object" && "kind" in err) {
        if (err.kind === "timeout") return jsonError(c, 504, "Gemini CLI request timed out");
        if (err.kind === "spawn")
          return jsonError(c, 502, `Failed to invoke Gemini CLI: ${err.message}`);
      }

      return jsonError(c, 502, "Gemini CLI bridge failed");
    }
  }

  function handleStreaming(c: any, request: OpenAIChatRequest, prompt: string): Response {
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
          killBridge = mockSpawnStreamBridge({
            prompt,
            model: request.model,
            stream: true,
            timeoutMs: DEFAULT_TIMEOUT_MS,
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
                  } catch {
                    /* controller closed */
                  }
                }
              }
            },
            onStderr: (_data: string) => {},
            onClose: (exitCode: number | null) => {
              clearInterval(keepAliveInterval);
              if (!streamEnded) {
                try {
                  controller.enqueue(new TextEncoder().encode(formatter.terminate()));
                } catch {}
                streamEnded = true;
              }
              try {
                controller.close();
              } catch {}
            },
            onError: (_err: { kind: string; message: string }) => {
              clearInterval(keepAliveInterval);
              if (!streamEnded) {
                try {
                  controller.enqueue(new TextEncoder().encode(formatter.terminate()));
                } catch {}
                streamEnded = true;
              }
              try {
                controller.close();
              } catch {}
            },
          });
        } catch (_err) {
          clearInterval(keepAliveInterval);
          try {
            controller.enqueue(new TextEncoder().encode(formatter.terminate()));
          } catch {}
          try {
            controller.close();
          } catch {}
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

  app.post("/v1/chat/completions", async (c) => {
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

  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Full request flow integration (mocked CLI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Non-streaming request flow
  // -------------------------------------------------------------------------

  describe("Non-streaming request flow", () => {
    it("completes a non-streaming request and returns OpenAI format", async () => {
      const mockOutput = {
        session_id: "test-session",
        response: "Hello from Gemini!",
        stats: {
          models: {
            "gemini-2.5-flash": {
              tokens: { input: 10, prompt: 10, candidates: 5, total: 15 },
            },
          },
        },
      };

      mockSpawnBridge.mockReturnValue({
        promise: Promise.resolve({ stdout: JSON.stringify(mockOutput), stderr: "", exitCode: 0 }),
        kill: vi.fn(),
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);

      const json = await response.json() as any;
      expect(json.id).toMatch(/^chatcmpl-/);
      expect(json.object).toBe("chat.completion");
      expect(json.choices).toHaveLength(1);
      expect(json.choices[0].message.role).toBe("assistant");
      expect(json.choices[0].message.content).toBe("Hello from Gemini!");
      expect(json.usage).toBeDefined();
    });

    it("returns X-Request-Id header in non-streaming response", async () => {
      mockSpawnBridge.mockReturnValue({
        promise: Promise.resolve({
          stdout: JSON.stringify({ session_id: "x", response: "hi", stats: {} }),
          stderr: "",
          exitCode: 0,
        }),
        kill: vi.fn(),
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "test-req-123",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Request-Id")).toBe("test-req-123");
    });

    it("generates X-Request-Id when client doesn't provide one", async () => {
      mockSpawnBridge.mockReturnValue({
        promise: Promise.resolve({
          stdout: JSON.stringify({ session_id: "x", response: "hi", stats: {} }),
          stderr: "",
          exitCode: 0,
        }),
        kill: vi.fn(),
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      const reqId = response.headers.get("X-Request-Id");
      expect(reqId).toBeDefined();
      expect(reqId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      expect(response.status).toBe(400);
      const json = await response.json() as any;
      expect(json.error).toBeDefined();
      expect(json.error.message).toContain("valid JSON");
    });

    it("returns 400 for missing model field", async () => {
      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(response.status).toBe(400);
      const json = await response.json() as any;
      expect(json.error).toBeDefined();
    });

    it("returns 502 for CLI error (exit code or invalid JSON)", async () => {
      // With empty stdout, JSON parse fails first (before exitCode check)
      mockSpawnBridge.mockReturnValue({
        promise: Promise.resolve({ stdout: "", stderr: "error", exitCode: 1 }),
        kill: vi.fn(),
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(502);
      const json = await response.json() as any;
      // Server tries JSON.parse first; empty stdout triggers "invalid JSON"
      expect(json.error.message).toContain("invalid JSON");
    });

    it("returns 504 for timeout", async () => {
      mockSpawnBridge.mockReturnValue({
        promise: Promise.reject({ kind: "timeout", message: "Request timed out" }),
        kill: vi.fn(),
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(504);
      const json = await response.json() as any;
      expect(json.error.message).toContain("timed out");
    });
  });

  // -------------------------------------------------------------------------
  // Streaming request flow
  // -------------------------------------------------------------------------

  describe("Streaming request flow", () => {
    it("completes a streaming request and returns SSE format", async () => {
      // Mock spawnStreamBridge to call onStdout with test data
      mockSpawnStreamBridge.mockImplementation((config) => {
        // Simulate streaming output by calling onStdout multiple times
        setTimeout(() => {
          config.onStdout(
            JSON.stringify({
              type: "message",
              timestamp: new Date().toISOString(),
              role: "model",
              content: "Hello",
              delta: true,
            }) + "\n"
          );
        }, 10);

        setTimeout(() => {
          config.onStdout(
            JSON.stringify({
              type: "message",
              timestamp: new Date().toISOString(),
              role: "model",
              content: " world!",
              delta: true,
            }) + "\n"
          );
        }, 20);

        setTimeout(() => {
          config.onStdout(JSON.stringify({ type: "result", status: "success" }) + "\n");
          config.onClose(0);
        }, 30);

        return vi.fn();
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");

      // Collect SSE chunks
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      let totalChunks = 0;
      let foundDone = false;
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalChunks++;
          const chunk = decoder.decode(value, { stream: true });

          if (chunk.includes("[DONE]")) {
            foundDone = true;
            break;
          }
        }
      }

      expect(totalChunks).toBeGreaterThan(0);
      expect(foundDone).toBe(true);
    });

    it("returns X-Request-Id header in streaming response", async () => {
      mockSpawnStreamBridge.mockImplementation((config) => {
        setTimeout(() => {
          config.onStdout(JSON.stringify({ type: "result", status: "success" }) + "\n");
          config.onClose(0);
        }, 10);
        return vi.fn();
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "stream-req-456",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Request-Id")).toBe("stream-req-456");
    });

    it("generates X-Request-Id for streaming when client doesn't provide one", async () => {
      mockSpawnStreamBridge.mockImplementation((config) => {
        setTimeout(() => {
          config.onStdout(JSON.stringify({ type: "result", status: "success" }) + "\n");
          config.onClose(0);
        }, 10);
        return vi.fn();
      });

      const app = buildTestApp();
      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      const reqId = response.headers.get("X-Request-Id");
      expect(reqId).toBeDefined();
      expect(reqId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // Request ID propagation
  // -------------------------------------------------------------------------

  describe("Request ID propagation", () => {
    it("preserves client-provided X-Request-Id through the full flow", async () => {
      mockSpawnBridge.mockReturnValue({
        promise: Promise.resolve({
          stdout: JSON.stringify({ session_id: "x", response: "hi", stats: {} }),
          stderr: "",
          exitCode: 0,
        }),
        kill: vi.fn(),
      });

      const app = buildTestApp();
      const clientReqId = "client-specified-req-id";

      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": clientReqId,
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "test" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Request-Id")).toBe(clientReqId);
    });

    it("error responses include the request ID from context", async () => {
      const app = buildTestApp();
      const reqId = "error-req-789";

      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": reqId,
        },
        body: JSON.stringify({
          messages: [{ role: "user" }], // missing content — invalid
        }),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("X-Request-Id")).toBe(reqId);
    });
  });

  // -------------------------------------------------------------------------
  // Health endpoint
  // -------------------------------------------------------------------------

  describe("Health endpoint", () => {
    it("returns ok status with port", async () => {
      const app = buildTestApp();
      const response = await app.request("/health");

      expect(response.status).toBe(200);
      const json = await response.json() as any;
      expect(json.status).toBe("ok");
      expect(json.port).toBe(47891);
    });
  });

  // -------------------------------------------------------------------------
  // /v1/models endpoint with extended metadata
  // -------------------------------------------------------------------------

  describe("/v1/models endpoint", () => {
    it("returns all 6 models with extended metadata", async () => {
      const app = buildTestApp();
      const response = await app.request("/v1/models");

      expect(response.status).toBe(200);
      const json = await response.json() as any;

      expect(json.object).toBe("list");
      expect(json.data).toHaveLength(6);

      // Verify each model has required extended fields
      for (const model of json.data as any[]) {
        expect(model.id).toMatch(/^gemini-/);
        expect(model.object).toBe("model");
        expect(typeof model.created).toBe("number");
        expect(model.owned_by).toBe("google");
        expect(typeof model.context_window).toBe("number");
        expect(model.context_window).toBeGreaterThan(0);
        expect(typeof model.max_output_tokens).toBe("number");
        expect(model.max_output_tokens).toBeGreaterThan(0);
        expect(Array.isArray(model.capabilities)).toBe(true);
        expect(model.capabilities).toContain("chat");
      }
    });

    it("returns gemini-2.5-flash with correct metadata", async () => {
      const app = buildTestApp();
      const response = await app.request("/v1/models");

      expect(response.status).toBe(200);
      const json = await response.json() as any;

      const flash = json.data.find((m: any) => m.id === "gemini-2.5-flash");
      expect(flash).toBeDefined();
      expect(flash.context_window).toBe(100000);
      expect(flash.max_output_tokens).toBe(8192);
      expect(flash.capabilities).toContain("streaming");
      expect(flash.capabilities).toContain("function-calling");
    });

    it("returns gemini-2.5-flash-lite with lower limits", async () => {
      const app = buildTestApp();
      const response = await app.request("/v1/models");

      expect(response.status).toBe(200);
      const json = await response.json() as any;

      const lite = json.data.find((m: any) => m.id === "gemini-2.5-flash-lite");
      expect(lite).toBeDefined();
      expect(lite.context_window).toBe(65000);
      expect(lite.max_output_tokens).toBe(4096);
    });
  });
});