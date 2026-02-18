import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/**
 * Parse a request body against a Zod schema.
 * Throws a 400 HTTPException with structured validation errors on failure.
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new HTTPException(400, {
      message: `Validation failed: ${details.map((d) => d.message).join("; ")}`,
    });
  }
  return result.data as z.infer<T>;
}

/**
 * Parse query parameters against a Zod schema.
 * Identical to parseBody but semantically distinct for clarity.
 */
export function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): z.infer<T> {
  return parseBody(schema, data);
}
