/**
 * plugin-types.test.ts — Compile-time type tests for @opencode-ai/plugin types
 *
 * These tests verify that the plugin type declarations allow the expected
 * fields. They work by constructing objects that conform to the interfaces,
 * and asserting the fields are accessible.
 */

import { describe, it, expect } from "vitest"
import type { PluginHooks, PluginContext } from "@opencode-ai/plugin"

describe("PluginHooks type", () => {
  it("allows capabilities field", () => {
    const hooks: PluginHooks = {
      capabilities: ["ui.toast", "lifecycle"],
    }
    expect(hooks.capabilities).toEqual(["ui.toast", "lifecycle"])
  })

  it("allows permissions field", () => {
    const hooks: PluginHooks = {
      permissions: ["network", "process.spawn"],
    }
    expect(hooks.permissions).toEqual(["network", "process.spawn"])
  })

  it("allows both capabilities and permissions together", () => {
    const hooks: PluginHooks = {
      capabilities: ["ui.toast"],
      permissions: ["network"],
      event: async () => {},
    }
    expect(hooks.capabilities).toEqual(["ui.toast"])
    expect(hooks.permissions).toEqual(["network"])
  })

  it("hooks without capabilities or permissions are still valid", () => {
    const hooks: PluginHooks = {
      event: async () => {},
    }
    expect(hooks.capabilities).toBeUndefined()
    expect(hooks.permissions).toBeUndefined()
  })
})

describe("PluginContext type", () => {
  it("allows project.directory field", () => {
    const ctx: PluginContext = {
      project: { directory: "/test/project" },
    }
    expect(ctx.project!.directory).toBe("/test/project")
  })

  it("allows client.app.log field", () => {
    const log = (msg: string) => {}
    const ctx: PluginContext = {
      client: { app: { log, think: (msg: string) => {} }, ui: { toast: (msg: string) => {} } },
    }
    expect(typeof ctx.client!.app.log).toBe("function")
  })

  it("allows client.ui.toast field", () => {
    const toast = (msg: string, opts?: { type: string }) => {}
    const ctx: PluginContext = {
      client: { app: { log: () => {}, think: () => {} }, ui: { toast } },
    }
    expect(typeof ctx.client!.ui.toast).toBe("function")
  })
})
