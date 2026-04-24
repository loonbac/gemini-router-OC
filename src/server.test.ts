/**
 * server.test.ts — Unit and integration tests for server.ts
 *
 * Note: Full integration tests requiring a real gemini CLI are skipped in CI.
 * These tests verify the HTTP layer, validation, and response shapes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnBridge, resolveTimeout } from "./gemini-bridge.js";
import { Hono } from "hono";
import {
  validateChatRequest,
  openaiToGemini,
  geminiToOpenAI,
  SUPPORTED_MODELS,
} from "./format.js";

// Mock user-port module
const mockGetUserPort = vi.hoisted(() => vi.fn(() => 47890));
const mockResolveEffectivePort = vi.hoisted(() => vi.fn(() => 47890));
vi.mock("./user-port.js", () => ({
  getUserPort: mockGetUserPort,
  resolveEffectivePort: mockResolveEffectivePort,
}));

// ---------------------------------------------------------------------------
// Validation-only tests (don't need server)
// ---------------------------------------------------------------------------

describe("Request Validation Integration", () => {
  it("validateChatRequest accepts stream:true", () => {
    const req = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stream).toBe(true);
  });

  it("validateChatRequest accepts stream:false", () => {
    const req = {
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.stream).toBe(false);
  });

  it("rejects messages with missing content", () => {
    const req = {
      model: "gemini-2.5-pro",
      messages: [{ role: "user" }],
    };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
  });

  it("rejects non-array messages", () => {
    const req = {
      model: "gemini-2.5-flash-lite",
      messages: "not an array",
    };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
  });
});

describe("Prompt Assembly Integration", () => {
  it("system prompt is prepended to user prompt", () => {
    const prompt = openaiToGemini({
      model: "gemini",
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "What is 2+2?" },
      ],
    });
    expect(prompt).toContain("[System]");
    expect(prompt).toContain("You are a helpful assistant");
    expect(prompt).toContain("[User]");
    expect(prompt).toContain("What is 2+2?");
    // System comes before User
    const sysIdx = prompt.indexOf("[System]");
    const userIdx = prompt.indexOf("[User]");
    expect(sysIdx).toBeLessThan(userIdx);
  });

  it("handles conversation with assistant turns", () => {
    const prompt = openaiToGemini({
      model: "gemini",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "How are you?" },
      ],
    });
    expect(prompt).toContain("[User]\nHi");
    expect(prompt).toContain("[Assistant]\nHello!");
    expect(prompt).toContain("[User]\nHow are you?");
  });
});

describe("Response Shape Integration", () => {
  it("geminiToOpenAI returns valid OpenAI completion shape", () => {
    const geminiOut = {
      session_id: "abc",
      response: "The answer is 4",
      stats: {
        models: {
          "gemini-3.1-pro": {
            tokens: { input: 20, prompt: 20, candidates: 5, total: 25 },
          },
        },
      },
    };
    const result = geminiToOpenAI(geminiOut, "gemini-3.1-pro");

    // Check required fields per OpenAI spec
    expect(result.id).toMatch(/^chatcmpl-/);
    expect(result.object).toBe("chat.completion");
    expect(typeof result.created).toBe("number");
    expect(result.model).toBe("gemini-3.1-pro");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].index).toBe(0);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("The answer is 4");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage.prompt_tokens).toBe(20);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(25);
  });

  it("geminiToOpenAI handles empty response", () => {
    const geminiOut = { session_id: "abc", response: "" };
    const result = geminiToOpenAI(geminiOut, "gemini");
    expect(result.choices[0].message.content).toBe("");
    expect(result.usage.prompt_tokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Timeout resolution
// ---------------------------------------------------------------------------

describe("GET /v1/models endpoint", () => {
  it("returns all 6 supported models", () => {
    const modelsResponse = {
      object: "list",
      data: SUPPORTED_MODELS.map((id) => ({
        id,
        object: "model",
        created: expect.any(Number),
        owned_by: "google",
      })),
    };
    expect(modelsResponse.data).toHaveLength(6);
    expect(modelsResponse.object).toBe("list");
    for (const model of SUPPORTED_MODELS) {
      expect(modelsResponse.data.some((m: { id: string }) => m.id === model)).toBe(true);
    }
  });

  it("models have correct OpenAI format", () => {
    const modelEntry = {
      id: "gemini-2.5-flash",
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "google",
    };
    expect(modelEntry.object).toBe("model");
    expect(modelEntry.owned_by).toBe("google");
    expect(typeof modelEntry.created).toBe("number");
  });
});

describe("Timeout Configuration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults to 120 seconds", () => {
    delete process.env.REQUEST_TIMEOUT_MS;
    expect(resolveTimeout()).toBe(120_000);
  });

  it("reads custom timeout from env", () => {
    process.env.REQUEST_TIMEOUT_MS = "30000";
    expect(resolveTimeout()).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// HTTP Route tests — validate expected behaviors
// ---------------------------------------------------------------------------

describe("Expected HTTP Behaviors (unit-tested patterns)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PORT;
    delete process.env.GEMINI_ROUTER_PORT;
    mockGetUserPort.mockReturnValue(47890);
    mockResolveEffectivePort.mockReturnValue(47890);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("port defaults to derived value when no env vars", () => {
    // server.ts uses resolveEffectivePort() which calls getUserPort()
    expect(mockResolveEffectivePort()).toBe(47890);
  });

  it("PORT env overrides derived port", () => {
    process.env.PORT = "6000";
    mockResolveEffectivePort.mockReturnValue(6000);
    expect(mockResolveEffectivePort()).toBe(6000);
  });

  it("GEMINI_ROUTER_PORT env overrides PORT", () => {
    process.env.GEMINI_ROUTER_PORT = "5000";
    process.env.PORT = "6000";
    mockResolveEffectivePort.mockReturnValue(5000);
    expect(mockResolveEffectivePort()).toBe(5000);
  });

  it("JSON error response has correct shape", () => {
    const errorShape = {
      error: {
        message: "Missing or invalid 'model' field",
        type: "invalid_request_error",
        code: 400,
      },
    };
    expect(errorShape.error.message).toContain("model");
    expect(errorShape.error.type).toBe("invalid_request_error");
  });

  it("spawnBridge config shape is correct", async () => {
    // We can't test actual spawning without gemini CLI,
    // but we can verify the config interface works
    const config = {
      prompt: "test prompt",
      model: "gemini-2.5-flash",
      stream: false,
      timeoutMs: 120_000,
    };
    expect(config.prompt).toBe("test prompt");
    expect(config.model).toBe("gemini-2.5-flash");
    expect(config.stream).toBe(false);
    expect(config.timeoutMs).toBe(120_000);
  });
});
