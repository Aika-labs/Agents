import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseBody, parseQuery } from "./validate.js";

describe("parseBody", () => {
  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive(),
    tags: z.array(z.string()).default([]),
  });

  it("returns parsed data for valid input", () => {
    const result = parseBody(schema, { name: "Alice", age: 30 });
    expect(result).toEqual({ name: "Alice", age: 30, tags: [] });
  });

  it("applies defaults for optional fields", () => {
    const result = parseBody(schema, { name: "Bob", age: 25, tags: ["admin"] });
    expect(result.tags).toEqual(["admin"]);
  });

  it("throws HTTPException 400 for missing required fields", () => {
    expect(() => parseBody(schema, { age: 30 })).toThrowError("Validation failed");
  });

  it("throws HTTPException 400 for wrong types", () => {
    expect(() => parseBody(schema, { name: "Alice", age: "not-a-number" })).toThrowError(
      "Validation failed",
    );
  });

  it("includes field path in error message", () => {
    try {
      parseBody(schema, { name: "", age: -1 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("Validation failed");
    }
  });
});

describe("parseQuery", () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  it("parses valid query params with coercion", () => {
    const result = parseQuery(schema, { limit: "50", offset: "10" });
    expect(result).toEqual({ limit: 50, offset: 10 });
  });

  it("applies defaults for missing params", () => {
    const result = parseQuery(schema, {});
    expect(result).toEqual({ limit: 20, offset: 0 });
  });

  it("throws for invalid values", () => {
    expect(() => parseQuery(schema, { limit: "0" })).toThrowError("Validation failed");
  });
});
