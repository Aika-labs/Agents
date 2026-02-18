import { describe, it, expect } from "vitest";
import { GoogleADKAdapter } from "./google-adk.js";
import type { AgentConfig } from "./types.js";

const mockConfig: AgentConfig = {
  id: "test-agent-id",
  name: "Test ADK Agent",
  framework: "google_adk",
  modelConfig: {
    provider: "google",
    model: "gemini-2.0-flash",
    temperature: 0.7,
  },
  systemPrompt: "You are a helpful assistant.",
  tools: [],
  mcpServers: [],
  a2aConfig: {},
  resources: {
    cpuLimit: "500m",
    memoryLimit: "512Mi",
    cpuRequest: "250m",
    memoryRequest: "256Mi",
  },
  metadata: {},
};

describe("GoogleADKAdapter", () => {
  it("has framework identifier google_adk", () => {
    const adapter = new GoogleADKAdapter();
    expect(adapter.framework).toBe("google_adk");
  });

  it("initializes successfully", async () => {
    const adapter = new GoogleADKAdapter();
    await adapter.init(mockConfig);

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe("running");
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });

  it("runs and returns a result", async () => {
    const adapter = new GoogleADKAdapter();
    await adapter.init(mockConfig);

    const result = await adapter.run({
      sessionId: "session-1",
      message: "Hello, agent!",
    });

    expect(result.output).toContain("Hello, agent!");
    expect(result.model).toBe("google/gemini-2.0-flash");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.framework).toBe("google_adk");
  });

  it("throws when running without init", async () => {
    const adapter = new GoogleADKAdapter();
    await expect(
      adapter.run({ sessionId: "s1", message: "test" }),
    ).rejects.toThrowError("not initialized");
  });

  it("reports unhealthy after stop", async () => {
    const adapter = new GoogleADKAdapter();
    await adapter.init(mockConfig);
    await adapter.stop();

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.status).toBe("stopped");
  });

  it("supports model hot-swap", async () => {
    const adapter = new GoogleADKAdapter();
    await adapter.init(mockConfig);

    const success = await adapter.updateModelConfig({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(success).toBe(true);
  });

  it("rejects model hot-swap without init", async () => {
    const adapter = new GoogleADKAdapter();
    const success = await adapter.updateModelConfig({
      provider: "openai",
      model: "gpt-4o",
    });
    expect(success).toBe(false);
  });
});
