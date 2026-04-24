/**
 * user-port.test.ts — Unit tests for user-port.ts
 *
 * Tests the deterministic per-user port derivation formula:
 *   port = 47890 + (uid * 2654435761) % 100
 *
 * Range: [47890, 47989]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("os", () => ({
  userInfo: vi.fn(),
}));

import { userInfo } from "os";

// We import these after mocking
let getUserPort: () => number;
let resolveEffectivePort: () => number;

beforeEach(async () => {
  vi.resetModules();
  // Default: no env vars
  delete process.env.GEMINI_ROUTER_PORT;
  delete process.env.PORT;
  const mod = await import("./user-port.js");
  getUserPort = mod.getUserPort;
  resolveEffectivePort = mod.resolveEffectivePort;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getUserPort — formula tests
// ---------------------------------------------------------------------------

describe("getUserPort", () => {
  it("uid 0 → port 47890 (base port)", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 0 } as ReturnType<typeof userInfo>);
    const { getUserPort } = await import("./user-port.js");
    expect(getUserPort()).toBe(47890);
  });

  it("uid 1000 → deterministic value in [47890, 47989]", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 1000 } as ReturnType<typeof userInfo>);
    const { getUserPort } = await import("./user-port.js");
    const port = getUserPort();
    expect(port).toBeGreaterThanOrEqual(47890);
    expect(port).toBeLessThanOrEqual(47989);
    // Verify determinism: 47890 + (1000 * 2654435761) % 100
    const expected = 47890 + ((1000 * 2654435761) % 100);
    expect(port).toBe(expected);
  });

  it("uid 65534 → deterministic value in range", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 65534 } as ReturnType<typeof userInfo>);
    const { getUserPort } = await import("./user-port.js");
    const port = getUserPort();
    expect(port).toBeGreaterThanOrEqual(47890);
    expect(port).toBeLessThanOrEqual(47989);
    // Verify determinism: 47890 + (65534 * 2654435761) % 100
    const expected = 47890 + ((65534 * 2654435761) % 100);
    expect(port).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getUserPort — determinism
// ---------------------------------------------------------------------------

describe("getUserPort determinism", () => {
  it("same uid called twice returns identical port", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 1000 } as ReturnType<typeof userInfo>);
    const { getUserPort } = await import("./user-port.js");
    const port1 = getUserPort();
    const port2 = getUserPort();
    expect(port1).toBe(port2);
  });
});

// ---------------------------------------------------------------------------
// getUserPort — Windows fallback
// ---------------------------------------------------------------------------

describe("getUserPort Windows fallback", () => {
  it("uid -1 hashes username string, returns value in [47890, 47989]", async () => {
    // Simulate Windows where uid is -1
    vi.mocked(userInfo).mockReturnValue({ uid: -1, username: "testuser" } as ReturnType<typeof userInfo>);
    const { getUserPort } = await import("./user-port.js");
    const port = getUserPort();
    expect(port).toBeGreaterThanOrEqual(47890);
    expect(port).toBeLessThanOrEqual(47989);
  });

  it("Windows fallback is deterministic for same username", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: -1, username: "alice" } as ReturnType<typeof userInfo>);
    const { getUserPort } = await import("./user-port.js");
    const port1 = getUserPort();
    const port2 = getUserPort();
    expect(port1).toBe(port2);
  });
});

// ---------------------------------------------------------------------------
// resolveEffectivePort — precedence
// ---------------------------------------------------------------------------

describe("resolveEffectivePort precedence", () => {
  it("GEMINI_ROUTER_PORT > PORT > derived", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 1000 } as ReturnType<typeof userInfo>);

    // Case: GEMINI_ROUTER_PORT is set → wins
    process.env.GEMINI_ROUTER_PORT = "5000";
    process.env.PORT = "6000";
    const { resolveEffectivePort } = await import("./user-port.js");
    expect(resolveEffectivePort()).toBe(5000);
  });

  it("PORT overrides derived when GEMINI_ROUTER_PORT absent", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 1000 } as ReturnType<typeof userInfo>);
    delete process.env.GEMINI_ROUTER_PORT;
    process.env.PORT = "6000";

    const { resolveEffectivePort } = await import("./user-port.js");
    expect(resolveEffectivePort()).toBe(6000);
  });

  it("derived port used when no env vars", async () => {
    vi.mocked(userInfo).mockReturnValue({ uid: 0 } as ReturnType<typeof userInfo>);
    delete process.env.GEMINI_ROUTER_PORT;
    delete process.env.PORT;

    const { resolveEffectivePort } = await import("./user-port.js");
    // uid 0 → base port 47890
    expect(resolveEffectivePort()).toBe(47890);
  });
});
