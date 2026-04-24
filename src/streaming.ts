/**
 * streaming.ts — Converts Gemini NDJSON stream to OpenAI SSE format
 */

import type { GeminiNDJSONLine } from "./format.js";

// ---------------------------------------------------------------------------
// SSE chunk builder
// ---------------------------------------------------------------------------

function nextId(): string {
  return `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Formats a message delta as an SSE data: chunk.
 *
 * For the FIRST chunk of a stream, role goes in delta:
 *   {"delta":{"role":"assistant","content":"..."},"finish_reason":null}
 *
 * For subsequent content chunks:
 *   {"delta":{"content":"..."},"finish_reason":null}
 *
 * For the FINAL chunk:
 *   {"delta":{},"finish_reason":"stop"}
 */
export function formatSSEChunk(
  id: string,
  model: string,
  content: string,
  options: { role?: string; isFinal?: boolean } = {},
): string {
  const { role, isFinal = false } = options;
  const finishReason: null | "stop" = isFinal ? "stop" : null;

  // Build delta — role only on the first chunk (when isFinal is false and role provided)
  const delta: Record<string, string> = {};
  if (role && !isFinal) {
    delta.role = role;
  }
  if (content) {
    delta.content = content;
  }

  const chunk: object = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Emit the DONE sentinel
 */
export function formatSDone(): string {
  return `data: [DONE]\n\n`;
}

// ---------------------------------------------------------------------------
// NDJSON line parser — parses a single line into a GeminiNDJSONLine
// ---------------------------------------------------------------------------

export function parseNDJSONLine(line: string): GeminiNDJSONLine | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  try {
    return JSON.parse(trimmed) as GeminiNDJSONLine;
  } catch {
    // If we can't parse the line, skip it silently
    return null;
  }
}

// ---------------------------------------------------------------------------
// SSEFormatter — accumulates state for a streaming response
// ---------------------------------------------------------------------------

export class SSEFormatter {
  private id: string;
  private model: string;
  private roleSent = false;
  private done = false;

  constructor(model: string) {
    this.id = nextId();
    this.model = model;
  }

  /**
   * Process one raw stdout line from gemini -o stream-json.
   * Returns SSE string to emit, or null if nothing to emit.
   * Returns "done" sentinel string when stream is finished.
   */
  processLine(rawLine: string): string | null {
    if (this.done) return null;

    const line = parseNDJSONLine(rawLine);
    if (line === null) return null;

    switch (line.type) {
      case "init":
        // type: "init" — skip silently, no SSE output
        return null;

      case "message": {
        // Skip user messages — only emit assistant messages
        if (line.role === "user") return null;

        const content = line.content ?? "";
        const isDelta = line.delta === true;

        if (!isDelta) {
          // Non-delta message — treat as complete (single-shot content)
          if (!this.roleSent) {
            this.roleSent = true;
            // First + only message: role + content + stop in one chunk
            return formatSSEChunk(this.id, this.model, content, { role: "assistant", isFinal: true });
          }
          return formatSSEChunk(this.id, this.model, content, { isFinal: true });
        }

        // Delta chunk — streaming
        if (!this.roleSent) {
          this.roleSent = true;
          // First delta: include role
          return formatSSEChunk(this.id, this.model, content, { role: "assistant" });
        }
        return formatSSEChunk(this.id, this.model, content);
      }

      case "result": {
        this.done = true;
        // Gemini result signals end of stream — emit [DONE]
        return formatSDone();
      }

      default:
        return null;
    }
  }

  /**
   * Force-terminate the stream (on error / crash)
   */
  terminate(): string {
    if (!this.done) {
      this.done = true;
      return formatSDone();
    }
    return "";
  }

  get streamId(): string {
    return this.id;
  }
}

// ---------------------------------------------------------------------------
// lineReader — splits NDJSON by newlines, handling partial chunks
// ---------------------------------------------------------------------------

export class NDJSONLineReader {
  private buffer = "";

  /**
   * Accept a string chunk from stdout, return array of complete lines.
   */
  feed(data: string): string[] {
    this.buffer += data;
    const lines: string[] = [];
    let idx = 0;

    while (idx < this.buffer.length) {
      // Find newline (LF or CRLF)
      let nlIdx = this.buffer.indexOf("\n", idx);
      if (nlIdx === -1) {
        // No complete line yet — keep buffered
        this.buffer = this.buffer.slice(idx);
        break;
      }

      // Include the line content (strip trailing \r if present)
      const line = this.buffer.slice(idx, nlIdx).replace(/\r$/, "");
      lines.push(line);

      // Move past the newline
      idx = nlIdx + 1;

      // If next char is \r (CRLF), skip it too
      if (idx < this.buffer.length && this.buffer[idx] === "\r") {
        idx++;
      }
    }

    if (idx >= this.buffer.length) {
      this.buffer = "";
    }

    return lines;
  }

  /**
   * Flush any remaining buffered content as a line (without final newline)
   */
  flush(): string | null {
    if (this.buffer.length === 0) return null;
    const line = this.buffer.replace(/\r$/, "");
    this.buffer = "";
    return line;
  }
}
