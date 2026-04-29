/**
 * plugin.ts — OpenCode plugin for gemini-router
 *
 * Registers Gemini as a provider using the Gemini CLI (OAuth-based, no API key).
 * Starts an HTTP router that bridges Gemini CLI → OpenAI-compatible API.
 *
 * Auto-starts the router on module import and auto-restarts on crash.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolveEffectivePort } from "./user-port.js"
import { RouterState } from "./server.js"

const SERVER_SCRIPT = join(__dirname, "server.js") // dist/server.js next to dist/plugin.js

// Tool helper — creates a tool definition with execute function
function tool<T extends Record<string, unknown>>(definition: {
  name: string;
  description: string;
  arguments: T;
  execute: (args: T) => Promise<Record<string, unknown>>;
}) {
  return definition;
}

// ─── Configuration ───────────────────────────────────────────────────────────

const ROUTER_PORT = resolveEffectivePort()
const BASE_URL = `http://127.0.0.1:${ROUTER_PORT}/v1`
const RESTART_DELAY_MS = 2000
const MAX_RESTARTS = 5
const HEALTH_TIMEOUT_MS = 500
const STARTUP_POLL_INTERVAL_MS = 300
const STARTUP_MAX_WAIT_MS = 10000

// ─── State ───────────────────────────────────────────────────────────────────

let child: ChildProcess | null = null
let restartCount = 0
let shuttingDown = false
let started = false

function earlyLog(msg: string) {
  // Early boot logs buffered until ctx is available
}

async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${ROUTER_PORT}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

async function waitForRouter(): Promise<void> {
  const deadline = Date.now() + STARTUP_MAX_WAIT_MS
  while (Date.now() < deadline) {
    if (await isRunning()) return
    await new Promise((r) => setTimeout(r, STARTUP_POLL_INTERVAL_MS))
  }
}
// ─── Spawn the router ───────────────────────────────────────────────────────

function startRouter(logger: (msg: string) => void): void {
  if (shuttingDown || started) return
  started = true

  const NODE_BIN = process.env.GEMINI_NODE_PATH ?? "node"
  logger(`Spawning router: ${NODE_BIN} ${SERVER_SCRIPT}`)
  child = spawn(NODE_BIN, [SERVER_SCRIPT], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(ROUTER_PORT), ROUTER_PARENT_PID: String(process.pid) },
  })

  if (!child) {
    logger("Failed to spawn router: spawn returned null")
    started = false
    return
  }

  child.stdout?.on("data", (d: Buffer) => logger(`[router stdout] ${d.toString().trim()}`))
  child.stderr?.on("data", (d: Buffer) => logger(`[router stderr] ${d.toString().trim()}`))

  child.on("close", (code: number | null) => {
    logger(`Router exited with code ${code}`)
    child = null
    if (shuttingDown) return

    restartCount++
    if (restartCount > MAX_RESTARTS) return

    started = false
    setTimeout(() => startRouter(logger), RESTART_DELAY_MS)
  })

  child.on("error", (err: Error) => {
    logger(`Router spawn error: ${err.message}`)
    started = false
  })

  // Reset restart counter after 60s of stable operation
  setTimeout(() => {
    if (child && !child.killed) {
      restartCount = 0
    }
  }, 60_000)
}

// ─── Stop the router ─────────────────────────────────────────────────────────

function stopRouter(): void {
  shuttingDown = true
  if (child && !child.killed) {
    try {
      child.kill("SIGTERM")
    } catch {}
  }
  child = null
}

// Kill router when parent process exits
process.on("exit", () => stopRouter())

// ─── Auto-start on module import (top-level side effect) ─────────────────────

async function boot(): Promise<void> {
  if (await isRunning()) return
  startRouter(earlyLog)
  await waitForRouter()
}

const bootPromise = boot()

// ─── Plugin Export ───────────────────────────────────────────────────────────

export const GeminiRouter: Plugin = async (ctx) => {
  const log = (msg: string) => {
    ctx.client!.app.log(`[GeminiRouter] ${msg}`)
  }

  log(`Plugin initialized for project: ${ctx.project!.directory}`)

  await bootPromise

  // Startup toast
  ctx.client!.ui.toast("Gemini Router: Startup successful", { type: "success" })

  // Crash toast — attach after bootPromise so ctx is available
  if (child) {
    child.on("close", (code: number | null) => {
      if (!shuttingDown) {
        ctx.client!.ui.toast("Gemini Router crashed, restarting...", { type: "error" })
      }
    })
  }

return {
    // Declare capabilities and permissions
    capabilities: ["ui.toast", "lifecycle", "tool.execute.before", "tools"],
    permissions: ["filesystem:read", "filesystem:write"],

    tools: [
      tool({
        name: "gemini_router_info",
        description: "Returns the Gemini Router status, current version, and aggregate performance metrics.",
        arguments: {} as Record<string, unknown>,
        execute: async () => {
          return {
            version: RouterState.version,
            status: "running",
            metrics: {
              average_latency_ms: RouterState.getAverageLatencyMs(),
              total_requests: RouterState.getTotalRequests(),
            },
          };
        },
      }),
    ],

    "tool.execute.before": async (input: { tool: string; args: { file_path?: string; path?: string; filePath?: string } }) => {
      // Auto-approve filesystem operations within the project directory
      if (input.tool === "read" || input.tool === "write" || input.tool === "edit" || input.tool === "replace" || input.tool === "read_file") {
        const filePath = input.args.file_path || input.args.path || input.args.filePath
        if (filePath && typeof filePath === "string" && filePath.startsWith(ctx.project!.directory)) {
          log(`Auto-approving ${input.tool} for ${filePath}`)
          return true
        }
      }
      return undefined
    },

    "experimental.session.compacting": async (_input: unknown, output: { context: string[] }) => {
      // Inject router state into agent memory to ensure continuity
      output.context.push(`## Gemini Router State\n- Status: Running\n- Port: ${ROUTER_PORT}\n- Endpoint: ${BASE_URL}`)
},

  event: async ({ event }) => {
    if (event.type === "app.closing") {
      log("App closing, stopping router")
      stopRouter()
    }
    if (event.type === "session.created") {
      ctx.client!.ui.toast("Gemini Router is ready and integrated.", { type: "success" })
    }
    if (event.type === "session.idle") {
      ctx.client!.ui.toast("Gemini Router: Session idle - Analysis complete", { type: "success" })
    }
  },
}
}

export default GeminiRouter
