import {
  ClientFactory,
  DefaultAgentCardResolver,
} from "@a2a-js/sdk/client";
import type {
  Client,
  RequestOptions,
} from "@a2a-js/sdk/client";
import type { AgentCard, Message, Task } from "@a2a-js/sdk";

/**
 * A2A Client Manager.
 *
 * Manages outbound A2A connections to remote agents. Enables agents on
 * this platform to discover and collaborate with external agents via
 * the A2A protocol.
 *
 * Workflow:
 *   1. Discover a remote agent by fetching its AgentCard from a URL
 *   2. Create an A2A client connected to that agent
 *   3. Send messages / tasks and receive responses
 *   4. Optionally stream responses for long-running tasks
 *
 * Connections are cached per `{localAgentId}:{remoteUrl}` for reuse.
 */

interface CachedConnection {
  client: Client;
  agentCard: AgentCard;
  remoteUrl: string;
  connectedAt: Date;
}

export interface A2AMessageResult {
  /** The task created by the remote agent. */
  task?: Task;
  /** Response messages from the remote agent. */
  messages: Array<{ role: string; text: string }>;
  /** Whether the task completed successfully. */
  completed: boolean;
}

export class A2AClientManager {
  private connections = new Map<string, CachedConnection>();
  private cardResolver = new DefaultAgentCardResolver();
  private clientFactory = new ClientFactory();

  /**
   * Discover a remote agent by fetching its AgentCard.
   */
  async discoverAgent(remoteBaseUrl: string): Promise<AgentCard> {
    console.log(`[A2A Client] Discovering agent at ${remoteBaseUrl}`);
    const card = await this.cardResolver.resolve(remoteBaseUrl);
    console.log(
      `[A2A Client] Discovered "${card.name}" with ${card.skills?.length ?? 0} skills`,
    );
    return card;
  }

  /**
   * Connect a local agent to a remote agent via A2A.
   * Fetches the AgentCard and creates a client.
   */
  async connect(
    localAgentId: string,
    remoteBaseUrl: string,
  ): Promise<AgentCard> {
    const key = connectionKey(localAgentId, remoteBaseUrl);

    // Return cached connection if available.
    const existing = this.connections.get(key);
    if (existing) return existing.agentCard;

    const agentCard = await this.discoverAgent(remoteBaseUrl);
    const client = await this.clientFactory.createFromAgentCard(agentCard);

    this.connections.set(key, {
      client,
      agentCard,
      remoteUrl: remoteBaseUrl,
      connectedAt: new Date(),
    });

    console.log(
      `[A2A Client] Agent ${localAgentId} connected to "${agentCard.name}" at ${remoteBaseUrl}`,
    );

    return agentCard;
  }

  /**
   * Send a message to a remote agent and wait for the response.
   */
  async sendMessage(
    localAgentId: string,
    remoteBaseUrl: string,
    message: string,
    contextId?: string,
    options?: RequestOptions,
  ): Promise<A2AMessageResult> {
    const conn = await this.ensureConnected(localAgentId, remoteBaseUrl);

    const userMessage: Message = {
      kind: "message",
      messageId: generateId(),
      role: "user",
      parts: [{ kind: "text", text: message }],
      contextId,
    };

    console.log(
      `[A2A Client] Agent ${localAgentId} sending message to "${conn.agentCard.name}"`,
    );

    const result = await conn.client.sendMessage(
      { message: userMessage },
      options,
    );

    return parseResult(result);
  }

  /**
   * Send a message and stream the response for long-running tasks.
   * Yields partial results as they arrive.
   */
  async *sendMessageStream(
    localAgentId: string,
    remoteBaseUrl: string,
    message: string,
    contextId?: string,
    options?: RequestOptions,
  ): AsyncGenerator<{ type: string; data: unknown }, void, undefined> {
    const conn = await this.ensureConnected(localAgentId, remoteBaseUrl);

    const userMessage: Message = {
      kind: "message",
      messageId: generateId(),
      role: "user",
      parts: [{ kind: "text", text: message }],
      contextId,
    };

    console.log(
      `[A2A Client] Agent ${localAgentId} streaming message to "${conn.agentCard.name}"`,
    );

    const stream = conn.client.sendMessageStream(
      { message: userMessage },
      options,
    );

    for await (const event of stream) {
      yield { type: event.kind, data: event };
    }
  }

  /**
   * List all remote agents a local agent is connected to.
   */
  listConnections(
    localAgentId: string,
  ): Array<{ remoteUrl: string; agentName: string; connectedAt: string }> {
    const result: Array<{
      remoteUrl: string;
      agentName: string;
      connectedAt: string;
    }> = [];

    for (const [key, conn] of this.connections) {
      if (key.startsWith(`${localAgentId}:`)) {
        result.push({
          remoteUrl: conn.remoteUrl,
          agentName: conn.agentCard.name,
          connectedAt: conn.connectedAt.toISOString(),
        });
      }
    }

    return result;
  }

  /**
   * Disconnect a local agent from a remote agent.
   */
  disconnect(localAgentId: string, remoteBaseUrl: string): void {
    const key = connectionKey(localAgentId, remoteBaseUrl);
    this.connections.delete(key);
  }

  /**
   * Disconnect a local agent from all remote agents.
   */
  disconnectAll(localAgentId: string): void {
    const keysToRemove: string[] = [];
    for (const key of this.connections.keys()) {
      if (key.startsWith(`${localAgentId}:`)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.connections.delete(key);
    }
  }

  /**
   * Close all connections (shutdown).
   */
  closeAll(): void {
    this.connections.clear();
  }

  // -- Private helpers --------------------------------------------------------

  private async ensureConnected(
    localAgentId: string,
    remoteBaseUrl: string,
  ): Promise<CachedConnection> {
    const key = connectionKey(localAgentId, remoteBaseUrl);
    let conn = this.connections.get(key);

    if (!conn) {
      await this.connect(localAgentId, remoteBaseUrl);
      conn = this.connections.get(key);
    }

    if (!conn) {
      throw new Error(
        `Failed to connect agent ${localAgentId} to ${remoteBaseUrl}`,
      );
    }

    return conn;
  }
}

// -- Utilities ----------------------------------------------------------------

function connectionKey(localAgentId: string, remoteUrl: string): string {
  return `${localAgentId}:${remoteUrl}`;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseResult(result: unknown): A2AMessageResult {
  // The SDK returns either a Task or a Message depending on the server.
  const messages: Array<{ role: string; text: string }> = [];
  let task: Task | undefined;
  let completed = false;

  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;

    // Check if it's a Task.
    if ("id" in r && "status" in r) {
      task = r as unknown as Task;
      const status = r["status"] as Record<string, unknown> | undefined;
      completed = status?.state === "completed";

      // Extract text from artifacts.
      const artifacts = (r["artifacts"] ?? []) as Array<{
        parts?: Array<{ kind: string; text?: string }>;
      }>;
      for (const artifact of artifacts) {
        for (const part of artifact.parts ?? []) {
          if (part.kind === "text" && part.text) {
            messages.push({ role: "agent", text: part.text });
          }
        }
      }
    }

    // Check if it's a Message.
    if ("kind" in r && r["kind"] === "message") {
      const msg = r as unknown as Message;
      for (const part of msg.parts) {
        if (part.kind === "text") {
          messages.push({ role: String(msg.role), text: part.text });
        }
      }
      completed = true;
    }
  }

  return { task, messages, completed };
}

/** Singleton A2A client manager. */
let instance: A2AClientManager | null = null;

export function getA2AClientManager(): A2AClientManager {
  if (!instance) {
    instance = new A2AClientManager();
  }
  return instance;
}
