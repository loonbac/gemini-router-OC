/**
 * models-data.ts — Centralized Gemini model metadata registry
 *
 * Contains ModelMetadata interface and modelsRegistry array.
 * Consumed by format.ts and server.ts to populate /v1/models responses.
 */

export interface ModelMetadata {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  context_window: number;
  max_output_tokens: number;
  capabilities: string[];
}

export const modelsRegistry: ModelMetadata[] = [
  {
    id: "gemini-3-pro",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 1048576,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-3-flash",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 1048576,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-3.1-flash-lite",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 65536,
    max_output_tokens: 4096,
    capabilities: ["chat", "streaming", "function-calling"],
  },
  {
    id: "gemini-3.1-pro-preview",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 200000,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-3-flash-preview",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 200000,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 200000,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling"],
  },
  {
    id: "gemini-1.5-pro",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 1048576,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-1.5-flash",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 1048576,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-2.5-pro",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 100000,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-2.5-flash",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 100000,
    max_output_tokens: 8192,
    capabilities: ["chat", "streaming", "function-calling", "vision"],
  },
  {
    id: "gemini-2.5-flash-lite",
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "google",
    context_window: 65000,
    max_output_tokens: 4096,
    capabilities: ["chat", "streaming", "function-calling"],
  },
];

export const SUPPORTED_MODEL_IDS = modelsRegistry.map((m) => m.id);
