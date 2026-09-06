import { NextResponse } from "next/server";
import { verifyInternal } from "@/lib/jobs";
import { createServiceClient } from "@/lib/supabase/server";
import { ingestSlackReply } from "@/lib/ingest";

export async function POST(request: Request) {
  if (!verifyInternal(request.headers)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { jobId } = await request.json() as { jobId: string };
  const db = createServiceClient();
  const { data: job, error } = await db.from("sync_jobs").select("*").eq("id", jobId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (job.state === "SUCCEEDED") return NextResponse.json({ ok: true, skipped: true });

  await db.from("sync_jobs").update({ state: "RUNNING", attempt: (job.attempt ?? 0) + 1, started_at: new Date().toISOString() }).eq("id", jobId);
  try {
    const result = await ingestSlackReply({ channelId: job.channel_id, parentTs: job.parent_ts, messageTs: job.message_ts });
    await db.from("sync_jobs").update({ state: "SUCCEEDED", finished_at: new Date().toISOString(), result }).eq("id", jobId);
    return NextResponse.json({ ok: true, result });
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : String(syncError);
    await db.from("sync_jobs").update({ state: "FAILED", error_message: message, finished_at: new Date().toISOString() }).eq("id", jobId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
