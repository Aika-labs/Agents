import { z } from "zod";
import { getRedis, createSubscriber } from "./client.js";

/**
 * Redis pub/sub event system for agent lifecycle commands.
 *
 * The control plane publishes commands to Redis channels, and the runtime
 * subscribes to execute them. This decouples the control plane from the
 * runtime and enables horizontal scaling of runtime instances.
 *
 * Channel naming: `agent:commands:{agentId}` for agent-specific commands,
 * `agent:commands:*` for broadcast commands.
 */

// -- Event types --------------------------------------------------------------

export const agentCommandSchema = z.object({
  /** Command type. */
  command: z.enum(["start", "stop", "pause", "resume", "kill", "update_model"]),
  /** Agent ID. */
  agentId: z.string().uuid(),
  /** Timestamp of the command. */
  timestamp: z.string().datetime(),
  /** Command payload (varies by command type). */
  payload: z.record(z.unknown()).default({}),
  /** Correlation ID for request tracing. */
  requestId: z.string().optional(),
});

export type AgentCommand = z.infer<typeof agentCommandSchema>;

/** Channel name for agent commands. */
const COMMANDS_CHANNEL = "agent:commands";

/** Channel name for agent status updates (runtime -> control plane). */
const STATUS_CHANNEL = "agent:status";

// -- Publisher (used by control plane) ----------------------------------------

/**
 * Publish an agent command to Redis.
 * Called by the control plane when an agent lifecycle action is triggered.
 */
export async function publishCommand(command: AgentCommand): Promise<void> {
  const redis = getRedis();
  const message = JSON.stringify(command);

  await redis.publish(COMMANDS_CHANNEL, message);

  console.log(
    `[Events] Published ${command.command} for agent ${command.agentId}`,
  );
}

/**
 * Publish an agent status update to Redis.
 * Called by the runtime when an agent's status changes.
 */
export async function publishStatus(update: AgentStatusUpdate): Promise<void> {
  const redis = getRedis();
  const message = JSON.stringify(update);

  await redis.publish(STATUS_CHANNEL, message);
}

export interface AgentStatusUpdate {
  agentId: string;
  status: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// -- Subscriber (used by runtime) ---------------------------------------------

export type CommandHandler = (command: AgentCommand) => Promise<void>;

/**
 * Subscribe to agent commands from the control plane.
 *
 * Creates a dedicated Redis subscriber connection and invokes the handler
 * for each valid command received. Invalid messages are logged and skipped.
 *
 * Returns a cleanup function to unsubscribe and close the connection.
 */
export function subscribeToCommands(
  handler: CommandHandler,
): { unsubscribe: () => Promise<void> } {
  const subscriber = createSubscriber();

  subscriber.subscribe(COMMANDS_CHANNEL, (err) => {
    if (err) {
      console.error("[Events] Failed to subscribe to commands:", err.message);
    } else {
      console.log(`[Events] Subscribed to ${COMMANDS_CHANNEL}`);
    }
  });

  subscriber.on("message", (channel, message) => {
    if (channel !== COMMANDS_CHANNEL) return;

    try {
      const parsed = JSON.parse(message);
      const result = agentCommandSchema.safeParse(parsed);

      if (!result.success) {
        console.error(
          "[Events] Invalid command message:",
          result.error.issues,
        );
        return;
      }

      // Fire-and-forget: handler errors are logged but don't crash the subscriber.
      handler(result.data).catch((err) => {
        console.error(
          `[Events] Error handling ${result.data.command} for ${result.data.agentId}:`,
          err,
        );
      });
    } catch (err) {
      console.error("[Events] Failed to parse command message:", err);
    }
  });

  return {
    unsubscribe: async () => {
      await subscriber.unsubscribe(COMMANDS_CHANNEL);
      await subscriber.quit();
      console.log(`[Events] Unsubscribed from ${COMMANDS_CHANNEL}`);
    },
  };
}
