import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";

export type AppRole = "viewer" | "judge" | "admin";

export function roleForEmail(email?: string | null): AppRole | null {
  if (!email) return null;
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  if (domain && !email.toLowerCase().endsWith(`@${domain}`)) return null;

  const admins = csv(process.env.ADMIN_EMAILS);
  const judges = csv(process.env.JUDGE_EMAILS);
  if (admins.has(email.toLowerCase())) return "admin";
  if (judges.has(email.toLowerCase())) return "judge";
  return "viewer";
}

export async function currentUser() {
  const supabase = await createUserClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const role = roleForEmail(user.email);
  if (!role) redirect("/login?error=not_allowed");
  return { user, role };
}

export async function requireApiRole(minimum: AppRole) {
  const user = await currentUser();
  const role = roleForEmail(user?.email);
  if (!user || !role) return { ok: false as const, status: 401, error: "unauthorized" };
  if (rank(role) < rank(minimum)) return { ok: false as const, status: 403, error: "forbidden" };
  return { ok: true as const, user, role };
}

function rank(role: AppRole) {
  return role === "admin" ? 3 : role === "judge" ? 2 : 1;
}

function csv(value?: string) {
  return new Set((value ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
}
