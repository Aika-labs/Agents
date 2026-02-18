import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabase } from "../lib/supabase.js";
import type { AppEnv } from "../types/env.js";
import type { AuthUser } from "./auth.js";

/**
 * API key authentication middleware for machine-to-machine (M2M) calls.
 *
 * Checks for an `X-API-Key` header. If present, validates the key against
 * the `api_keys` table in Supabase and populates the Hono context with
 * a synthetic AuthUser representing the key owner.
 *
 * If no API key header is present, the middleware is a no-op and defers
 * to the next middleware (typically JWT auth).
 *
 * API keys are hashed with SHA-256 before storage. The raw key is only
 * known to the client at creation time.
 *
 * Table schema (to be added in a future migration):
 *
 *   create table public.api_keys (
 *     id          uuid primary key default gen_random_uuid(),
 *     owner_id    uuid not null references auth.users(id),
 *     key_hash    text not null unique,
 *     label       text not null,
 *     scopes      text[] not null default '{}',
 *     is_active   boolean not null default true,
 *     last_used_at timestamptz,
 *     expires_at  timestamptz,
 *     created_at  timestamptz not null default now()
 *   );
 */

/**
 * Hash an API key using SHA-256 (Web Crypto API, available in Node 18+).
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * API key middleware. Must be mounted BEFORE the JWT auth middleware.
 *
 * Flow:
 * 1. If X-API-Key header is absent -> skip (call next()).
 * 2. Hash the key and look it up in api_keys table.
 * 3. If valid and active -> set AuthUser in context, skip JWT auth.
 * 4. If invalid -> return 401.
 */
export async function apiKeyMiddleware(
  c: Context<AppEnv>,
  next: Next,
): Promise<void> {
  const apiKey = c.req.header("X-API-Key");

  if (!apiKey) {
    // No API key provided -- fall through to JWT auth.
    await next();
    return;
  }

  if (apiKey.length < 32 || apiKey.length > 128) {
    throw new HTTPException(401, {
      message: "Invalid API key format",
    });
  }

  const keyHash = await hashApiKey(apiKey);
  const db = getSupabase();

  const { data, error } = await db
    .from("api_keys")
    .select("id, owner_id, label, scopes, is_active, expires_at")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data) {
    throw new HTTPException(401, {
      message: "Invalid API key",
    });
  }

  if (!data.is_active) {
    throw new HTTPException(401, {
      message: "API key is deactivated",
    });
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    throw new HTTPException(401, {
      message: "API key has expired",
    });
  }

  // Populate AuthUser from the API key owner.
  const authUser: AuthUser = {
    id: data.owner_id as string,
    role: "service",
    metadata: {
      authMethod: "api_key",
      apiKeyId: data.id,
      apiKeyLabel: data.label,
      scopes: data.scopes,
    },
  };

  c.set("user", authUser);

  // Update last_used_at (fire-and-forget).
  void Promise.resolve(
    db
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id),
  ).catch((err: unknown) => {
    console.error("[API_KEY] Failed to update last_used_at:", err);
  });

  await next();
}
