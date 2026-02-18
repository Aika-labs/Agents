import type {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
import type { Message } from "@a2a-js/sdk";

/**
 * Platform Agent Executor.
 *
 * Implements the A2A AgentExecutor interface to handle incoming tasks
 * from remote A2A clients. Routes tasks to the appropriate agent on
 * the platform by forwarding messages to the control plane API.
 *
 * Flow:
 *   1. Remote agent sends a task via A2A
 *   2. Executor extracts the text message
 *   3. Forwards to the control plane (create session + send message)
 *   4. Returns the agent's response as an A2A message
 */

/** Control plane base URL. */
function getControlPlaneUrl(): string {
  return process.env["CONTROL_PLANE_URL"] ?? "http://localhost:8080";
}

export class PlatformAgentExecutor implements AgentExecutor {
  private readonly agentId: string | null;

  /**
   * @param agentId If provided, routes all tasks to this specific agent.
   *                If null, the executor handles platform-level tasks.
   */
  constructor(agentId: string | null = null) {
    this.agentId = agentId;
  }

  async execute(
    requestContext: RequestContext,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    const userMessage = requestContext.userMessage;
    const textContent = extractTextFromMessage(userMessage);

    if (!textContent) {
      const errorResponse: Message = {
        kind: "message",
        messageId: generateId(),
        role: "agent",
        parts: [
          {
            kind: "text",
            text: "I can only process text messages at this time.",
          },
        ],
        contextId: requestContext.contextId,
      };
      eventBus.publish(errorResponse);
      eventBus.finished();
      return;
    }

    try {
      let responseText: string;

      if (this.agentId) {
        // Route to a specific agent.
        responseText = await this.forwardToAgent(
          this.agentId,
          textContent,
          requestContext.contextId,
        );
      } else {
        // Platform-level: interpret as a management command.
        responseText = await this.handlePlatformTask(textContent);
      }

      const response: Message = {
        kind: "message",
        messageId: generateId(),
        role: "agent",
        parts: [{ kind: "text", text: responseText }],
        contextId: requestContext.contextId,
      };

      eventBus.publish(response);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Unknown error occurred";

      const errorResponse: Message = {
        kind: "message",
        messageId: generateId(),
        role: "agent",
        parts: [{ kind: "text", text: `Error: ${errorMsg}` }],
        contextId: requestContext.contextId,
      };

      eventBus.publish(errorResponse);
    }

    eventBus.finished();
  }

  async cancelTask(
    _taskId: string,
    eventBus: ExecutionEventBus,
  ): Promise<void> {
    // For now, just signal finished. In the future, this could cancel
    // an in-progress agent session.
    eventBus.finished();
  }

  // -- Private helpers --------------------------------------------------------

  /**
   * Forward a message to a specific agent via the control plane.
   */
  private async forwardToAgent(
    agentId: string,
    message: string,
    contextId: string,
  ): Promise<string> {
    const cpUrl = getControlPlaneUrl();

    // Create or reuse a session. Use contextId as a stable session key.
    // For simplicity, create a new session per context.
    const sessionRes = await fetch(`${cpUrl}/agents/${agentId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `A2A session ${contextId}` }),
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.text();
      throw new Error(`Failed to create session: ${err}`);
    }

    const session = (await sessionRes.json()) as { id: string };

    // Send the message.
    const msgRes = await fetch(
      `${cpUrl}/agents/${agentId}/sessions/${session.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message, role: "user" }),
      },
    );

    if (!msgRes.ok) {
      const err = await msgRes.text();
      throw new Error(`Failed to send message: ${err}`);
    }

    const msgData = (await msgRes.json()) as { content?: string };
    return msgData.content ?? "Message received. Processing...";
  }

  /**
   * Handle platform-level tasks (agent management via natural language).
   */
  private async handlePlatformTask(message: string): Promise<string> {
    const cpUrl = getControlPlaneUrl();
    const lower = message.toLowerCase();

    // Simple intent detection for platform commands.
    if (lower.includes("list agents") || lower.includes("show agents")) {
      const res = await fetch(`${cpUrl}/agents`);
      if (!res.ok) return "Failed to list agents.";
      const data = (await res.json()) as { data: Array<{ id: string; name: string; status: string }> };
      if (!data.data || data.data.length === 0) return "No agents found.";
      return (
        "Agents on the platform:\n" +
        data.data
          .map(
            (a: { id: string; name: string; status: string }) =>
              `- ${a.name} (${a.id}) [${a.status}]`,
          )
          .join("\n")
      );
    }

    return (
      "I'm the Agent Operating System. I can help you manage agents on the platform. " +
      "Try asking me to 'list agents', or send a message to a specific agent via its A2A endpoint."
    );
  }
}

// -- Utilities ----------------------------------------------------------------

function extractTextFromMessage(message: Message): string | null {
  for (const part of message.parts) {
    if (part.kind === "text") {
      return part.text;
    }
  }
  return null;
}

function generateId(): string {
  // Use crypto.randomUUID if available, otherwise fallback.
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Simple fallback.
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


