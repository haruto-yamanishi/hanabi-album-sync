import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishInternal } from "@/lib/jobs";
import { ingestSlackReply } from "@/lib/ingest";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole("admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const db = createServiceClient();
  const { data: job, error } = await db.from("sync_jobs").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (job.state === "SUCCEEDED") return NextResponse.redirect(new URL("/admin", request.url), 303);

  await db.from("sync_jobs").update({
    state: "QUEUED",
    error_code: null,
    error_message: null,
    finished_at: null
  }).eq("id", id);

  const queued = await publishInternal("/api/internal/sync", { jobId: id }).catch(() => false);
  if (!queued) {
    await db.from("sync_jobs").update({
      state: "RUNNING",
      attempt: (job.attempt ?? 0) + 1,
      started_at: new Date().toISOString()
    }).eq("id", id);

    try {
      const result = await ingestSlackReply({
        channelId: job.channel_id,
        parentTs: job.parent_ts,
        messageTs: job.message_ts
      });
      await db.from("sync_jobs").update({
        state: "SUCCEEDED",
        result,
        error_code: null,
        error_message: null,
        finished_at: new Date().toISOString()
      }).eq("id", id);
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      await db.from("sync_jobs").update({
        state: "FAILED",
        error_message: message,
        finished_at: new Date().toISOString()
      }).eq("id", id);
    }
  }

  return NextResponse.redirect(new URL("/admin", request.url), 303);
}
