import type { AgentCard } from "@a2a-js/sdk";

/**
 * Build the AgentCard for the Agent Operating System platform.
 *
 * The AgentCard is the A2A discovery document that tells remote agents
 * what this platform can do, how to connect, and what skills are available.
 * Served at `/.well-known/agent-card.json`.
 */
export function buildPlatformAgentCard(baseUrl: string): AgentCard {
  return {
    name: "Agent Operating System",
    description:
      "Enterprise platform for creating, deploying, and managing AI agents. " +
      "Supports multi-framework agents (Google ADK, LangGraph, CrewAI, AutoGen, OpenAI SDK) " +
      "with lifecycle management, model hot-swap, crypto wallets, and marketplace.",
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: `${baseUrl}/a2a/jsonrpc`,
    skills: [
      {
        id: "agent-management",
        name: "Agent Management",
        description:
          "Create, configure, start, stop, pause, and kill AI agents on the platform.",
        tags: ["agents", "lifecycle", "management"],
      },
      {
        id: "agent-chat",
        name: "Agent Chat",
        description:
          "Send messages to running agents and receive responses. Supports multi-turn conversations.",
        tags: ["chat", "conversation", "messaging"],
      },
      {
        id: "model-swap",
        name: "Model Hot-Swap",
        description:
          "Change the LLM model powering an agent without restarting it.",
        tags: ["model", "configuration", "hot-swap"],
      },
      {
        id: "marketplace-browse",
        name: "Marketplace Browse",
        description:
          "Browse and discover agents in the marketplace. View ratings, reviews, and pricing.",
        tags: ["marketplace", "discovery", "agents"],
      },
    ],
    capabilities: {
      pushNotifications: false,
      streaming: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
    additionalInterfaces: [
      {
        url: `${baseUrl}/a2a/jsonrpc`,
        transport: "JSONRPC",
      },
    ],
  };
}

/**
 * Build an AgentCard for a specific user-created agent.
 *
 * Each agent deployed on the platform gets its own AgentCard so remote
 * agents can discover and communicate with it via A2A.
 */
export function buildAgentCard(
  baseUrl: string,
  agent: {
    id: string;
    name: string;
    description?: string | null;
    framework: string;
    tags?: string[];
  },
): AgentCard {
  return {
    name: agent.name,
    description: agent.description ?? `AI agent powered by ${agent.framework}`,
    protocolVersion: "0.3.0",
    version: "0.1.0",
    url: `${baseUrl}/a2a/agents/${agent.id}/jsonrpc`,
    skills: [
      {
        id: "chat",
        name: "Chat",
        description: `Interact with ${agent.name}`,
        tags: agent.tags ?? ["chat"],
      },
    ],
    capabilities: {
      pushNotifications: false,
      streaming: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
  };
}
