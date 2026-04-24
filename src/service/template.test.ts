/**
 * template.test.ts — Tests for systemd unit file template generation
 */

import { describe, it, expect } from "vitest";
import { generateServiceUnit, type ServiceConfig } from "./template.js";

describe("generateServiceUnit", () => {
  const baseConfig: ServiceConfig = {
    workDir: "/home/user/projects/gemini-router",
    nodePath: "/usr/bin/node",
    geminiCliPath: "/usr/local/bin/gemini",
    port: 4789,
  };

  it("generates valid unit file with all placeholders filled", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("Description=Gemini Router");
    expect(result).toContain("/home/user/projects/gemini-router/dist/server.js");
  });

  it("includes correct ExecStart with node path", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("ExecStart=/usr/bin/node");
    expect(result).toContain("/home/user/projects/gemini-router/dist/server.js");
  });

  it("includes GEMINI_CLI_PATH env var", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain('Environment="GEMINI_CLI_PATH=/usr/local/bin/gemini"');
  });

  it("includes PORT env var", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain('Environment="PORT=4789"');
  });

  it("includes Restart=on-failure", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("Restart=on-failure");
  });

  it("includes RestartSec=3", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("RestartSec=3");
  });

  it("includes WantedBy=default.target", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("WantedBy=default.target");
  });

  it("uses custom port when provided", () => {
    const config = { ...baseConfig, port: 9000 };
    const result = generateServiceUnit(config);

    expect(result).toContain('Environment="PORT=9000"');
  });

  it("sets Type=simple", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("Type=simple");
  });

  it("sets WorkingDirectory correctly", () => {
    const result = generateServiceUnit(baseConfig);

    expect(result).toContain("WorkingDirectory=/home/user/projects/gemini-router");
  });
});
