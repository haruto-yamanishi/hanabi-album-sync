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
  return <main className="login"><div className="login-card"><p className="eyebrow">FRC TEAM 9494 / HANABI</p><h1>Album-Sync<span className="title-dot">.</span></h1><p>挑戦の日々を、ここに。<br />チームの写真と映像を振り返ろう。</p><button onClick={login}>Googleでログイン</button><a className="login-footer" href="https://9494hanabi.com">Hanabi公式サイト ↗</a></div></main>;
}
