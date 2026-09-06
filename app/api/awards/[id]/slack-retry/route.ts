import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishInternal } from "@/lib/jobs";
import { publishAward } from "@/lib/awards";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole("admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const db = createServiceClient();
  await db.from("award_records").update({ notify_status: "QUEUED", notify_error: null }).eq("id", id);
  const queued = await publishInternal("/api/internal/award", { awardId: id }).catch(() => false);
  if (!queued) await publishAward(id);
  return NextResponse.json({ ok: true });
}
