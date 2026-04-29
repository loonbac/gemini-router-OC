/**
 * @opencode-ai/plugin.d.ts — Local type declarations for @opencode-ai/plugin
 *
 * Since @opencode-ai/plugin is a peer dependency only available within OpenCode's
 * runtime, we declare the types locally for development and compilation.
 */

declare module "@opencode-ai/plugin" {
  export interface PluginContext {
    // Context passed to plugins by OpenCode
    project?: {
      directory: string
    }
    client?: {
      app: {
        log: (msg: string) => void
        think: (msg: string) => void
      }
      ui: {
        toast: (msg: string, opts?: { type: string }) => void
      }
    }
  }

  export interface PluginEvent {
    type: string
    // Other event properties as needed
  }

  export interface ToolExecuteBeforeInput {
    tool: string
    args: {
      file_path?: string
      path?: string
      filePath?: string
    }
  }

  export interface SessionCompactingOutput {
    context: string[]
  }

  export interface PluginHooks {
    event?: (ctx: { event: PluginEvent }) => Promise<void>
    capabilities?: string[]
    permissions?: string[]
    "tool.execute.before"?: (input: ToolExecuteBeforeInput) => Promise<boolean | undefined>
    "experimental.session.compacting"?: (input: unknown, output: SessionCompactingOutput) => Promise<void>
  }

  export type Plugin = (ctx: PluginContext) => Promise<PluginHooks>
}
