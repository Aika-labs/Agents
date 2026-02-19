import { describe, it, expect, vi, beforeEach } from "vitest";
import { a2aUserBuilder } from "./auth.js";
import type { Request } from "express";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createMockRequest(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

describe("a2aUserBuilder", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: auth not required.
    delete process.env["A2A_AUTH_REQUIRED"];
  });

  it("allows unauthenticated access in dev mode (no headers)", async () => {
    const user = await a2aUserBuilder(createMockRequest());
    expect(user.isAuthenticated).toBe(true);
    expect(user.userName).toBe("anonymous-dev");
  });

  it("validates Bearer token against control plane", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const user = await a2aUserBuilder(
      createMockRequest({ authorization: "Bearer test-token-12345678" }),
    );

    expect(user.isAuthenticated).toBe(true);
    expect(user.userName).toContain("bearer:");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("validates API key against control plane", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const user = await a2aUserBuilder(
      createMockRequest({ "x-api-key": "ak_test_key_12345678" }),
    );

    expect(user.isAuthenticated).toBe(true);
    expect(user.userName).toContain("apikey:");
  });

  it("rejects invalid token when auth is required", async () => {
    process.env["A2A_AUTH_REQUIRED"] = "true";
    mockFetch.mockResolvedValueOnce({ ok: false });

    const user = await a2aUserBuilder(
      createMockRequest({ authorization: "Bearer bad-token" }),
    );

    expect(user.isAuthenticated).toBe(false);
    expect(user.userName).toBe("anonymous");
  });

  it("returns unauthenticated when auth required and no headers", async () => {
    process.env["A2A_AUTH_REQUIRED"] = "true";

    const user = await a2aUserBuilder(createMockRequest());

    expect(user.isAuthenticated).toBe(false);
    expect(user.userName).toBe("anonymous");
  });

  it("handles fetch errors gracefully in dev mode", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const user = await a2aUserBuilder(
      createMockRequest({ authorization: "Bearer some-token" }),
    );

    // Falls through to dev mode anonymous access.
    expect(user.isAuthenticated).toBe(true);
    expect(user.userName).toBe("anonymous-dev");
  });
});
