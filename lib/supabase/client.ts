"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createBrowserSupabase() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) {
    throw new Error(
      "Missing environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key);
}
