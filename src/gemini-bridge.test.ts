/**
 * gemini-bridge.test.ts — Unit tests for gemini-bridge.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildArgs, resolveTimeout } from "./gemini-bridge.js";

describe("buildArgs", () => {
  it("builds non-streaming args", () => {
    const args = buildArgs({ prompt: "hi", model: "gemini-3.1-pro", stream: false });
    expect(args).toEqual(["-p", "hi", "-m", "gemini-3.1-pro", "-o", "json", "-y"]);
  });

  it("builds streaming args", () => {
    const args = buildArgs({ prompt: "hi", model: "gemini-3.1-pro", stream: true });
    expect(args).toEqual(["-p", "hi", "-m", "gemini-3.1-pro", "-o", "stream-json", "-y"]);
  });

  it("escapes prompt with quotes in it", () => {
    const args = buildArgs({ prompt: "say \"hi\"", model: "gemini", stream: false });
    expect(args[1]).toBe("say \"hi\"");
  });
});

describe("resolveTimeout", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns default 120000", () => {
    delete process.env.REQUEST_TIMEOUT_MS;
    expect(resolveTimeout()).toBe(120_000);
  });

  it("parses env var when set", () => {
    process.env.REQUEST_TIMEOUT_MS = "60000";
    expect(resolveTimeout()).toBe(60_000);
  });

  it("returns default for invalid env var", () => {
    process.env.REQUEST_TIMEOUT_MS = "not-a-number";
    expect(resolveTimeout()).toBe(120_000);
  });

  it("returns default for negative env var", () => {
    process.env.REQUEST_TIMEOUT_MS = "-5000";
    expect(resolveTimeout()).toBe(120_000);
  });
});
