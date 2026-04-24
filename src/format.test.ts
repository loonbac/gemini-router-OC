/**
 * format.test.ts — Unit tests for format.ts
 */

import { describe, it, expect } from "vitest";
import {
  validateChatRequest,
  openaiToGemini,
  geminiToOpenAI,
  type OpenAIChatRequest,
  type GeminiJSONOutput,
} from "./format.js";

describe("validateChatRequest", () => {
  it("returns ok for valid request", () => {
    const req = { model: "gemini-3.1-pro", messages: [{ role: "user", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.model).toBe("gemini-3.1-pro");
      expect(result.data.messages).toHaveLength(1);
    }
  });

  it("rejects missing model", () => {
    const req = { messages: [{ role: "user", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("model");
  });

  it("rejects empty messages", () => {
    const req = { model: "gemini", messages: [] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("messages");
  });

  it("rejects invalid role", () => {
    const req = { model: "gemini", messages: [{ role: "jefe", content: "hi" }] };
    const result = validateChatRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("role");
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
    const geminiOut: GeminiJSONOutput = { response: "Hi" };
    const result = geminiToOpenAI(geminiOut, "gemini");
    expect(result.id).toMatch(/^chatcmpl-/);
    expect(result.choices[0].message.content).toBe("Hi");
  });
});
