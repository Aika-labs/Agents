import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlatformAgentExecutor } from "./executor.js";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import type { Message } from "@a2a-js/sdk";

// Mock fetch globally.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createMockEventBus(): ExecutionEventBus & { messages: Message[] } {
  const messages: Message[] = [];
  return {
    messages,
    publish(event: Message) {
      messages.push(event);
    },
    finished() {
      // no-op
    },
  } as unknown as ExecutionEventBus & { messages: Message[] };
}

function createMockContext(text: string, contextId = "ctx-1"): RequestContext {
  return {
    userMessage: {
      kind: "message",
      messageId: "msg-1",
      role: "user",
      parts: [{ kind: "text", text }],
      contextId,
    },
    contextId,
  } as unknown as RequestContext;
}

describe("PlatformAgentExecutor", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("rejects non-text messages", async () => {
    const executor = new PlatformAgentExecutor(null);
    const eventBus = createMockEventBus();
    const context = {
      userMessage: {
        kind: "message",
        messageId: "msg-1",
        role: "user",
        parts: [{ kind: "data", data: {} }],
        contextId: "ctx-1",
      },
      contextId: "ctx-1",
    } as unknown as RequestContext;

    await executor.execute(context, eventBus);

    expect(eventBus.messages).toHaveLength(1);
    expect(eventBus.messages[0]!.parts[0]).toMatchObject({
      kind: "text",
      text: expect.stringContaining("only process text"),
    });
  });

  it("handles 'list agents' platform command", async () => {
    const executor = new PlatformAgentExecutor(null);
    const eventBus = createMockEventBus();
    const context = createMockContext("list agents");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "a1", name: "Agent One", status: "running" },
          { id: "a2", name: "Agent Two", status: "stopped" },
        ],
      }),
    });

    await executor.execute(context, eventBus);

    expect(eventBus.messages).toHaveLength(1);
    const text = (eventBus.messages[0]!.parts[0] as { kind: string; text: string }).text;
    expect(text).toContain("Agent One");
    expect(text).toContain("Agent Two");
  });

  it("returns default message for unknown platform commands", async () => {
    const executor = new PlatformAgentExecutor(null);
    const eventBus = createMockEventBus();
    const context = createMockContext("do something random");

    await executor.execute(context, eventBus);

    expect(eventBus.messages).toHaveLength(1);
    const text = (eventBus.messages[0]!.parts[0] as { kind: string; text: string }).text;
    expect(text).toContain("Agent Operating System");
  });

  it("forwards messages to a specific agent", async () => {
    const executor = new PlatformAgentExecutor("agent-123");
    const eventBus = createMockEventBus();
    const context = createMockContext("Hello agent");

    // Mock session creation.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "session-1" }),
    });

    // Mock message send.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: "Hello from agent!" }),
    });

    await executor.execute(context, eventBus);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(eventBus.messages).toHaveLength(1);
    const text = (eventBus.messages[0]!.parts[0] as { kind: string; text: string }).text;
    expect(text).toBe("Hello from agent!");
  });

  it("handles session creation failure", async () => {
    const executor = new PlatformAgentExecutor("agent-123");
    const eventBus = createMockEventBus();
    const context = createMockContext("Hello agent");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Unauthorized",
    });

    await executor.execute(context, eventBus);

    expect(eventBus.messages).toHaveLength(1);
    const text = (eventBus.messages[0]!.parts[0] as { kind: string; text: string }).text;
    expect(text).toContain("Error:");
    expect(text).toContain("Failed to create session");
  });

  it("cancelTask signals finished", async () => {
    const executor = new PlatformAgentExecutor(null);
    let finishedCalled = false;
    const eventBus = {
      publish: vi.fn(),
      finished: () => {
        finishedCalled = true;
      },
    } as unknown as ExecutionEventBus;

    await executor.cancelTask("task-1", eventBus);
    expect(finishedCalled).toBe(true);
  });
});
