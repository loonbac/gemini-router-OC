/**
 * uninstall.ts — Uninstalls the gemini-router systemd user service
 */

import { execSync, type ExecSyncOptions } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

function systemctl(args: string[], ignoreErrors = false): void {
  const options: ExecSyncOptions = { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };
  try {
    execSync(`systemctl --user ${args.join(" ")}`, options);
  } catch (err) {
    if (!ignoreErrors) throw err;
  }
}

function removeUnitFile(): void {
  if (existsSync(UNIT_FILE_PATH)) {
    unlinkSync(UNIT_FILE_PATH);
  }
}

function daemonReload(): void {
  systemctl(["daemon-reload"], true);
}

/**
 * Uninstalls the gemini-router systemd user service.
 * Stops, disables, removes unit file, and reloads systemd.
 * Idempotent — safe to call even if service doesn't exist.
 */
export async function uninstallService(): Promise<void> {
  if (!isSystemdAvailable()) {
    console.warn(
      "Warning: systemd is not available on this system.\n" +
      "No service to uninstall."
    );
    return;
  }

  console.log("Uninstalling gemini-router service...");

  // Stop if running (ignore errors if already stopped)
  systemctl(["stop", "gemini-router"], true);
  console.log("  Stopped service");

  // Disable if enabled (ignore errors if not enabled)
  systemctl(["disable", "gemini-router"], true);
  console.log("  Disabled service");

  // Remove unit file (ignore if not exists)
  if (existsSync(UNIT_FILE_PATH)) {
    removeUnitFile();
    console.log(`  Removed unit file: ${UNIT_FILE_PATH}`);
  } else {
    console.log("  No unit file found (already removed?)");
  }

  // Reload daemon
  daemonReload();
  console.log("  Reloaded systemd daemon");

  console.log("\nService uninstalled successfully!");
}
