import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishInternal } from "@/lib/jobs";

export async function POST() {
  const auth = await requireApiRole("admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const db = createServiceClient();
  const { data, error } = await db.from("migration_runs").insert({ state: "QUEUED", counters: {} }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const queued = await publishInternal("/api/internal/migrate", { migrationId: data.id }).catch(() => false);
  if (!queued) await db.from("migration_runs").update({ state: "PAUSED", error_message: "QStash is not configured. Configure it, then start a new migration." }).eq("id", data.id);
  return NextResponse.json({ migration: data, queued });
}
