/**
 * gemini-bridge.test.ts — Unit tests for gemini-bridge.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StringDecoder } from "node:string_decoder";
import { buildArgs, resolveTimeout, spawnBridge, spawnStreamBridge } from "./gemini-bridge.js";
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

describe("spawnStreamBridge", () => {
  const originalEnv = process.env;
  let setTimeoutSpy: any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REQUEST_TIMEOUT_MS;
    // Set a fake CLI path so resolveCliPath doesn't fail
    process.env.GEMINI_CLI_PATH = "/usr/bin/gemini";

    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("escalation timer uses config.timeoutMs + 5000", () => {
    const configTimeout = 30_000;

    spawnStreamBridge({
      prompt: "test",
      model: "gemini-2.5-pro",
      stream: true,
      timeoutMs: configTimeout,
      onStdout: () => {},
      onStderr: () => {},
      onClose: () => {},
      onError: () => {},
    });

    // The escalation timer should be config.timeoutMs + 5000 = 35000
    const escalationCall = setTimeoutSpy.mock.calls.find(
      (call: any[]) => call[1] === configTimeout + 5000,
    );

    expect(escalationCall).toBeDefined();
    expect(escalationCall![1]).toBe(35_000);
  });

  it("escalation timer uses default timeout + 5000 when config.timeoutMs is 0", () => {
    // Default timeout is 120000, so escalation should be 125000
    spawnStreamBridge({
      prompt: "test",
      model: "gemini-2.5-pro",
      stream: true,
      timeoutMs: 0,
      onStdout: () => {},
      onStderr: () => {},
      onClose: () => {},
      onError: () => {},
    });

    // With timeoutMs=0, resolveTimeout() returns 120000, escalation = 125000
    const escalationCall = setTimeoutSpy.mock.calls.find(
      (call: any[]) => call[1] === 125_000,
    );

    expect(escalationCall).toBeDefined();
    expect(escalationCall![1]).toBe(125_000);
  });

  it("escalation timer adapts when env timeout is customized", () => {
    process.env.REQUEST_TIMEOUT_MS = "60000";

    spawnStreamBridge({
      prompt: "test",
      model: "gemini-2.5-pro",
      stream: true,
      timeoutMs: 0,
      onStdout: () => {},
      onStderr: () => {},
      onClose: () => {},
      onError: () => {},
    });

    // With env=60000 and timeoutMs=0, resolveTimeout() returns 60000, escalation = 65000
    const escalationCall = setTimeoutSpy.mock.calls.find(
      (call: any[]) => call[1] === 65_000,
    );

    expect(escalationCall).toBeDefined();
    expect(escalationCall![1]).toBe(65_000);
  });
});

// ---------------------------------------------------------------------------
// Buffer concatenation tests — verify UTF-8 multi-byte safety
// ---------------------------------------------------------------------------

describe("spawnBridge Buffer concatenation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REQUEST_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Buffer.concat produces correct string from multiple buffers", () => {
    // Simulate what spawnBridge does: collect Buffer[] then Buffer.concat
    // Multi-byte UTF-8 characters should not be corrupted
    const chunk1 = Buffer.from([72, 101, 108, 108, 111]); // "Hello"
    const chunk2 = Buffer.from([32, 239, 191, 189]); // " " + replacement char (3 bytes)
    const chunk3 = Buffer.from([119, 111, 114, 108, 100]); // "world"

    const result = Buffer.concat([chunk1, chunk2, chunk3]).toString("utf-8");
    // The replacement char (U+FFFD) is valid UTF-8 and round-trips correctly
    expect(result).toBe("Hello \ufffdworld");
    expect(Buffer.from(result, "utf-8").toString()).toBe("Hello \ufffdworld");
  });

  it("Buffer.concat handles empty buffer array", () => {
    const result = Buffer.concat([]).toString("utf-8");
    expect(result).toBe("");
  });

  it("Buffer.concat handles single buffer", () => {
    const single = Buffer.from("hello", "utf-8");
    const result = Buffer.concat([single]).toString("utf-8");
    expect(result).toBe("hello");
  });

  it("Buffer.concat preserves CJK characters", () => {
    // "你好世界" — each CJK character is 3 bytes in UTF-8
    const buffers: Buffer[] = [];
    const str = "你好世界";
    for (let i = 0; i < str.length; i++) {
      buffers.push(Buffer.from(str[i]));
    }
    const result = Buffer.concat(buffers).toString("utf-8");
    expect(result).toBe(str);
  });

  it("Buffer.concat preserves emoji (4-byte UTF-8)", () => {
    // "💍" (U+1F48D) = F0 9F 92 8D — a 4-byte UTF-8 character
    const emojiBuffer = Buffer.from([240, 159, 146, 141]);
    const result = Buffer.concat([emojiBuffer]).toString("utf-8");
    expect(result).toBe("💍");
  });

  it("Buffer.concat handles mixed ASCII and multi-byte in multiple chunks", () => {
    // "你" = [228, 189, 160], "好" = [229, 149, 189]
    const buffers: Buffer[] = [];
    buffers.push(Buffer.from("Hello "));
    buffers.push(Buffer.from([228, 189, 160])); // "你" (3 bytes)
    buffers.push(Buffer.from(" world!"));

    const result = Buffer.concat(buffers).toString("utf-8");
    expect(result).toBe("Hello 你 world!");
  });
});

// ---------------------------------------------------------------------------
// StringDecoder boundary safety tests — verify no chunk boundary corruption
// ---------------------------------------------------------------------------

describe("spawnStreamBridge StringDecoder boundary safety", () => {
  it("StringDecoder.write correctly handles complete multi-byte characters", () => {
    const decoder = new StringDecoder("utf-8");

    // "你" = [228, 189, 160] — complete 3-byte UTF-8 character
    const chunk = Buffer.from([228, 189, 160]);
    const result = decoder.write(chunk);

    // StringDecoder should output the valid character
    expect(result).toBe("你");
    // After a complete character, no bytes should be held
    expect(decoder.end()).toBe("");
  });

  it("StringDecoder.write correctly handles ASCII characters", () => {
    const decoder = new StringDecoder("utf-8");

    const result1 = decoder.write(Buffer.from("AB"));
    expect(result1).toBe("AB");
  });

  it("StringDecoder.write handles empty chunk", () => {
    const decoder = new StringDecoder("utf-8");
    const result1 = decoder.write(Buffer.from("hello"));
    const result2 = decoder.write(Buffer.from([]));
    expect(result1).toBe("hello");
    expect(result2).toBe("");
  });

  it("StringDecoder.write handles chunk boundary between messages", () => {
    // Simulate two complete JSON messages split across buffer boundary
    const decoder = new StringDecoder("utf-8");

    // First message complete, then partial second message
    const chunk1 = Buffer.from('{"msg":"hello"}\n{"msg":"wor', "utf-8");
    const result1 = decoder.write(chunk1);

    // Complete the second message
    const chunk2 = Buffer.from('ld"}\n', "utf-8");
    const result2 = decoder.write(chunk2);

    const combined = result1 + result2;
    expect(combined).toBe('{"msg":"hello"}\n{"msg":"world"}\n');
  });

  it("StringDecoder.end returns any remaining buffered characters", () => {
    const decoder = new StringDecoder("utf-8");

    // Send an incomplete multi-byte sequence (2 bytes of a 3-byte char)
    decoder.write(Buffer.from([228, 189])); // Only 2 bytes of "你"

    // end() should return the incomplete bytes as replacement or empty
    const remaining = decoder.end();
    // StringDecoder returns replacement character for incomplete sequences
    expect(typeof remaining).toBe("string");
  });
});
