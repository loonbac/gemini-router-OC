/**
 * template.ts — Generates systemd unit file content
 */

export interface ServiceConfig {
  workDir: string;
  nodePath: string;
  geminiCliPath: string;
  port: number;
}

const UNIT_TEMPLATE = `[Unit]
Description=Gemini Router — OpenAI-compatible HTTP server bridging to Gemini CLI
After=network.target

[Service]
Type=simple
Restart=on-failure
RestartSec=3
Environment="GEMINI_CLI_PATH={{GEMINI_CLI_PATH}}"
Environment="PORT={{PORT}}"
ExecStart={{NODE_PATH}} {{SERVER_SCRIPT}}
WorkingDirectory={{WORK_DIR}}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;

export function generateServiceUnit(config: ServiceConfig): string {
  return UNIT_TEMPLATE
    .replace("{{GEMINI_CLI_PATH}}", config.geminiCliPath)
    .replace("{{PORT}}", String(config.port))
    .replace("{{NODE_PATH}}", config.nodePath)
    .replace("{{SERVER_SCRIPT}}", `${config.workDir}/dist/server.js`)
    .replace("{{WORK_DIR}}", config.workDir);
}
