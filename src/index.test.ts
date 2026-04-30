/**
 * index.test.ts — Tests for src/index.ts entry point
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";

// Mock user-port module
const mockGetUserPort = vi.hoisted(() => vi.fn(() => 47890));
const mockResolveEffectivePort = vi.hoisted(() => vi.fn(() => 47890));
vi.mock("./user-port.js", () => ({
  getUserPort: mockGetUserPort,
  resolveEffectivePort: mockResolveEffectivePort,
}));

// Mock serve to avoid actual server startup
const mockServer = {
  close: vi.fn(),
  address: () => ({ port: 47890 }),
  on: vi.fn(),
};
vi.mock("@hono/node-server", () => ({
  serve: vi.fn((_opts, onListen) => {
    // Call onListen immediately so the Promise resolves
    // Use queueMicrotask to match how @hono/node-server calls the callback
    queueMicrotask(() => { if (onListen) onListen(); });
    return mockServer;
  }),
}));

describe("index.ts entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("module structure", () => {
    it("exports a start function", async () => {
      const mod = await import("./index.js");
      expect(typeof mod.start).toBe("function");
    });
  });

  describe("start function", () => {
    it("calls serve with app.fetch and resolved port", async () => {
      const { serve } = await import("@hono/node-server");
      const mod = await import("./index.js");

      await mod.start();

      expect(serve).toHaveBeenCalledWith(
        expect.objectContaining({ port: 47890 }),
        expect.any(Function)
      );
    });

    it("returns a server object with close and addr", async () => {
      const mod = await import("./index.js");
      const server = await mod.start();

      expect(server).toBeDefined();
      expect(typeof server.close).toBe("function");
      expect(server.addr).toBeDefined();
      expect(server.addr.port).toBe(47890);
    });
  });
});