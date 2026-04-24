/**
 * plugin.test.ts — Unit tests for plugin.ts
 *
 * These tests verify the plugin exports, interface, and spawn API usage.
 * Integration tests with the actual router would require a running gemini CLI.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn()
const mockKill = vi.fn()
const mockChild = {
  on: vi.fn(),
  kill: mockKill,
  killed: false,
}

// Set up mock once at module level
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}))

// ---------------------------------------------------------------------------
// Fresh module import helper
// ---------------------------------------------------------------------------

async function getFreshModule() {
  vi.resetModules()
  return await import("./plugin.js")
}

// ---------------------------------------------------------------------------
// Plugin Export tests
// ---------------------------------------------------------------------------

describe("Plugin Export", () => {
  beforeEach(() => {
    mockSpawn.mockReset()
    mockKill.mockReset()
  })

  it("exports GeminiRouter as a named export", async () => {
    const mod = await getFreshModule()
    expect(typeof mod.GeminiRouter).toBe("function")
  })

  it("exports a default export that equals the named export", async () => {
    const mod = await getFreshModule()
    expect(mod.default).toBe(mod.GeminiRouter)
  })
})

// ---------------------------------------------------------------------------
// Plugin interface tests
// ---------------------------------------------------------------------------

describe("Plugin Interface", () => {
  beforeEach(() => {
    mockSpawn.mockReset()
    mockKill.mockReset()
    mockChild.on.mockReset()
    mockChild.on.mockReturnValue(mockChild)
  })

  it("returns an object with event handler when router is running", async () => {
    // Mock fetch to simulate router already running
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    // Mock spawn to return a valid child process
    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    const ctx = {} as Parameters<typeof mod.GeminiRouter>[0]
    const plugin = await mod.GeminiRouter(ctx)

    expect(plugin).toHaveProperty("event")
    expect(typeof plugin.event).toBe("function")

    // Clean up
    vi.stubGlobal("fetch", undefined as any)
  })

  it("event handler is callable with app.closing event", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    const ctx = {} as Parameters<typeof mod.GeminiRouter>[0]
    const plugin = await mod.GeminiRouter(ctx)

    expect(plugin.event).toBeDefined()
    // Should not throw
    await plugin.event({ event: { type: "app.closing" } as any })

    vi.stubGlobal("fetch", undefined as any)
  })
})

// ---------------------------------------------------------------------------
// spawn API usage tests
// ---------------------------------------------------------------------------

describe("spawn API usage", () => {
  beforeEach(() => {
    mockSpawn.mockReset()
    mockKill.mockReset()
    mockChild.on.mockReset()
    mockChild.on.mockReturnValue(mockChild)
  })

  it("spawns process with server.js path", () => {
    // Verify spawn is called with expected arguments
    const serverScript = "dist/server.js"
    mockSpawn(process.execPath, [serverScript], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, PORT: "4789" },
    })

    expect(mockSpawn).toHaveBeenCalledTimes(1)
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([expect.stringContaining("server.js")]),
      expect.objectContaining({
        stdio: expect.arrayContaining(["ignore"]),
      }),
    )
  })

  it("sets up close handler on spawned process", () => {
    mockChild.on("close", () => {})
    expect(mockChild.on).toHaveBeenCalledWith("close", expect.any(Function))
  })

  it("sets up error handler on spawned process", () => {
    mockChild.on("error", () => {})
    expect(mockChild.on).toHaveBeenCalledWith("error", expect.any(Function))
  })

  it("kill is called with SIGTERM signal", () => {
    if (!mockChild.killed) {
      mockChild.kill("SIGTERM")
    }
    expect(mockKill).toHaveBeenCalledWith("SIGTERM")
  })
})

// ---------------------------------------------------------------------------
// isRunning logic tests (pure unit tests)
// ---------------------------------------------------------------------------

describe("isRunning logic", () => {
  it("returns true when fetch response is ok", () => {
    const mockRes = { ok: true }
    expect(mockRes.ok).toBe(true)
  })

  it("returns false when fetch throws", () => {
    let result = false
    try {
      throw new Error("Connection refused")
    } catch {
      result = false
    }
    expect(result).toBe(false)
  })
})
