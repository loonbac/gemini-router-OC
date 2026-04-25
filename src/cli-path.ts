/**
 * cli-path.ts — Resolves the gemini CLI binary path
 *
 * Resolution order:
 * 1. GEMINI_CLI_PATH environment variable (highest priority)
 * 2. `execSync('which gemini')` — standard PATH lookup
 * 3. `execSync('command -v gemini')` — fallback for shells without `which`
 * 4. Throws descriptive error with installation instructions
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export interface CliResolutionResult {
  path: string;
  strategy: "env" | "which" | "command-v" | "npm-prefix";
}

let cachedPath: string | null = null;
let cachedStrategy: CliResolutionResult["strategy"] | null = null;

/**
 * Clears the cached CLI path resolution.
 * Exported for testing purposes.
 */
export function clearCache(): void {
  cachedPath = null;
  cachedStrategy = null;
}

function doResolve(): CliResolutionResult {
  // Strategy 1: GEMINI_CLI_PATH env var
  const envPath = process.env.GEMINI_CLI_PATH;
  if (envPath && envPath.trim() !== "") {
    return { path: envPath.trim(), strategy: "env" };
  }

  // Strategy 2: `which gemini`
  try {
    const whichPath = execSync("which gemini", { encoding: "utf-8", timeout: 5000 }).trim();
    if (whichPath && existsSync(whichPath)) {
      return { path: whichPath, strategy: "which" };
    }
  } catch {
    // which failed — try next strategy
  }

  // Strategy 3: `command -v gemini` (fallback for shells without `which`)
  try {
    const commandVPath = execSync("command -v gemini", { encoding: "utf-8", timeout: 5000 }).trim();
    if (commandVPath && existsSync(commandVPath)) {
      return { path: commandVPath, strategy: "command-v" };
    }
  } catch {
    // command -v also failed
  }

  // Strategy 4: Try npm global prefix as last resort
  try {
    const npmPrefix = execSync("npm config get prefix", { encoding: "utf-8", timeout: 5000 }).trim();
    const npmGlobalGemini = join(npmPrefix, "bin", "gemini");
    if (existsSync(npmGlobalGemini)) {
      return { path: npmGlobalGemini, strategy: "npm-prefix" };
    }
  } catch {
    // npm prefix also failed — give up
  }

  // All strategies failed — throw descriptive error
  const errorLines = [
    "gemini CLI not found. Please install it first:",
    "",
    "  # Via npm (global)",
    "  npm install -g @google/gemini-cli",
    "",
    "  # Or set the path manually:",
    `  export GEMINI_CLI_PATH="/path/to/your/gemini"`,
    "",
    "Once installed, the CLI should be available on your PATH.",
    "You can verify with: which gemini",
  ];
  throw new Error(errorLines.join("\n"));
}

/**
 * Resolves the gemini CLI binary path using cascading strategy.
 * Returns just the path string (backward compatible).
 * Caches the result after first resolution.
 */
export function resolveCliPath(): string {
  if (cachedPath !== null) return cachedPath;

  const result = doResolve();
  cachedPath = result.path;
  cachedStrategy = result.strategy;
  return cachedPath;
}

/**
 * Resolves the gemini CLI binary path with strategy information.
 * Use this when you need to know which resolution strategy was used.
 */
export function resolveCliPathWithStrategy(): CliResolutionResult {
  if (cachedPath !== null && cachedStrategy !== null) {
    return { path: cachedPath, strategy: cachedStrategy };
  }

  const result = doResolve();
  cachedPath = result.path;
  cachedStrategy = result.strategy;
  return result;
}
