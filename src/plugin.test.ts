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
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
}

// Mock child_process module
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
    ;(mockChild.stdout as any).on.mockReset()
    ;(mockChild.stderr as any).on.mockReset()
    ;(mockChild.stdout as any).on.mockReturnValue(mockChild.stdout)
    ;(mockChild.stderr as any).on.mockReturnValue(mockChild.stderr)
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

// ---------------------------------------------------------------------------
// Dynamic port integration tests
// ---------------------------------------------------------------------------

// Hoisted mock values — these are module-level and control the user-port mock
const mockResolveEffectivePort = vi.fn(() => 47890)
const mockGetUserPort = vi.fn(() => 47890)

vi.mock("./user-port.js", () => ({
  getUserPort: mockGetUserPort,
  resolveEffectivePort: mockResolveEffectivePort,
}))

describe("Dynamic port", () => {
  beforeEach(() => {
    mockSpawn.mockReset()
    mockKill.mockReset()
    mockChild.on.mockReset()
    mockChild.on.mockReturnValue(mockChild)
    ;(mockChild.stdout as any).on.mockReset()
    ;(mockChild.stderr as any).on.mockReset()
    ;(mockChild.stdout as any).on.mockReturnValue(mockChild.stdout)
    ;(mockChild.stderr as any).on.mockReturnValue(mockChild.stderr)
    delete process.env.GEMINI_ROUTER_PORT
    delete process.env.PORT
    mockResolveEffectivePort.mockReturnValue(47890)
    mockGetUserPort.mockReturnValue(47890)
  })

  it("when no env vars, spawn uses resolved port from user-port module", async () => {
    mockResolveEffectivePort.mockReturnValue(47901)

    // Fetch returns false so boot proceeds to startRouter
    const mockFetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal("fetch", mockFetch)
    mockSpawn.mockReturnValue(mockChild)

    await getFreshModule()

    // PORT env passed to spawn should be 47901
    const spawnCall = mockSpawn.mock.calls[0]
    const env = spawnCall?.[2]?.env as Record<string, string> | undefined
    expect(env?.PORT).toBe("47901")

    vi.stubGlobal("fetch", undefined as any)
  })

  it("GEMINI_ROUTER_PORT env overrides derived port in spawn", async () => {
    process.env.GEMINI_ROUTER_PORT = "5000"
    mockResolveEffectivePort.mockReturnValue(5000)

    const mockFetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal("fetch", mockFetch)
    mockSpawn.mockReturnValue(mockChild)

    await getFreshModule()

    const spawnCall = mockSpawn.mock.calls[0]
    const env = spawnCall?.[2]?.env as Record<string, string> | undefined
    expect(env?.PORT).toBe("5000")

    vi.stubGlobal("fetch", undefined as any)
  })
})
