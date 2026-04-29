/**
 * streaming.test.ts — Unit tests for streaming.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SSEFormatter, NDJSONLineReader, parseNDJSONLine, formatSSEChunk } from "./streaming.js";

describe("parseNDJSONLine", () => {
  it("parses init event", () => {
    const line = '{"type":"init","timestamp":"123","session_id":"abc","model":"gemini"}';
    const result = parseNDJSONLine(line);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("init");
  });

  it("parses message event", () => {
    const line = '{"type":"message","content":"hello","delta":true}';
    const result = parseNDJSONLine(line);
    expect(result?.type).toBe("message");
    expect((result as any)?.content).toBe("hello");
  });

  it("parses result event", () => {
    const line = '{"type":"result","status":"success","session_id":"abc"}';
    const result = parseNDJSONLine(line);
    expect(result?.type).toBe("result");
    expect((result as any)?.status).toBe("success");
  });

  it("returns null for empty line", () => {
    expect(parseNDJSONLine("")).toBeNull();
    expect(parseNDJSONLine("   ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseNDJSONLine("not json")).toBeNull();
  });
});

describe("NDJSONLineReader", () => {
  it("splits on LF", () => {
    const reader = new NDJSONLineReader();
    const lines = reader.feed('{"a":1}\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("handles CRLF", () => {
    const reader = new NDJSONLineReader();
    const lines = reader.feed('{"a":1}\r\n{"b":2}\r\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("buffers incomplete line", () => {
    const reader = new NDJSONLineReader();
    const part1 = reader.feed('{"a":1');
    expect(part1).toEqual([]);
    const part2 = reader.feed('}\n{"b":2}\n');
    expect(part2).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("flush returns remaining buffer", () => {
    const reader = new NDJSONLineReader();
    reader.feed('{"a":1}');
    const flushed = reader.flush();
    expect(flushed).toBe('{"a":1}');
  });

  it("flush returns null when empty", () => {
    const reader = new NDJSONLineReader();
    expect(reader.flush()).toBeNull();
  });
});

describe("SSEFormatter", () => {
  let formatter: SSEFormatter;

  beforeEach(() => {
    formatter = new SSEFormatter("gemini-3.1-pro");
  });

  it("skips init events silently", () => {
    const initLine = '{"type":"init","timestamp":"123","session_id":"abc","model":"gemini"}';
    const result = formatter.processLine(initLine);
    expect(result).toBeNull();
  });

  it("emits first message delta with role", () => {
    const msgLine = '{"type":"message","content":"Hello","delta":true}';
    const result = formatter.processLine(msgLine);
    expect(result).not.toBeNull();
    expect(result).toContain('"role":"assistant"');
    expect(result).toContain('"content":"Hello"');
    expect(result).toContain("chat.completion.chunk");
  });

  it("emits subsequent message deltas without role", () => {
    const msg1 = '{"type":"message","content":"Hello ","delta":true}';
    const msg2 = '{"type":"message","content":"world","delta":true}';
    formatter.processLine(msg1); // first chunk with role
    const result = formatter.processLine(msg2);
    expect(result).not.toBeNull();
    expect(result).not.toContain('"role"');
    expect(result).toContain('"content":"world"');
  });

  it("terminates with data: [DONE] on result", () => {
    const resultLine = '{"type":"result","status":"success","session_id":"abc"}';
    const result = formatter.processLine(resultLine);
    expect(result).toBe("data: [DONE]\n\n");
  });

  it("terminates stream on error", () => {
    const result = formatter.terminate();
    expect(result).toBe("data: [DONE]\n\n");
  });

  it("does not double-terminate", () => {
    const resultLine = '{"type":"result","status":"success"}';
    formatter.processLine(resultLine);
    const second = formatter.processLine(resultLine);
    expect(second).toBeNull();
  });

  it("handles non-delta message", () => {
    const msgLine = '{"type":"message","content":"Hello world","delta":false}';
    const result = formatter.processLine(msgLine);
    expect(result).not.toBeNull();
    expect(result).toContain('"content":"Hello world"');
  });

  it("handles empty response (result without prior messages)", () => {
    const resultLine = '{"type":"result","status":"success"}';
    const result = formatter.processLine(resultLine);
    expect(result).toBe("data: [DONE]\n\n");
  });

  it("emits role chunk then stop for non-delta first message", () => {
    const msgLine = '{"type":"message","content":"I am the response","delta":false}';
    const result = formatter.processLine(msgLine);
    expect(result).not.toBeNull();
    // non-delta first message → role chunk + stop
    expect(result).toContain('"content":"I am the response"');
    expect(result).toContain('"finish_reason":"stop"');
  });

  it("emits SSE chunk with reasoning_content for type: thought event", () => {
    const thoughtLine = '{"type":"thought","timestamp":"123","content":"I need to analyze this"}';
    const result = formatter.processLine(thoughtLine);
    expect(result).not.toBeNull();
    expect(result).toContain('"reasoning_content":"I need to analyze this"');
  });

  it("emits empty reasoning_content for thought event with empty content", () => {
    const thoughtLine = '{"type":"thought","timestamp":"123","content":""}';
    const result = formatter.processLine(thoughtLine);
    // Empty content should still emit (the thought event exists, just no content)
    expect(result).not.toBeNull();
  });

  it("emits SSE chunk with reasoning_content for role: thought message", () => {
    const thoughtLine = '{"type":"message","timestamp":"123","role":"thought","content":"My reasoning here","delta":true}';
    const result = formatter.processLine(thoughtLine);
    expect(result).not.toBeNull();
    expect(result).toContain('"reasoning_content":"My reasoning here"');
  });

  it("does not set role in delta for thought messages", () => {
    const thoughtLine = '{"type":"message","timestamp":"123","role":"thought","content":"thinking","delta":true}';
    const result = formatter.processLine(thoughtLine);
    expect(result).not.toBeNull();
    // Thought messages should NOT get "role":"assistant" in the delta
    // They should only have reasoning_content
    expect(result).not.toContain('"role":"assistant"');
  });
});

describe("formatSSEChunk", () => {
  it("includes reasoning_content when option is provided", () => {
    const result = formatSSEChunk("chatcmpl-abc", "gemini-2.5-pro", "", {
      reasoning_content: "I am thinking about this...",
    });
    expect(result).toContain('"reasoning_content":"I am thinking about this..."');
  });

  it("includes both content and reasoning_content when both provided", () => {
    const result = formatSSEChunk("chatcmpl-abc", "gemini-2.5-pro", "Hello", {
      reasoning_content: "My thought process",
    });
    expect(result).toContain('"content":"Hello"');
    expect(result).toContain('"reasoning_content":"My thought process"');
  });

  it("omits reasoning_content when not provided", () => {
    const result = formatSSEChunk("chatcmpl-abc", "gemini-2.5-pro", "Hello");
    expect(result).not.toContain("reasoning_content");
  });
});
