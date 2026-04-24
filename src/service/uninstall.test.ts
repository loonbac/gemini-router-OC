/**
 * uninstall.test.ts — Comprehensive tests for service uninstallation
 *
 * All child_process and fs operations are mocked — no real systemd interaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { homedir } from "os";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
}));

import { uninstallService } from "./uninstall.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

const UNIT_FILE = "/home/testuser/.config/systemd/user/gemini-router.service";

describe("uninstallService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: systemd is available
    mockExecSync.mockReturnValue("");
    // Default: unit file exists
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Basic behavior ──────────────────────────────────────────────

  it("is an async function", () => {
    expect(uninstallService).toBeDefined();
    expect(typeof uninstallService).toBe("function");
  });

  it("returns a Promise", () => {
    const result = uninstallService();
    expect(result).toBeInstanceOf(Promise);
  });

  // ─── Systemd detection ───────────────────────────────────────────

  describe("systemd detection", () => {
    it("checks if systemd is available", async () => {
      await uninstallService();
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

      await uninstallService();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("systemd is not available")
      );
      expect(mockUnlinkSync).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ─── Stop service ────────────────────────────────────────────────

  describe("stop service", () => {
    it("stops the service", async () => {
      await uninstallService();
      expect(mockExecSync).toHaveBeenCalledWith(
        "systemctl --user stop gemini-router",
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
      );
    });

    it("ignores errors when stopping (already stopped)", async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd === "systemctl --user stop gemini-router") {
          throw new Error("Service not running");
        }
        return "";
      });

      // Should NOT throw
      await expect(uninstallService()).resolves.toBeUndefined();
    });
  });

  // ─── Disable service ─────────────────────────────────────────────

  describe("disable service", () => {
    it("disables the service", async () => {
      await uninstallService();
      expect(mockExecSync).toHaveBeenCalledWith(
        "systemctl --user disable gemini-router",
        expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
      );
    });

    it("ignores errors when disabling (already disabled)", async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd === "systemctl --user disable gemini-router") {
          throw new Error("Service not enabled");
        }
        return "";
      });

      // Should NOT throw
      await expect(uninstallService()).resolves.toBeUndefined();
    });

    it("runs disable after stop", async () => {
      const calls: string[] = [];
      mockExecSync.mockImplementation((cmd) => {
        calls.push(cmd as string);
        return "";
      });

      await uninstallService();

      const stopIdx = calls.indexOf("systemctl --user stop gemini-router");
      const disableIdx = calls.indexOf("systemctl --user disable gemini-router");
      expect(disableIdx).toBeGreaterThan(stopIdx);
    });
  });

  // ─── Remove unit file ────────────────────────────────────────────

  describe("remove unit file", () => {
    it("removes unit file when it exists", async () => {
      mockExistsSync.mockReturnValue(true);
      await uninstallService();
      expect(mockUnlinkSync).toHaveBeenCalledWith(UNIT_FILE);
    });

    it("doesn't attempt removal when unit file doesn't exist", async () => {
      mockExistsSync.mockReturnValue(false);
      await uninstallService();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it("checks the correct unit file path", async () => {
      await uninstallService();
      expect(mockExistsSync).toHaveBeenCalledWith(UNIT_FILE);
    });

    it("prints message when no unit file found", async () => {
      mockExistsSync.mockReturnValue(false);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await uninstallService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("No unit file found")
      );
      logSpy.mockRestore();
    });
  });

  // ─── Daemon reload ───────────────────────────────────────────────

  describe("daemon reload", () => {
    it("runs daemon-reload after cleanup", async () => {
      const calls: string[] = [];
      mockExecSync.mockImplementation((cmd) => {
        calls.push(cmd as string);
        return "";
      });

      await uninstallService();

      const reloadIdx = calls.lastIndexOf("systemctl --user daemon-reload");
      const stopIdx = calls.indexOf("systemctl --user stop gemini-router");
      const disableIdx = calls.indexOf("systemctl --user disable gemini-router");
      expect(reloadIdx).toBeGreaterThan(stopIdx);
      expect(reloadIdx).toBeGreaterThan(disableIdx);
    });
  });

  // ─── Idempotency ─────────────────────────────────────────────────

  describe("idempotency", () => {
    it("completes without errors when service never existed", async () => {
      // systemctl commands fail, unit file doesn't exist
      mockExecSync.mockImplementation(() => {
        throw new Error("Service not found");
      });
      mockExistsSync.mockReturnValue(false);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(uninstallService()).resolves.toBeUndefined();

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("can be called twice without errors", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await uninstallService();
      mockExistsSync.mockReturnValue(false); // already removed
      await uninstallService();

      logSpy.mockRestore();
    });
  });

  // ─── Success output ──────────────────────────────────────────────

  describe("success output", () => {
    it("prints success message", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await uninstallService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Service uninstalled successfully")
      );
      logSpy.mockRestore();
    });

    it("prints stop message", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await uninstallService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Stopped service")
      );
      logSpy.mockRestore();
    });

    it("prints disable message", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await uninstallService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Disabled service")
      );
      logSpy.mockRestore();
    });

    it("prints unit file path when removed", async () => {
      mockExistsSync.mockReturnValue(true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await uninstallService();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(UNIT_FILE)
      );
      logSpy.mockRestore();
    });
  });

  // ─── Command ordering ────────────────────────────────────────────

  describe("command ordering", () => {
    it("executes all systemctl commands in correct order: stop → disable → daemon-reload", async () => {
      const calls: string[] = [];
      mockExecSync.mockImplementation((cmd) => {
        calls.push(cmd as string);
        return "";
      });

      await uninstallService();

      const relevantCalls = calls.filter(c => c.startsWith("systemctl"));
      const stopIdx = relevantCalls.indexOf("systemctl --user stop gemini-router");
      const disableIdx = relevantCalls.indexOf("systemctl --user disable gemini-router");
      const reloadIdx = relevantCalls.indexOf("systemctl --user daemon-reload");

      expect(stopIdx).toBeLessThan(disableIdx);
      expect(disableIdx).toBeLessThan(reloadIdx);
    });
  });
});
