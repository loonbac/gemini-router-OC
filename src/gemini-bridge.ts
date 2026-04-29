/**
 * gemini-bridge.ts — Spawns Gemini CLI and collects output
 *
 * Uses execFile for non-streaming (proven to work in ESM).
 * Uses spawn for streaming (with explicit env to work in ESM).
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { resolveCliPath } from "./cli-path.js";

const GEMINI_WORKDIR = process.env.GEMINI_WORKDIR ?? process.cwd();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  prompt: string;
  model: string;
  stream: boolean;
  timeoutMs: number;
}

export interface BridgeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface BridgeError {
  kind: "timeout" | "spawn" | "exit" | "unknown";
  message: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;

export function resolveTimeout(): number {
  const env = process.env.REQUEST_TIMEOUT_MS;
  if (env !== undefined) {
    const parsed = Number(env);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TIMEOUT_MS;
}

export function buildArgs(config: Pick<BridgeConfig, "prompt" | "model" | "stream">): string[] {
  const { prompt, model, stream } = config;
  const outputMode = stream ? "stream-json" : "json";
  return ["-p", prompt, "-m", model, "-o", outputMode, "-y"];
}

// ---------------------------------------------------------------------------
// spawnBridge — non-streaming via execFile (works in ESM)
// ---------------------------------------------------------------------------

export function spawnBridge(
  config: BridgeConfig,
): { promise: Promise<BridgeResult>; kill: () => void } {
  const cliPath = resolveCliPath();
  const args = buildArgs(config);
  const timeoutMs = config.timeoutMs ?? resolveTimeout();

  let killed = false;

  const stdoutBuffers: Buffer[] = [];
  const stderrBuffers: Buffer[] = [];

  const child = execFile(cliPath, args, {
    cwd: GEMINI_WORKDIR,
    timeout: timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env },
  });

  // Collect output as Buffer arrays (safe for multi-byte UTF-8)
  child.stdout?.on("data", (d: Buffer) => { stdoutBuffers.push(d); });
  child.stderr?.on("data", (d: Buffer) => { stderrBuffers.push(d); });

  const kill = () => {
    if (killed) return;
    killed = true;
    child.stdout?.removeAllListeners("data");
    child.stderr?.removeAllListeners("data");
    try { child.kill("SIGTERM"); } catch {}
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, 3000);
  };

  const promise = new Promise<BridgeResult>((resolve, reject) => {
    child.on("close", (code) => {
      // Clean up listeners before resolving
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      resolve({
        stdout: Buffer.concat(stdoutBuffers).toString("utf-8"),
        stderr: Buffer.concat(stderrBuffers).toString("utf-8"),
        exitCode: code,
      });
    });

    child.on("error", (err) => {
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      if (err.message.includes("ETIMEDOUT") || err.message.includes("timed out")) {
        reject({ kind: "timeout", message: `Gemini CLI timed out after ${timeoutMs}ms` });
      } else {
        reject({ kind: "spawn", message: `Failed to spawn gemini CLI: ${err.message}` });
      }
    });
  });

  return { promise, kill };
}

// ---------------------------------------------------------------------------
// StreamBridge — streaming via spawn (with explicit env for ESM)
// ---------------------------------------------------------------------------

export interface StreamBridgeConfig extends BridgeConfig {
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  onClose: (exitCode: number | null) => void;
  onError: (err: BridgeError) => void;
}

export function spawnStreamBridge(config: StreamBridgeConfig): () => void {
  const cliPath = resolveCliPath();
  const args = buildArgs(config);

  let settled = false;

  const child: ChildProcess = spawn(cliPath, args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: GEMINI_WORKDIR,
    env: { ...process.env },
  });

  // StringDecoder handles multi-byte UTF-8 chunk boundary correctly
  const stdoutDecoder = new StringDecoder("utf-8");
  const stderrDecoder = new StringDecoder("utf-8");

  // Escalation timer: config.timeoutMs + 5000ms grace period
  const effectiveTimeout = config.timeoutMs || resolveTimeout();
  let escalationTimer: NodeJS.Timeout | null = setTimeout(() => {
    if (!settled) {
      try { child.kill("SIGKILL"); } catch {}
    }
  }, effectiveTimeout + 5000);

  function cleanupListeners() {
    child.stdout?.removeAllListeners("data");
    child.stdout?.removeAllListeners("error");
    child.stdout?.removeAllListeners("close");
    child.stderr?.removeAllListeners("data");
    child.stderr?.removeAllListeners("error");
    child.stderr?.removeAllListeners("close");
    child.removeAllListeners("error");
    child.removeAllListeners("close");
  }

  function kill(sig: "SIGTERM" | "SIGKILL" = "SIGTERM") {
    if (settled) return;
    settled = true;
    if (escalationTimer !== null) {
      clearTimeout(escalationTimer);
      escalationTimer = null;
    }
    cleanupListeners();
    try { child.kill(sig); } catch {}
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    config.onStdout(stdoutDecoder.write(chunk));
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    config.onStderr(stderrDecoder.write(chunk));
  });

  child.on("error", (err: Error) => {
    if (!settled) {
      settled = true;
      if (escalationTimer !== null) {
        clearTimeout(escalationTimer);
        escalationTimer = null;
      }
      cleanupListeners();
      config.onError({ kind: "spawn", message: `Failed to spawn gemini CLI: ${err.message}` });
    }
  });

  child.on("close", (code: number | null) => {
    if (!settled) {
      settled = true;
      if (escalationTimer !== null) {
        clearTimeout(escalationTimer);
        escalationTimer = null;
      }
      cleanupListeners();
      config.onClose(code);
    }
  });

  // Request timeout
  const timeoutMs = config.timeoutMs ?? resolveTimeout();
  const timeoutHandle = setTimeout(() => {
    if (!settled) {
      kill("SIGTERM");
      config.onError({ kind: "timeout", message: `Gemini CLI timed out after ${timeoutMs}ms` });
    }
  }, timeoutMs);

  child.on("close", () => {
    clearTimeout(timeoutHandle);
  });

  return kill;
}
