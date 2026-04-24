#!/usr/bin/env node
/**
 * index.ts — CLI entry point for service management
 *
 * Usage:
 *   gemini-router-service install [--port <port>]
 *   gemini-router-service uninstall
 */

import { installService } from "./install.js";
import { uninstallService } from "./uninstall.js";

type Subcommand = "install" | "uninstall";

function parseArgs(): { subcommand: Subcommand | null; port?: number } {
  const args = process.argv.slice(2);
  let subcommand: Subcommand | null = null;
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "install") {
      subcommand = "install";
    } else if (arg === "uninstall") {
      subcommand = "uninstall";
    } else if (arg === "--port" && i + 1 < args.length) {
      port = Number(args[i + 1]);
      i++;
    }
  }

  return { subcommand, port };
}

async function printHelp(): Promise<void> {
  console.log(`gemini-router-service — Manage the gemini-router systemd user service

Usage:
  gemini-router-service install [--port <port>]
    Install and enable the gemini-router service.
    The service will start automatically on login.

  gemini-router-service uninstall
    Stop, disable, and remove the gemini-router service.

Examples:
  gemini-router-service install
  gemini-router-service install --port 9000
  gemini-router-service uninstall
`);
}

async function main(): Promise<void> {
  const { subcommand, port } = parseArgs();

  if (!subcommand) {
    await printHelp();
    process.exit(0);
    return;
  }

  if (subcommand === "install") {
    try {
      await installService({ port });
    } catch (err) {
      console.error("Failed to install service:", err);
      process.exit(1);
    }
  } else if (subcommand === "uninstall") {
    try {
      await uninstallService();
    } catch (err) {
      console.error("Failed to uninstall service:", err);
      process.exit(1);
    }
  } else {
    await printHelp();
    process.exit(1);
  }
}

main();
