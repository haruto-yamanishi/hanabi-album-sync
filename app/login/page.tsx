"use client";

import { createBrowserSupabase } from "@/lib/supabase/client";

export default function LoginPage() {
  async function login() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    });
  }
  return <main className="login"><div className="login-card"><p className="eyebrow">Hanabi</p><h1>Album-Sync</h1><button onClick={login}>Googleでログイン</button></div></main>;
}
