/**
 * plugin.ts — OpenCode plugin for gemini-router
 *
 * Registers Gemini as a provider using the Gemini CLI (OAuth-based, no API key).
 * Starts an HTTP router that bridges Gemini CLI → OpenAI-compatible API.
 *
 * Auto-starts the router when OpenCode launches and auto-restarts on crash.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { spawn, type ChildProcess } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// Resolve the router's dist/server.js relative to THIS file's location
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SERVER_SCRIPT = join(__dirname, "server.js") // dist/server.js next to dist/plugin.js

// ─── Configuration ───────────────────────────────────────────────────────────

const ROUTER_PORT = Number(process.env.GEMINI_ROUTER_PORT ?? "4789")
const BASE_URL = `http://127.0.0.1:${ROUTER_PORT}/v1`
const RESTART_DELAY_MS = 2000
const MAX_RESTARTS = 5

// ─── State ───────────────────────────────────────────────────────────────────

let child: ChildProcess | null = null
let restartCount = 0
let shuttingDown = false

// ─── Health check ───────────────────────────────────────────────────────────

async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${ROUTER_PORT}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Spawn the router ───────────────────────────────────────────────────────

function startRouter(): void {
  if (shuttingDown) return

  child = spawn(process.execPath, [SERVER_SCRIPT], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, PORT: String(ROUTER_PORT) },
  })

  child.on("close", (code: number | null) => {
    child = null
    if (shuttingDown) return

    restartCount++
    if (restartCount > MAX_RESTARTS) return

    setTimeout(() => startRouter(), RESTART_DELAY_MS)
  })

  child.on("error", () => {})

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

// ─── Plugin Export ───────────────────────────────────────────────────────────

export const GeminiRouter: Plugin = async (_ctx) => {
  const running = await isRunning()
  if (!running) {
    startRouter()
    // Wait for router to start
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS))
  }

  return {
    event: async ({ event }) => {
      if (event.type === "app.closing") {
        stopRouter()
      }
    },
  }
}

export default GeminiRouter