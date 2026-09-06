import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishInternal } from "@/lib/jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole("admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const db = createServiceClient();
  const { data: run, error } = await db.from("migration_runs").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (run.state === "COMPLETED") return NextResponse.redirect(new URL("/admin", request.url), 303);

  await db.from("migration_runs").update({
    state: "QUEUED",
    error_message: null,
    finished_at: null
  }).eq("id", id);

  const queued = await publishInternal("/api/internal/migrate", { migrationId: id }).catch(() => false);
  if (!queued) {
    await db.from("migration_runs").update({
      state: "PAUSED",
      error_message: "QStash is not configured or publish failed. Configure QStash and resume again."
    }).eq("id", id);
  }

  return NextResponse.redirect(new URL("/admin", request.url), 303);
}
