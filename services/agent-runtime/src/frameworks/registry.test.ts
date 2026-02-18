import { describe, it, expect } from "vitest";
import { createRunner, listFrameworks } from "./registry.js";

describe("listFrameworks", () => {
  it("returns all 6 registered framework names", () => {
    const frameworks = listFrameworks();
    expect(frameworks).toEqual([
      "google_adk",
      "langgraph",
      "crewai",
      "autogen",
      "openai_sdk",
      "custom",
    ]);
  });
});

describe("createRunner", () => {
  it("creates a GoogleADKAdapter for google_adk", () => {
    const runner = createRunner("google_adk");
    expect(runner.framework).toBe("google_adk");
  });

  it("creates a LangGraphAdapter for langgraph", () => {
    const runner = createRunner("langgraph");
    expect(runner.framework).toBe("langgraph");
  });

  it("creates a CrewAIAdapter for crewai", () => {
    const runner = createRunner("crewai");
    expect(runner.framework).toBe("crewai");
  });

  it("creates an AutoGenAdapter for autogen", () => {
    const runner = createRunner("autogen");
    expect(runner.framework).toBe("autogen");
  });

  it("creates an OpenAISDKAdapter for openai_sdk", () => {
    const runner = createRunner("openai_sdk");
    expect(runner.framework).toBe("openai_sdk");
  });

  it("creates a CustomAdapter for custom", () => {
    const runner = createRunner("custom");
    expect(runner.framework).toBe("custom");
  });

  it("throws for unsupported framework", () => {
    expect(() => createRunner("nonexistent" as never)).toThrowError(
      "Unsupported framework: nonexistent",
    );
  });
});
