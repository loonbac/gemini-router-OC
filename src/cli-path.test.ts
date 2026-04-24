/**
 * cli-path.test.ts — Comprehensive tests for CLI path resolution
 *
 * Tests all resolution strategies without touching the real filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { existsSync } from "fs";

// Mock child_process and fs BEFORE importing the module under test
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

// Import after mocks are set up
import { resolveCliPath, resolveCliPathWithStrategy, clearCache } from "./cli-path.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);

describe("cli-path resolution", () => {
  beforeEach(() => {
    clearCache();
    vi.resetAllMocks();
    delete process.env.GEMINI_CLI_PATH;
  });

  afterEach(() => {
    delete process.env.GEMINI_CLI_PATH;
  });

  // ─── Strategy 1: Environment Variable ─────────────────────────────

  describe("Strategy 1: GEMINI_CLI_PATH env var", () => {
    it("returns env var when set", () => {
      process.env.GEMINI_CLI_PATH = "/custom/path/to/gemini";
      const result = resolveCliPath();
      expect(result).toBe("/custom/path/to/gemini");
    });

    it("trims whitespace from env var", () => {
      process.env.GEMINI_CLI_PATH = "  /custom/path/to/gemini  ";
      const result = resolveCliPath();
      expect(result).toBe("/custom/path/to/gemini");
    });

    it("does NOT fall back to which when env var is set", () => {
      process.env.GEMINI_CLI_PATH = "/env/path/gemini";
      resolveCliPath();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("ignores empty env var", () => {
      process.env.GEMINI_CLI_PATH = "   ";
      mockExecSync.mockImplementationOnce(() => "/usr/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      const result = resolveCliPath();
      expect(result).toBe("/usr/bin/gemini");
    });

    it("reports strategy 'env' when resolved via env var", () => {
      process.env.GEMINI_CLI_PATH = "/my/gemini";
      const result = resolveCliPathWithStrategy();
      expect(result).toEqual({ path: "/my/gemini", strategy: "env" });
    });
  });

  // ─── Strategy 2: `which gemini` ──────────────────────────────────

  describe("Strategy 2: which gemini", () => {
    it("returns path from which when env var not set", () => {
      mockExecSync.mockImplementationOnce(() => "/usr/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      const result = resolveCliPath();
      expect(result).toBe("/usr/bin/gemini");
    });

    it("trims newline from which output", () => {
      mockExecSync.mockImplementationOnce(() => "/usr/local/bin/gemini\r\n");
      mockExistsSync.mockReturnValue(true);
      const result = resolveCliPath();
      expect(result).toBe("/usr/local/bin/gemini");
    });

    it("calls which with correct command", () => {
      mockExecSync.mockImplementationOnce(() => "/usr/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      resolveCliPath();
      expect(mockExecSync).toHaveBeenCalledWith("which gemini", {
        encoding: "utf-8",
        timeout: 5000,
      });
    });

    it("reports strategy 'which' when resolved via which", () => {
      mockExecSync.mockImplementationOnce(() => "/usr/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      const result = resolveCliPathWithStrategy();
      expect(result.strategy).toBe("which");
    });

    it("falls back to command -v when which returns path that doesn't exist on disk", () => {
      mockExecSync.mockImplementationOnce(() => "/stale/path/gemini\n");
      mockExistsSync.mockReturnValueOnce(false); // first existsSync (for which result) returns false
      mockExecSync.mockImplementationOnce(() => "/real/path/gemini\n");
      mockExistsSync.mockReturnValueOnce(true); // second existsSync (for command -v result) returns true
      const result = resolveCliPath();
      expect(result).toBe("/real/path/gemini");
    });
  });

  // ─── Strategy 3: `command -v gemini` ─────────────────────────────

  describe("Strategy 3: command -v gemini", () => {
    it("falls back to command -v when which fails", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which: not found");
      });
      mockExecSync.mockImplementationOnce(() => "/usr/local/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      const result = resolveCliPath();
      expect(result).toBe("/usr/local/bin/gemini");
    });

    it("calls command -v with correct command", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => "/usr/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      resolveCliPath();
      expect(mockExecSync).toHaveBeenCalledWith("command -v gemini", {
        encoding: "utf-8",
        timeout: 5000,
      });
    });

    it("reports strategy 'command-v' when resolved via command -v", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => "/usr/bin/gemini\n");
      mockExistsSync.mockReturnValue(true);
      const result = resolveCliPathWithStrategy();
      expect(result.strategy).toBe("command-v");
    });

    it("falls back to npm prefix when command -v also fails", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("command -v failed");
      });
      mockExecSync.mockImplementationOnce(() => "/home/user/.npm-global\n");
      mockExistsSync.mockReturnValueOnce(true); // npm prefix gemini exists
      const result = resolveCliPath();
      expect(result).toBe("/home/user/.npm-global/bin/gemini");
    });

    it("falls back to npm prefix when command -v returns non-existent path", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => "/stale/path\n");
      mockExistsSync.mockReturnValueOnce(false); // command -v result doesn't exist
      mockExecSync.mockImplementationOnce(() => "/home/user/.npm-global\n");
      mockExistsSync.mockReturnValueOnce(true); // npm prefix gemini exists
      const result = resolveCliPath();
      expect(result).toBe("/home/user/.npm-global/bin/gemini");
    });
  });

  // ─── Strategy 4: npm prefix fallback ─────────────────────────────

  describe("Strategy 4: npm prefix fallback", () => {
    it("checks npm global prefix when all else fails", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("command -v failed");
      });
      mockExecSync.mockImplementationOnce(() => "/home/user/.npm-global\n");
      mockExistsSync.mockReturnValueOnce(true);
      resolveCliPath();
      expect(mockExecSync).toHaveBeenCalledWith("npm config get prefix", {
        encoding: "utf-8",
        timeout: 5000,
      });
    });

    it("reports strategy 'npm-prefix' when resolved via npm prefix", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("command -v failed");
      });
      mockExecSync.mockImplementationOnce(() => "/usr/local\n");
      mockExistsSync.mockReturnValueOnce(true);
      const result = resolveCliPathWithStrategy();
      expect(result.strategy).toBe("npm-prefix");
    });
  });

  // ─── Error: CLI not found ────────────────────────────────────────

  describe("Error: CLI not found", () => {
    it("throws descriptive error when all strategies fail", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockExistsSync.mockReturnValue(false);
      expect(() => resolveCliPath()).toThrow("gemini CLI not found");
    });

    it("error message includes installation instructions", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockExistsSync.mockReturnValue(false);
      expect(() => resolveCliPath()).toThrow("npm install -g");
    });

    it("error message includes GEMINI_CLI_PATH suggestion", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockExistsSync.mockReturnValue(false);
      expect(() => resolveCliPath()).toThrow("GEMINI_CLI_PATH");
    });

    it("error message includes 'which gemini' verification", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not found");
      });
      mockExistsSync.mockReturnValue(false);
      expect(() => resolveCliPath()).toThrow("which gemini");
    });
  });

  // ─── Caching ─────────────────────────────────────────────────────

  describe("Caching behavior", () => {
    it("caches the resolved path after first call", () => {
      process.env.GEMINI_CLI_PATH = "/cached/path";
      const first = resolveCliPath();

      // Change env var and clear — but don't clear cache
      delete process.env.GEMINI_CLI_PATH;
      const second = resolveCliPath();

      expect(first).toBe("/cached/path");
      expect(second).toBe("/cached/path"); // still cached
    });

    it("clearCache allows re-resolution", () => {
      process.env.GEMINI_CLI_PATH = "/first/path";
      const first = resolveCliPath();
      expect(first).toBe("/first/path");

      clearCache();
      process.env.GEMINI_CLI_PATH = "/second/path";
      const second = resolveCliPath();
      expect(second).toBe("/second/path");
    });

    it("caches strategy information too", () => {
      process.env.GEMINI_CLI_PATH = "/env/path";
      const result = resolveCliPathWithStrategy();
      expect(result.strategy).toBe("env");

      // Second call should also return cached strategy
      const cached = resolveCliPathWithStrategy();
      expect(cached.strategy).toBe("env");
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("handles which returning empty string", () => {
      mockExecSync.mockImplementationOnce(() => "\n");
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("command -v failed");
      });
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("npm prefix failed");
      });
      mockExistsSync.mockReturnValue(false);
      expect(() => resolveCliPath()).toThrow("gemini CLI not found");
    });

    it("handles npm prefix returning path but gemini binary doesn't exist there", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("which failed");
      });
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("command -v failed");
      });
      mockExecSync.mockImplementationOnce(() => "/some/npm/prefix\n");
      mockExistsSync.mockReturnValue(false); // gemini doesn't exist in npm prefix
      expect(() => resolveCliPath()).toThrow("gemini CLI not found");
    });

    it("handles npm prefix command failing entirely", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("all commands failed");
      });
      mockExistsSync.mockReturnValue(false);
      expect(() => resolveCliPath()).toThrow("gemini CLI not found");
    });

    it("prefers env var over which even when both are available", () => {
      process.env.GEMINI_CLI_PATH = "/env/override";
      // If which were called, it would throw — but it shouldn't be called
      mockExecSync.mockImplementation(() => {
        throw new Error("which should not be called!");
      });
      const result = resolveCliPath();
      expect(result).toBe("/env/override");
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });
});
