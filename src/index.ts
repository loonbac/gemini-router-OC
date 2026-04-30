/**
 * index.ts — Entry point that starts the Hono server with EADDRINUSE handling.
 */

import { serve } from "@hono/node-server";
import http from "node:http";
import { app, activeProcesses } from "./server.js";
import { resolveEffectivePort } from "./user-port.js";
import { logger } from "./logger.js";

const PORT = resolveEffectivePort();

// ---------------------------------------------------------------------------
// Health probe — check if the process on that port is ours
// ---------------------------------------------------------------------------

async function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown — kill all active child processes
// ---------------------------------------------------------------------------

async function shutdown() {
  for (const kill of activeProcesses) kill();
  activeProcesses.clear();
}

process.on("SIGTERM", async () => { await shutdown(); process.exit(0); });
process.on("SIGINT", async () => { await shutdown(); process.exit(0); });

// Auto-shutdown when parent process dies
const parentPid = process.env.ROUTER_PARENT_PID;
if (parentPid) {
  setInterval(() => {
    try { process.kill(Number(parentPid), 0); } catch { process.exit(0); }
  }, 3000);
}

// ---------------------------------------------------------------------------
// Export start function for programmatic use
// ---------------------------------------------------------------------------

export async function start(): Promise<{ close: () => void; addr: { port: number } }> {
  return new Promise((resolve, reject) => {
    let server: ReturnType<typeof serve>;
    server = serve({ fetch: app.fetch, port: PORT }, () => {
      resolve({
        close: () => server.close(),
        addr: server.address() as { port: number },
      });
    });

    server.on("error", async (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        const isOurProcess = await probeHealth(PORT);
        if (isOurProcess) {
          process.exit(0);
        }
        logger.error(`Port ${PORT} is occupied by a non-router process. Exiting with error.`);
        process.exit(1);
      }
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Auto-start on module import (when not in test mode)
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== "test") {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}