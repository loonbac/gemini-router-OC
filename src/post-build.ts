/**
 * post-build.ts — Post-compilation script that prints the opencode.json config
 *
 * Run after `tsc -p tsconfig.build.json` to show the user their personalized config.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getUserPort } from "./user-port.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Derive the user's port (deterministic from uid)
const port = getUserPort();

// Resolve absolute path to dist/plugin.js
// __dirname is dist/ (where this script lives after compilation)
// So parent of __dirname is the project root, then join with "dist/plugin.js"
const absolutePluginPath = join(__dirname, "plugin.js");

const config = {
  plugin: [absolutePluginPath],
  provider: {
      gemini: {
        models: {
          "gemini-3-pro": {
            name: "Gemini 3 Pro",
            limit: { context: 1048576, output: 65536 },
          },
          "gemini-3-flash": {
            name: "Gemini 3 Flash",
            limit: { context: 1048576, output: 65536 },
          },
          "gemini-3.1-flash-lite": {
            name: "Gemini 3.1 Flash Lite",
            limit: { context: 65536, output: 65536 },
          },
          "gemini-3.1-pro-preview": {
            name: "Gemini 3.1 Pro Preview",
            limit: { context: 1048576, output: 65536 },
        },
        "gemini-3-flash-preview": {
          name: "Gemini 3 Flash Preview",
          limit: { context: 1048576, output: 65536 },
        },
          "gemini-3.1-flash-lite-preview": {
            name: "Gemini 3.1 Flash Lite Preview",
            limit: { context: 1048576, output: 65536 },
          },
          "gemini-1.5-pro": {
            name: "Gemini 1.5 Pro",
            limit: { context: 1048576, output: 65536 },
          },
          "gemini-1.5-flash": {
            name: "Gemini 1.5 Flash",
            limit: { context: 1048576, output: 65536 },
          },
          "gemini-2.5-pro": {
            name: "Gemini 2.5 Pro",
            limit: { context: 1048576, output: 65536 },
        },
        "gemini-2.5-flash": {
          name: "Gemini 2.5 Flash",
          limit: { context: 1048576, output: 65536 },
        },
        "gemini-2.5-flash-lite": {
          name: "Gemini 2.5 Flash Lite",
          limit: { context: 1048576, output: 65536 },
        },
      },
      name: "Gemini (via CLI)",
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: `http://127.0.0.1:${port}/v1`,
      },
    },
  },
};

console.log("\u2705 Build completado.\n");
console.log("\u{1F4CB} Configur\u00E1 OpenCode \u2014 abr\u00ED tu archivo de configuraci\u00F3n:");
console.log("   ~/.config/opencode/opencode.json\n");
console.log("Copi\u00E1 y peg\u00E1 esto (tu puerto ya est\u00E1 incluido):\n");
console.log(JSON.stringify(config, null, 2));
console.log("\n\u26A0\uFE0F  RECUERDA: TU PUERTO ES EL", port, "\n");
