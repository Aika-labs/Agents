import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns true when the required Supabase env vars are present.
 * Used to gate auth features so the dashboard can run in demo mode
 * on Vercel (or locally) without a Supabase project.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Create a Supabase browser client.
 * Returns `null` when the env vars are not set so callers can
 * fall back to demo / unauthenticated mode.
 */
export function createClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
