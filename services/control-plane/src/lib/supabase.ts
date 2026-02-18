import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for the Control Plane API.
 *
 * Uses the service role key (not the anon key) because the backend needs
 * to bypass RLS for administrative operations. RLS still protects direct
 * client access from the frontend.
 *
 * Environment variables are injected via Cloud Run from Secret Manager
 * (configured in Sprint 1 infra).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Lazily initialized singleton. */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = requireEnv("SUPABASE_URL");
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    client = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
