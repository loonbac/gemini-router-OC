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

const LOG = join(homedir(), "gemini-router-plugin.log")
function log(msg: string) {
  appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
}

// Resolve the router's dist/server.js relative to THIS file's location
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SERVER_SCRIPT = join(__dirname, "server.js") // dist/server.js next to dist/plugin.js

// ─── Configuration ───────────────────────────────────────────────────────────

const ROUTER_PORT = Number(process.env.GEMINI_ROUTER_PORT ?? "4789")
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

// ─── Health check ───────────────────────────────────────────────────────────

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

function startRouter(): void {
  if (shuttingDown || started) return
  started = true

  const NODE_BIN = process.env.GEMINI_NODE_PATH ?? "node"
  log(`Spawning router: ${NODE_BIN} ${SERVER_SCRIPT}`)
  child = spawn(NODE_BIN, [SERVER_SCRIPT], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(ROUTER_PORT), ROUTER_PARENT_PID: String(process.pid) },
  })

  child.stdout?.on("data", (d: Buffer) => log(`[router stdout] ${d.toString().trim()}`))
  child.stderr?.on("data", (d: Buffer) => log(`[router stderr] ${d.toString().trim()}`))

  child.on("close", (code: number | null) => {
    log(`Router exited with code ${code}`)
    child = null
    if (shuttingDown) return

    restartCount++
    if (restartCount > MAX_RESTARTS) return

    started = false
    setTimeout(() => startRouter(), RESTART_DELAY_MS)
  })

  child.on("error", (err: Error) => {
    log(`Router spawn error: ${err.message}`)
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
  log(`Module imported. execPath=${process.execPath}`)
  if (await isRunning()) {
    log("Router already running")
    return
  }
  startRouter()
  await waitForRouter()
  log(`Router ready: ${await isRunning()}`)
}

const bootPromise = boot()

// ─── Plugin Export ───────────────────────────────────────────────────────────

export const GeminiRouter: Plugin = async (_ctx) => {
  log("Plugin function called")
  await bootPromise
  log("Plugin initialized, router should be running")

  return {
    event: async ({ event }) => {
      if (event.type === "app.closing") {
        log("App closing, stopping router")
        stopRouter()
      }
    },
  }
}

export default GeminiRouter
