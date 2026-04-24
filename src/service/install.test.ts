/**
 * install.test.ts — Comprehensive tests for service installation
 *
 * All child_process and fs operations are mocked — no real systemd interaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../cli-path.js", () => ({
  resolveCliPath: () => "/usr/local/bin/gemini",
}));

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { installService } from "./install.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

const SYSTEMD_DIR = "/home/testuser/.config/systemd/user";
const UNIT_FILE = `${SYSTEMD_DIR}/gemini-router.service`;

describe("installService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: systemd is available
    mockExecSync.mockReturnValue("");
    // Default: directory doesn't exist yet
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Basic behavior ──────────────────────────────────────────────

  it("is an async function", () => {
    expect(installService).toBeDefined();
    expect(typeof installService).toBe("function");
  });

  it("returns a Promise", () => {
    const result = installService();
    expect(result).toBeInstanceOf(Promise);
  });

  // ─── Systemd detection ───────────────────────────────────────────

  describe("systemd detection", () => {
    it("checks if systemd is available via systemctl --user status", async () => {
      await installService();
      expect(mockExecSync).toHaveBeenCalledWith("systemctl --user status", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    });

    it("warns and returns early when systemd is not available", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("systemctl not found");
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await installService();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("systemd is not available")
      );
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("shows manual start instructions when systemd unavailable", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("systemctl not found");
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await installService();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("npm start")
      );
      warnSpy.mockRestore();
    });
  });

  // ─── Directory creation ──────────────────────────────────────────

  describe("directory creation", () => {
    it("creates systemd user directory if it doesn't exist", async () => {
      mockExistsSync.mockReturnValue(false);
      await installService();
      expect(mockMkdirSync).toHaveBeenCalledWith(SYSTEMD_DIR, { recursive: true });
    });

    it("doesn't create directory if it already exists", async () => {
      mockExistsSync.mockReturnValue(true);
      await installService();
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  // ─── Unit file writing ───────────────────────────────────────────

  describe("unit file writing", () => {
    it("writes unit file to correct path", async () => {
      await installService();
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        UNIT_FILE,
        expect.any(String),
        "utf-8"
      );
    });

    it("writes unit file with all required sections", async () => {
      await installService();
      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain("[Unit]");
      expect(content).toContain("[Service]");
      expect(content).toContain("[Install]");
    });

    it("sets correct GEMINI_CLI_PATH in unit file", async () => {
      await installService();
      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain("GEMINI_CLI_PATH=/usr/local/bin/gemini");
    });

    it("sets default port 4789 in unit file", async () => {
      await installService();
      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain("PORT=4789");
    });

    it("uses custom port when provided", async () => {
      await installService({ port: 9000 });
      const content = mockWriteFileSync.mock.calls[0][1] as string;
      expect(content).toContain("PORT=9000");
    });
  });

  // ─── Systemctl commands ──────────────────────────────────────────

  describe("systemctl commands", () => {
    it("runs daemon-reload after writing unit file", async () => {
      await installService();
      expect(mockExecSync).toHaveBeenCalledWith(
        "systemctl --user daemon-reload",
        expect.objectContaining({ encoding: "utf-8" })
      );
    });

    it("enables the service after daemon-reload", async () => {
      const calls: string[] = [];
      mockExecSync.mockImplementation((cmd) => {
        calls.push(cmd as string);
        return "";
      });

      await installService();

      const daemonReloadIdx = calls.indexOf("systemctl --user daemon-reload");
      const enableIdx = calls.indexOf("systemctl --user enable gemini-router");
      expect(enableIdx).toBeGreaterThan(daemonReloadIdx);
    });

    it("starts the service after enabling", async () => {
      const calls: string[] = [];
      mockExecSync.mockImplementation((cmd) => {
        calls.push(cmd as string);
        return "";
      });

      await installService();

      const enableIdx = calls.indexOf("systemctl --user enable gemini-router");
      const startIdx = calls.indexOf("systemctl --user start gemini-router");
      expect(startIdx).toBeGreaterThan(enableIdx);
    });

    it("handles start failure gracefully with warning", async () => {
      let callCount = 0;
      mockExecSync.mockImplementation((cmd) => {
        callCount++;
        // The 4th call is start (1:status, 2:daemon-reload, 3:enable, 4:start)
        if (cmd === "systemctl --user start gemini-router") {
          throw new Error("Failed to start");
        }
        return "";
      });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await installService();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Warning")
      );
      warnSpy.mockRestore();
    });
  });

  // ─── Success output ──────────────────────────────────────────────

  describe("success output", () => {
    it("prints success message after installation", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await installService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Service installed successfully")
      );
      logSpy.mockRestore();
    });

    it("prints port in output", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await installService({ port: 8080 });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("8080")
      );
      logSpy.mockRestore();
    });

    it("prints CLI path in output", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await installService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("/usr/local/bin/gemini")
      );
      logSpy.mockRestore();
    });
  });
});
