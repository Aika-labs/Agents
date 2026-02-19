import { describe, it, expect } from "vitest";
import { createMcpServer } from "./server.js";

describe("MCP Server", () => {
  it("creates an MCP server instance", () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });

  it("exposes the underlying Server object", () => {
    const server = createMcpServer();
    // McpServer wraps a lower-level Server instance.
    expect(server.server).toBeDefined();
  });

  it("can be created multiple times (independent instances)", () => {
    const server1 = createMcpServer();
    const server2 = createMcpServer();
    expect(server1).not.toBe(server2);
    expect(server1.server).not.toBe(server2.server);
  });
});
