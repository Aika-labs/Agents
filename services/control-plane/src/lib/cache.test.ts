import { describe, it, expect } from "vitest";
import { cacheKey, ownerCacheKey } from "./cache.js";

describe("cacheKey", () => {
  it("builds a namespaced key with cache: prefix", () => {
    expect(cacheKey("agent", "abc-123")).toBe("cache:agent:abc-123");
  });

  it("handles empty key", () => {
    expect(cacheKey("ns", "")).toBe("cache:ns:");
  });

  it("handles complex namespaces", () => {
    expect(cacheKey("agent-metrics", "uuid-456")).toBe("cache:agent-metrics:uuid-456");
  });
});

describe("ownerCacheKey", () => {
  it("builds an owner-scoped key", () => {
    expect(ownerCacheKey("list", "user-1", "page-1")).toBe("cache:list:user-1:page-1");
  });

  it("handles empty sub-key for prefix matching", () => {
    expect(ownerCacheKey("agents", "user-1", "")).toBe("cache:agents:user-1:");
  });
});
