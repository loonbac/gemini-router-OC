/**
 * models-data.test.ts — Unit tests for src/models-data.ts
 */

import { describe, it, expect } from "vitest";
import { modelsRegistry, SUPPORTED_MODEL_IDS, type ModelMetadata } from "./models-data.js";

describe("modelsRegistry", () => {
  it("exports a non-empty array", () => {
    expect(Array.isArray(modelsRegistry)).toBe(true);
    expect(modelsRegistry.length).toBeGreaterThan(0);
  });

  it("contains all 6 supported models", () => {
    expect(modelsRegistry).toHaveLength(6);
  });

  it("each model has required metadata fields", () => {
    for (const model of modelsRegistry) {
      expect(typeof model.id).toBe("string");
      expect(model.id.length).toBeGreaterThan(0);
      expect(model.object).toBe("model");
      expect(typeof model.created).toBe("number");
      expect(model.created).toBeGreaterThan(0);
      expect(model.owned_by).toBe("google");
      expect(typeof model.context_window).toBe("number");
      expect(model.context_window).toBeGreaterThan(0);
      expect(typeof model.max_output_tokens).toBe("number");
      expect(model.max_output_tokens).toBeGreaterThan(0);
      expect(Array.isArray(model.capabilities)).toBe(true);
      expect(model.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("each model has a valid context_window", () => {
    for (const model of modelsRegistry) {
      // Context windows should be reasonable values (at least 10k tokens)
      expect(model.context_window).toBeGreaterThanOrEqual(10000);
    }
  });

  it("each model has capabilities that include 'chat'", () => {
    for (const model of modelsRegistry) {
      expect(model.capabilities).toContain("chat");
    }
  });

  it("SUPPORTED_MODEL_IDS matches the ids from modelsRegistry", () => {
    const idsFromRegistry = modelsRegistry.map((m) => m.id);
    expect(SUPPORTED_MODEL_IDS).toEqual(idsFromRegistry);
  });

  it("contains gemini-2.5-flash with correct metadata", () => {
    const flash = modelsRegistry.find((m) => m.id === "gemini-2.5-flash");
    expect(flash).toBeDefined();
    expect(flash!.context_window).toBe(100000);
    expect(flash!.max_output_tokens).toBe(8192);
    expect(flash!.capabilities).toContain("streaming");
    expect(flash!.capabilities).toContain("function-calling");
  });

  it("contains gemini-2.5-flash-lite with lower context window", () => {
    const lite = modelsRegistry.find((m) => m.id === "gemini-2.5-flash-lite");
    expect(lite).toBeDefined();
    expect(lite!.context_window).toBe(65000);
    expect(lite!.max_output_tokens).toBe(4096);
  });
});
