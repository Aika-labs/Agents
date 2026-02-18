import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabase } from "../lib/supabase.js";

/**
 * Authenticated user extracted from a Supabase JWT.
 * Stored in Hono context via c.set("user", ...).
 */
export interface AuthUser {
  /** Supabase Auth user ID (UUID). */
  id: string;
  /** Email address (may be undefined for phone-only users). */
  email?: string;
  /** User role from Supabase (e.g. "authenticated"). */
  role?: string;
  /** Full user metadata from Supabase Auth. */
  metadata: Record<string, unknown>;
}

/**
 * Hono variable map extension for typed context access.
 * Usage: c.get("user") returns AuthUser.
 */
export type AuthVariables = {
  user: AuthUser;
};

/**
 * JWT authentication middleware.
 *
 * Extracts the Bearer token from the Authorization header, verifies it
 * against Supabase Auth (server-side verification via getUser(jwt)),
 * and stores the authenticated user in the Hono context.
 *
 * Returns 401 if the token is missing or invalid.
 */
export async function authMiddleware(c: Context, next: Next): Promise<void> {
  // If a user was already set by a prior middleware (e.g. API key auth),
  // skip JWT verification.
  try {
    const existing = c.get("user");
    if (existing?.id) {
      await next();
      return;
    }
  } catch {
    // No user set yet -- proceed with JWT auth.
  }

  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    throw new HTTPException(401, {
      message: "Missing Authorization header",
    });
  }

  // Support "Bearer <token>" format.
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!token) {
    throw new HTTPException(401, {
      message: "Missing bearer token",
    });
  }

  const db = getSupabase();

  // Verify the JWT server-side. getUser(jwt) calls Supabase Auth to validate
  // the token signature, expiry, and returns the user object.
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);

  if (error || !user) {
    throw new HTTPException(401, {
      message: error?.message ?? "Invalid or expired token",
    });
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    metadata: (user.user_metadata as Record<string, unknown>) ?? {},
  };

  c.set("user", authUser);

  await next();
}
