#!/usr/bin/env node
/**
 * dummy-cli.js — Mock Gemini CLI for integration testing
 *
 * Supports the same argument interface as the real gemini CLI:
 *   -p {prompt}   (prompt)
 *   -m {model}    (model name)
 *   -o {json|stream-json}  (output mode)
 *   -y            (skip confirmation)
 *
 * JSON mode: writes a single JSON blob to stdout
 * stream-json mode: writes NDJSON lines to stdout
 */

const args = process.argv.slice(2);

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const prompt = getArgValue("-p") ?? "hello";
const model = getArgValue("-m") ?? "gemini-2.5-flash";
const outputMode = getArgValue("-o") ?? "json";

function generateJSONResponse() {
  const sessionId = "dummy-" + Math.random().toString(36).slice(2, 10);
  return JSON.stringify({
    session_id: sessionId,
    response: `Echo: ${prompt.slice(0, 50)}`,
    stats: {
      models: {
        [model]: {
          tokens: { input: 15, prompt: 15, candidates: 8, total: 23 },
        },
      },
    },
  });
}

function generateStreamLines() {
  const sessionId = "dummy-" + Math.random().toString(36).slice(2, 10);
  const lines = [
    JSON.stringify({
      type: "init",
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      model,
    }),
    JSON.stringify({
      type: "message",
      timestamp: new Date().toISOString(),
      role: "model",
      content: `Streamed: ${prompt.slice(0, 30)}`,
      delta: false,
    }),
    JSON.stringify({
      type: "message",
      timestamp: new Date().toISOString(),
      role: "model",
      content: `more content here`,
      delta: true,
    }),
    JSON.stringify({
      type: "result",
      timestamp: new Date().toISOString(),
      status: "success",
      session_id: sessionId,
      response: `Full response to: ${prompt.slice(0, 50)}`,
      stats: {
        models: {
          [model]: {
            tokens: { input: 15, prompt: 15, candidates: 8, total: 23 },
          },
        },
      },
    }),
  ];
  return lines.join("\n") + "\n";
}

process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") process.exit(0);
});

if (outputMode === "stream-json") {
  process.stdout.write(generateStreamLines());
} else {
  process.stdout.write(generateJSONResponse());
}