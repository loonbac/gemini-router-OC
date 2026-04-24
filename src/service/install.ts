/**
 * install.ts — Installs the gemini-router systemd user service
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolveCliPath } from "../cli-path.js";
import { generateServiceUnit, type ServiceConfig } from "./template.js";
import { getUserPort } from "../user-port.js";

const SYSTEMD_USER_DIR = join(homedir(), ".config", "systemd", "user");
const UNIT_FILE_NAME = "gemini-router.service";
const UNIT_FILE_PATH = join(SYSTEMD_USER_DIR, UNIT_FILE_NAME);

function isSystemdAvailable(): boolean {
  try {
    execSync("systemctl --user status", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function ensureDirectory(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeUnitFile(content: string): void {
  ensureDirectory(SYSTEMD_USER_DIR);
  writeFileSync(UNIT_FILE_PATH, content, "utf-8");
}

function daemonReload(): void {
  execSync("systemctl --user daemon-reload", { encoding: "utf-8" });
}

function enableService(): void {
  execSync("systemctl --user enable gemini-router", { encoding: "utf-8" });
}

function startService(): void {
  try {
    execSync("systemctl --user start gemini-router", { encoding: "utf-8" });
  } catch (err) {
    // Service start might fail if the unit file isn't fully loaded yet
    // or if systemd is in a transitional state. Log but don't fail.
    console.warn("  Warning: Could not start service immediately. It will start on next login.");
  }
}

export interface InstallServiceOptions {
  port?: number;
}

/**
 * Installs the gemini-router systemd user service.
 * Detects CLI path, generates unit file, enables and starts the service.
 */
export async function installService(options: InstallServiceOptions = {}): Promise<void> {
  if (!isSystemdAvailable()) {
    console.warn(
      "Warning: systemd is not available on this system (possibly WSL or a container).\n" +
      "The service cannot be installed automatically.\n" +
      "You can run the server manually:\n" +
      "  npm start\n" +
      "  # or\n" +
      "  node dist/server.js\n"
    );
    return;
  }

  const port = options.port ?? Number(process.env.PORT ?? String(getUserPort()));
  const geminiCliPath = resolveCliPath();
  const nodePath = process.execPath;
  const workDir = process.env.GEMINI_WORKDIR ?? process.cwd();

  const config: ServiceConfig = {
    workDir,
    nodePath,
    geminiCliPath,
    port,
  };

  const unitContent = generateServiceUnit(config);

  console.log(`Installing gemini-router service...`);
  console.log(`  Port: ${port}`);
  console.log(`  CLI path: ${geminiCliPath}`);

  writeUnitFile(unitContent);
  console.log(`  Unit file: ${UNIT_FILE_PATH}`);

  daemonReload();
  console.log("  Reloaded systemd daemon");

  enableService();
  console.log("  Enabled service");

  startService();

  console.log("\nService installed successfully!");
  console.log("The service will start automatically on your next login.");
}
