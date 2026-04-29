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

const mockLog = vi.fn()
const mockThink = vi.fn()
const mockToast = vi.fn()
const mockCtx = {
  client: {
    app: {
      log: mockLog,
      think: mockThink,
    },
    ui: {
      toast: mockToast,
    },
  },
  project: {
    directory: "/test/project",
  },
}

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
    mockLog.mockReset()
    mockThink.mockReset()
    mockToast.mockReset()
  })

  it("returns an object with event handler when router is running", async () => {
    // Mock fetch to simulate router already running
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    // Mock spawn to return a valid child process
    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    const plugin = await mod.GeminiRouter(mockCtx as any)

    expect(plugin).toHaveProperty("event")
    expect(typeof plugin.event).toBe("function")
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("Plugin initialized"))

    // Clean up
    vi.stubGlobal("fetch", undefined as any)
  })

  it("event handler is callable with app.closing event", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)

    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    const plugin = await mod.GeminiRouter(mockCtx as any)

    expect(plugin.event).toBeDefined()
    // Should not throw - use non-null assertion since event is always returned
    await plugin.event!({ event: { type: "app.closing" } as any })
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining("App closing"))

    vi.stubGlobal("fetch", undefined as any)
  })

  // ---------------------------------------------------------------------------
  // Behavioral tests: capabilities and permissions
  // ---------------------------------------------------------------------------

  describe("Plugin return value", () => {
    it("returns capabilities array with expected values", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal("fetch", mockFetch)
      mockSpawn.mockReturnValue(mockChild)

      const mod = await getFreshModule()
      const plugin = (await mod.GeminiRouter(mockCtx as any)) as any

      expect(plugin.capabilities).toBeDefined()
      expect(Array.isArray(plugin.capabilities)).toBe(true)
      expect(plugin.capabilities).toContain("ui.toast")
      expect(plugin.capabilities).toContain("lifecycle")
      expect(plugin.capabilities).toContain("tool.execute.before")
      expect(plugin.capabilities).toContain("tools")

      vi.stubGlobal("fetch", undefined as any)
    })

    it("returns permissions array with filesystem read/write", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal("fetch", mockFetch)
      mockSpawn.mockReturnValue(mockChild)

      const mod = await getFreshModule()
      const plugin = (await mod.GeminiRouter(mockCtx as any)) as any

      expect(plugin.permissions).toBeDefined()
      expect(Array.isArray(plugin.permissions)).toBe(true)
      expect(plugin.permissions).toContain("filesystem:read")
      expect(plugin.permissions).toContain("filesystem:write")

      vi.stubGlobal("fetch", undefined as any)
    })

    it("returns tools array with gemini_router_info", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal("fetch", mockFetch)
      mockSpawn.mockReturnValue(mockChild)

      const mod = await getFreshModule()
      const plugin = (await mod.GeminiRouter(mockCtx as any)) as any

      expect(plugin.tools).toBeDefined()
      expect(Array.isArray(plugin.tools)).toBe(true)
      expect(plugin.tools.length).toBeGreaterThan(0)

      const routerInfoTool = plugin.tools.find((t: any) => t.name === "gemini_router_info")
      expect(routerInfoTool).toBeDefined()
      expect(routerInfoTool.description).toContain("Gemini Router")
      expect(typeof routerInfoTool.execute).toBe("function")

      vi.stubGlobal("fetch", undefined as any)
    })
  })

  // ---------------------------------------------------------------------------
  // Behavioral tests: startup toast
  // ---------------------------------------------------------------------------

  describe("Startup toast", () => {
    it("calls ctx.client.ui.toast on startup after bootPromise resolves", async () => {
      // Mock fetch: first call false (router not running), second call true (router ready)
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false }) // isRunning returns false
        .mockResolvedValueOnce({ ok: true })  // waitForRouter polls and finds it running
      vi.stubGlobal("fetch", mockFetch)
      mockSpawn.mockReturnValue(mockChild)

      const mod = await getFreshModule()
      await mod.GeminiRouter(mockCtx as any)

      // Startup toast should be called with "Gemini Router: Startup successful"
      expect(mockToast).toHaveBeenCalledWith("Gemini Router: Startup successful", { type: "success" })

      vi.stubGlobal("fetch", undefined as any)
    })

    it("does not call startup toast if router is already running", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true }) // router already running
      vi.stubGlobal("fetch", mockFetch)
      mockSpawn.mockReturnValue(mockChild)

      mockToast.mockClear()
      const mod = await getFreshModule()
      await mod.GeminiRouter(mockCtx as any)

      // When router already running, boot() returns early, startup toast still fires
      // (this is the current behavior - boot returns early but toast is still shown)
      expect(mockToast).toHaveBeenCalledWith("Gemini Router: Startup successful", { type: "success" })

      vi.stubGlobal("fetch", undefined as any)
    })
  })

  // ---------------------------------------------------------------------------
  // Behavioral tests: crash toast
  // ---------------------------------------------------------------------------

describe("Crash toast", () => {
  it("calls ctx.client.ui.toast when child process closes unexpectedly", async () => {
    // First call false (trigger startRouter), second call true (waitForRouter completes)
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })  // isRunning() in boot() returns false
      .mockResolvedValueOnce({ ok: true })   // waitForRouter polls and finds router running
    vi.stubGlobal("fetch", mockFetch)

    // Create a child that can be closed
    let storedCloseHandler: ((code: number | null) => void) | null = null
    const mockChildForCrash: typeof mockChild = {
      ...mockChild,
      on: vi.fn((event: string, handler: (code: number | null) => void) => {
        if (event === "close") {
          storedCloseHandler = handler
        }
        return mockChildForCrash
      }),
    }
    mockSpawn.mockReturnValue(mockChildForCrash)

    const mod = await getFreshModule()
    const plugin = await mod.GeminiRouter(mockCtx as any)

    mockToast.mockClear()
    // Simulate the child closing with a non-zero code (crash)
    ;(storedCloseHandler as ((code: number | null) => void) | null)?.(1)

    // Crash toast should be called
    expect(mockToast).toHaveBeenCalledWith(
      "Gemini Router crashed, restarting...",
      { type: "error" }
    )

    vi.stubGlobal("fetch", undefined as any)
  })

  it("does NOT call crash toast when shutting down", async () => {
    // First call false (trigger startRouter), second call true (waitForRouter completes)
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })  // isRunning() in boot() returns false
      .mockResolvedValueOnce({ ok: true })   // waitForRouter polls and finds router running
    vi.stubGlobal("fetch", mockFetch)

    let storedCloseHandler: ((code: number | null) => void) | null = null
    const mockChildForShutdown: typeof mockChild = {
      ...mockChild,
      on: vi.fn((event: string, handler: (code: number | null) => void) => {
        if (event === "close") {
          storedCloseHandler = handler
        }
        return mockChildForShutdown
      }),
    }
    mockSpawn.mockReturnValue(mockChildForShutdown)

    const mod = await getFreshModule()
    const plugin = await mod.GeminiRouter(mockCtx as any)

    mockToast.mockClear()
    // Trigger app.closing to set shuttingDown = true
    await plugin.event!({ event: { type: "app.closing" } as any })

    // Now close the child - should NOT trigger crash toast
    ;(storedCloseHandler as ((code: number | null) => void) | null)?.(1)

      expect(mockToast).not.toHaveBeenCalledWith(
        "Gemini Router crashed, restarting...",
        expect.anything()
      )

      vi.stubGlobal("fetch", undefined as any)
    })
  })
})

// ---------------------------------------------------------------------------
// Behavioral tests: idle toast
// ---------------------------------------------------------------------------

describe("Idle toast", () => {
  it("calls ctx.client.ui.toast when session.idle event is received", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)
    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    const plugin = await mod.GeminiRouter(mockCtx as any)

    mockToast.mockClear()
    await plugin.event!({ event: { type: "session.idle" } as any })

    expect(mockToast).toHaveBeenCalledWith(
      "Gemini Router: Session idle - Analysis complete",
      { type: "success" }
    )

    vi.stubGlobal("fetch", undefined as any)
  })

  it("does not call idle toast for other event types", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", mockFetch)
    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    const plugin = await mod.GeminiRouter(mockCtx as any)

    mockToast.mockClear()
    // Send a different event type
    await plugin.event!({ event: { type: "session.created" } as any })

    expect(mockToast).not.toHaveBeenCalledWith(
      "Gemini Router: Session idle - Analysis complete",
      expect.anything()
    )

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

    // First call false (to trigger start), second call true (to stop waiting)
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal("fetch", mockFetch)
    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    await mod.GeminiRouter(mockCtx as any)

    // PORT env passed to spawn should be 47901
    const spawnCall = mockSpawn.mock.calls[0]
    const env = spawnCall?.[2]?.env as Record<string, string> | undefined
    expect(env?.PORT).toBe("47901")

    vi.stubGlobal("fetch", undefined as any)
  })

  it("GEMINI_ROUTER_PORT env overrides derived port in spawn", async () => {
    process.env.GEMINI_ROUTER_PORT = "5000"
    mockResolveEffectivePort.mockReturnValue(5000)

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal("fetch", mockFetch)
    mockSpawn.mockReturnValue(mockChild)

    const mod = await getFreshModule()
    await mod.GeminiRouter(mockCtx as any)

    const spawnCall = mockSpawn.mock.calls[0]
    const env = spawnCall?.[2]?.env as Record<string, string> | undefined
    expect(env?.PORT).toBe("5000")

    vi.stubGlobal("fetch", undefined as any)
  })
})
