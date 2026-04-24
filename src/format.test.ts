/**
 * format.test.ts — Unit tests for format.ts
 */

import { describe, it, expect } from "vitest";
import {
  validateChatRequest,
  openaiToGemini,
  geminiToOpenAI,
  normalizeModel,
  SUPPORTED_MODELS,
  type OpenAIChatRequest,
  type GeminiJSONOutput,
} from "./format.js";

describe("normalizeModel", () => {
  it("returns model ID as-is for valid supported models", () => {
    for (const model of SUPPORTED_MODELS) {
      expect(normalizeModel(model)).toBe(model);
    }
  });

  it("trims whitespace", () => {
    expect(normalizeModel("  gemini-2.5-flash  ")).toBe("gemini-2.5-flash");
    expect(normalizeModel("\tgemini-2.5-pro\n")).toBe("gemini-2.5-pro");
  });

  it("throws descriptive error for invalid model", () => {
    expect(() => normalizeModel("invalid-model")).toThrow(/Unsupported model/);
    expect(() => normalizeModel("invalid-model")).toThrow(/invalid-model/);
    expect(() => normalizeModel("invalid-model")).toThrow(/gemini-3.1-pro-preview/);
  });
});

describe("validateChatRequest", () => {
  it("returns ok for valid request", () => {
    const req = { model: "gemini-3.1-pro-preview", messages: [{ role: "user", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.model).toBe("gemini-3.1-pro-preview");
      expect(result.data.messages).toHaveLength(1);
    }
  });

  it("rejects missing model", () => {
    const req = { messages: [{ role: "user", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("model");
  });

  it("rejects empty messages", () => {
    const req = { model: "gemini-2.5-flash", messages: [] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("messages");
  });

  it("rejects invalid role", () => {
    const req = { model: "gemini-2.5-flash", messages: [{ role: "jefe", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("role");
  });

  it("rejects unsupported model", () => {
    const req = { model: "unknown-model", messages: [{ role: "user", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported model");
      expect(result.error).toContain("unknown-model");
    }
  });

  it("accepts all 6 supported models", () => {
    for (const model of SUPPORTED_MODELS) {
      const req = { model, messages: [{ role: "user", content: "hi" }] };
      const result = validateChatRequest(req);
      expect(result.ok).toBe(true);
    }
  });
});

describe("openaiToGemini", () => {
  it("prepends system message before user message", () => {
    const req: OpenAIChatRequest = {
      model: "gemini",
      messages: [
        { role: "system", content: "Be brief" },
        { role: "user", content: "Hi" },
      ],
    };
    const prompt = openaiToGemini(req);
    expect(prompt).toBe("[System]\nBe brief\n\n[User]\nHi");
  });

  it("handles multiple user messages", () => {
    const req: OpenAIChatRequest = {
      model: "gemini",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ],
    };
    const prompt = openaiToGemini(req);
    expect(prompt).toContain("[User]\nHello");
    expect(prompt).toContain("[Assistant]\nHi there");
    expect(prompt).toContain("[User]\nHow are you?");
  });

  it("handles system-only request (edge case)", () => {
    const req: OpenAIChatRequest = {
      model: "gemini",
      messages: [{ role: "system", content: "You are helpful" }],
    };
    const prompt = openaiToGemini(req);
    expect(prompt).toBe("[System]\nYou are helpful");
  });
});

describe("geminiToOpenAI", () => {
  it("maps basic response fields correctly", () => {
    const geminiOut: GeminiJSONOutput = {
      session_id: "abc",
      response: "Hello world",
    };
    const result = geminiToOpenAI(geminiOut, "gemini-3.1-pro");
    expect(result.model).toBe("gemini-3.1-pro");
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0].message.content).toBe("Hello world");
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  it("defaults token counts to 0 when stats absent", () => {
    const geminiOut: GeminiJSONOutput = { session_id: "abc", response: "Hi" };
    const result = geminiToOpenAI(geminiOut, "gemini");
    expect(result.usage.prompt_tokens).toBe(0);
    expect(result.usage.completion_tokens).toBe(0);
    expect(result.usage.total_tokens).toBe(0);
  });

  it("extracts tokens from stats when present", () => {
    const geminiOut: GeminiJSONOutput = {
      session_id: "abc",
      response: "Hi",
      stats: {
        models: {
          "gemini-3.1-pro": {
            tokens: {
              input: 10,
              prompt: 10,
              candidates: 5,
              total: 15,
            },
          },
        },
      },
    };
    const result = geminiToOpenAI(geminiOut, "gemini-3.1-pro");
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result.usage.total_tokens).toBe(15);
  });

  it("handles missing session_id gracefully", () => {
    const geminiOut: GeminiJSONOutput = { session_id: "abc", response: "Hi" };
    const result = geminiToOpenAI(geminiOut, "gemini");
    expect(result.id).toMatch(/^chatcmpl-/);
    expect(result.choices[0].message.content).toBe("Hi");
  });
});
