/**
 * format.ts — OpenAI ↔ Gemini format translation
 */

// ---------------------------------------------------------------------------
// OpenAI Request (what we receive)
// ---------------------------------------------------------------------------

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

// ---------------------------------------------------------------------------
// OpenAI Response (what we return)
// ---------------------------------------------------------------------------

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    message: { role: "assistant"; content: string };
    finish_reason: "stop";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// OpenAI SSE Chunk (what we stream)
// ---------------------------------------------------------------------------

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: { content?: string; role?: string };
    finish_reason: null | "stop";
  }>;
}

// ---------------------------------------------------------------------------
// Gemini JSON output (what gemini -o json returns)
// ---------------------------------------------------------------------------

export interface GeminiJSONOutput {
  session_id: string;
  response: string;
  stats?: {
    models?: Record<string, {
      tokens?: {
        input?: number;
        prompt?: number;
        candidates?: number;
        total?: number;
        cached?: number;
        thoughts?: number;
        tool?: number;
      };
      api?: {
        totalRequests?: number;
        totalErrors?: number;
        totalLatencyMs?: number;
      };
      roles?: Record<string, unknown>;
    }>;
  };
  tools?: unknown;
  files?: unknown;
}

// ---------------------------------------------------------------------------
// Gemini NDJSON streaming events (what gemini -o stream-json outputs)
// ---------------------------------------------------------------------------

export type GeminiNDJSONLine =
  | { type: "init"; timestamp: string; session_id: string; model: string }
  | { type: "message"; timestamp: string; role?: string; content: string; delta: boolean }
  | { type: "result"; timestamp: string; status: "success" | "error"; session_id: string; response?: string; stats?: GeminiJSONOutput["stats"] };

// ---------------------------------------------------------------------------
// Bridge spawn config
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  prompt: string;
  model: string;
  stream: boolean;
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Supported models
// ---------------------------------------------------------------------------

export const SUPPORTED_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

/**
 * Normalizes a model string by trimming whitespace and validating against supported list.
 * @throws Error with descriptive message if model is not supported
 */
export function normalizeModel(model: string): string {
  const trimmed = model.trim();
  if (SUPPORTED_MODELS.includes(trimmed as SupportedModel)) {
    return trimmed;
  }
  throw new Error(
    `Unsupported model: "${trimmed}". Supported models: ${SUPPORTED_MODELS.join(", ")}`
  );
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function validateChatRequest(body: unknown): { ok: true; data: OpenAIChatRequest } | { ok: false; error: string } {
  if (body === null || body === undefined || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const b = body as Record<string, unknown>;

  if (typeof b.model !== "string" || b.model.trim() === "") {
    return { ok: false, error: "Missing or invalid 'model' field" };
  }

  let normalizedModel: string;
  try {
    normalizedModel = normalizeModel(b.model as string);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  if (!Array.isArray(b.messages) || b.messages.length === 0) {
    return { ok: false, error: "Missing or invalid 'messages' field" };
  }

  for (const msg of b.messages) {
    if (typeof msg !== "object" || msg === null) {
      return { ok: false, error: "Each message must be an object" };
    }
    const m = msg as Record<string, unknown>;
    if (typeof m.role !== "string" || !["system", "user", "assistant"].includes(m.role)) {
      return { ok: false, error: "Message role must be 'system', 'user', or 'assistant'" };
    }
    if (typeof m.content !== "string") {
      if (Array.isArray(m.content)) {
        m.content = m.content
          .filter((part: unknown) => typeof part === "object" && part !== null && "type" in (part as Record<string, unknown>) && (part as Record<string, unknown>).type === "text")
          .map((part: unknown) => ((part as Record<string, unknown>).text as string))
          .join("\n");
      } else {
        return { ok: false, error: "Message content must be a string or array" };
      }
    }
  }

  return {
    ok: true,
    data: {
      model: normalizedModel,
      messages: b.messages as OpenAIMessage[],
      stream: b.stream === true,
      temperature: typeof b.temperature === "number" ? b.temperature : undefined,
      max_tokens: typeof b.max_tokens === "number" ? b.max_tokens : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// openaiToGemini — build the prompt string Gemini CLI expects
// ---------------------------------------------------------------------------

/**
 * Prepends system messages before the user message.
 * Gemini CLI's `-p` flag takes a single string.
 */
export function openaiToGemini(request: OpenAIChatRequest): string {
  const parts: string[] = [];

  for (const msg of request.messages) {
    if (msg.role === "system") {
      parts.push(`[System]\n${msg.content}`);
    } else if (msg.role === "user") {
      parts.push(`[User]\n${msg.content}`);
    } else if (msg.role === "assistant") {
      parts.push(`[Assistant]\n${msg.content}`);
    }
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// geminiToOpenAI — parse Gemini JSON → OpenAI response
// ---------------------------------------------------------------------------

export function geminiToOpenAI(geminiOutput: GeminiJSONOutput, model: string): OpenAIChatResponse {
  const nowSec = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;

  // Extract token counts from stats
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  const modelStats = geminiOutput.stats?.models;
  if (modelStats) {
    const firstModel = Object.values(modelStats)[0];
    if (firstModel?.tokens) {
      const t = firstModel.tokens;
      promptTokens = t.input ?? t.prompt ?? 0;
      completionTokens = t.candidates ?? 0;
      totalTokens = t.total ?? (promptTokens + completionTokens);
    }
  }

  return {
    id,
    object: "chat.completion",
    created: nowSec,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: geminiOutput.response ?? "" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };
}
