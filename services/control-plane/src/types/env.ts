import type { AuthUser } from "../middleware/auth.js";

/**
 * Hono environment type for the Control Plane API.
 *
 * Defines typed variables available via c.get() / c.set() across
 * all middleware and route handlers.
 */
export type AppEnv = {
  Variables: {
    /** Authenticated user from JWT middleware. Undefined on public routes. */
    user: AuthUser;
    /** Unique request ID (set by request-id middleware). */
    requestId: string;
  };
};
