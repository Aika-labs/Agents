import type { AgentRunner } from "./runner.js";
import type { AgentFramework } from "./types.js";
import { GoogleADKAdapter } from "./google-adk.js";
import { LangGraphAdapter } from "./langgraph.js";
import { CrewAIAdapter } from "./crewai.js";
import { AutoGenAdapter } from "./autogen.js";
import { OpenAISDKAdapter } from "./openai-sdk.js";
import { CustomAdapter } from "./custom.js";

/**
 * Framework adapter registry.
 *
 * Maps framework identifiers to their adapter constructors. When a new
 * framework is added, register it here and implement the AgentRunner interface.
 */

type AdapterFactory = () => AgentRunner;

const adapters: Record<string, AdapterFactory> = {
  google_adk: () => new GoogleADKAdapter(),
  langgraph: () => new LangGraphAdapter(),
  crewai: () => new CrewAIAdapter(),
  autogen: () => new AutoGenAdapter(),
  openai_sdk: () => new OpenAISDKAdapter(),
  custom: () => new CustomAdapter(),
};

/**
 * Create an AgentRunner for the given framework.
 * Throws if the framework is not supported.
 */
export function createRunner(framework: AgentFramework): AgentRunner {
  const factory = adapters[framework];
  if (!factory) {
    throw new Error(
      `Unsupported framework: ${framework}. Available: ${Object.keys(adapters).join(", ")}`,
    );
  }
  return factory();
}

/** List all registered framework adapters. */
export function listFrameworks(): string[] {
  return Object.keys(adapters);
}
