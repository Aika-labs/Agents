import { describe, it, expect } from "vitest";
import { LangGraphAdapter } from "./langgraph.js";
import type { AgentConfig } from "./types.js";

const mockConfig: AgentConfig = {
  id: "test-langgraph-id",
  name: "Test LangGraph Agent",
  framework: "langgraph",
  modelConfig: {
    provider: "openai",
    model: "gpt-4o",
    temperature: 0.5,
  },
  systemPrompt: "You are a graph-based agent.",
  tools: [],
  mcpServers: [],
  a2aConfig: {},
  resources: {
    cpuLimit: "1",
    memoryLimit: "1Gi",
    cpuRequest: "500m",
    memoryRequest: "512Mi",
  },
  metadata: {},
};

describe("LangGraphAdapter", () => {
  it("has framework identifier langgraph", () => {
    const adapter = new LangGraphAdapter();
    expect(adapter.framework).toBe("langgraph");
  });

  it("initializes and reports healthy", async () => {
    const adapter = new LangGraphAdapter();
    await adapter.init(mockConfig);

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.status).toBe("running");
  });

  it("runs and returns a result with correct model string", async () => {
    const adapter = new LangGraphAdapter();
    await adapter.init(mockConfig);

    const result = await adapter.run({
      sessionId: "session-lg-1",
      message: "Plan a trip",
    });

    expect(result.output).toContain("Plan a trip");
    expect(result.model).toBe("openai/gpt-4o");
    expect(result.metadata.framework).toBe("langgraph");
  });

  it("throws when running without init", async () => {
    const adapter = new LangGraphAdapter();
    await expect(
      adapter.run({ sessionId: "s1", message: "test" }),
    ).rejects.toThrowError("not initialized");
  });

  it("stops cleanly", async () => {
    const adapter = new LangGraphAdapter();
    await adapter.init(mockConfig);
    await adapter.stop();

    const health = await adapter.healthCheck();
    expect(health.healthy).toBe(false);
  });
});
