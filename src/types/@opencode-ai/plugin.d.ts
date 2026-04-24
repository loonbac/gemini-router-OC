/**
 * @opencode-ai/plugin.d.ts — Local type declarations for @opencode-ai/plugin
 *
 * Since @opencode-ai/plugin is a peer dependency only available within OpenCode's
 * runtime, we declare the types locally for development and compilation.
 */

declare module "@opencode-ai/plugin" {
  export interface PluginContext {
    // Context passed to plugins by OpenCode
  }

  export interface PluginEvent {
    type: string
    // Other event properties as needed
  }

  export interface PluginHooks {
    event?: (ctx: { event: PluginEvent }) => Promise<void>
  }

  export type Plugin = (ctx: PluginContext) => Promise<PluginHooks>
}
