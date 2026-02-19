"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextValue {
  /** Current user, or a synthetic demo user when Supabase is not configured. */
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** Whether the app is running without Supabase (demo / preview mode). */
  demo: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  demo: false,
  signOut: async () => {},
});

/** Minimal synthetic user so pages that read `user.email` etc. don't crash. */
const DEMO_USER = {
  id: "demo-user",
  email: "demo@agent-os.local",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: { full_name: "Demo User" },
  created_at: new Date().toISOString(),
} as unknown as User;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const demo = !isSupabaseConfigured();
  // In demo mode, initialise with a synthetic user so no effect is needed.
  const [user, setUser] = useState<User | null>(demo ? DEMO_USER : null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!demo);

  useEffect(() => {
    // Nothing to do in demo mode -- state was initialised above.
    if (demo) return;

    // When demo is false the env vars are present, so createClient() is non-null.
    const supabase = createClient()!;

    // Get initial session.
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [demo]);

  const signOut = useCallback(async () => {
    if (demo) return;
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
  }, [demo]);

  return (
    <AuthContext.Provider value={{ user, session, loading, demo, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
