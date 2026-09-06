import { NextResponse } from "next/server";
import { enqueueSync, publishInternal, verifyInternal } from "@/lib/jobs";
import { createServiceClient } from "@/lib/supabase/server";
import { listSlackChannelHistory } from "@/lib/slack";
import { classifyCategory } from "@/lib/week";

export async function POST(request: Request) {
  if (!verifyInternal(request.headers)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { migrationId } = await request.json() as { migrationId: string };
  const db = createServiceClient();
  const { data: run, error } = await db.from("migration_runs").select("*").eq("id", migrationId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (run.state === "PAUSED" || run.state === "COMPLETED") return NextResponse.json({ ok: true, state: run.state });

  const channel = process.env.SLACK_CHANNEL_ID || "C093FCBUZC7";
  const counters = { total_parents: 0, total_replies: 0, total_files: 0, queued: 0, ...(run.counters ?? {}) };
  await db.from("migration_runs").update({ state: "RUNNING" }).eq("id", migrationId);

  try {
    const page = await listSlackChannelHistory(channel, run.cursor);
    for (const parent of page.messages) {
      const category = classifyCategory(parent.text);
      if (!category || parent.thread_ts) continue;
      counters.total_parents += 1;
      const { getSlackThread } = await import("@/lib/slack");
      const replies = await getSlackThread(channel, parent.ts);
      for (const reply of replies.slice(1)) {
        counters.total_replies += 1;
        counters.total_files += reply.files?.length ?? 0;
        if (reply.files?.length) {
          await enqueueSync({ channelId: channel, parentTs: parent.ts, messageTs: reply.ts, sourceType: "migration" });
          counters.queued += 1;
        }
      }
    }
    const cursor = page.response_metadata?.next_cursor || null;
    const state = cursor ? "RUNNING" : "COMPLETED";
    await db.from("migration_runs").update({ cursor, counters, state, finished_at: cursor ? null : new Date().toISOString() }).eq("id", migrationId);
    if (cursor) await publishInternal("/api/internal/migrate", { migrationId });
    return NextResponse.json({ ok: true, cursor, counters, state });
  } catch (migrationError) {
    const message = migrationError instanceof Error ? migrationError.message : String(migrationError);
    await db.from("migration_runs").update({ state: "FAILED", error_message: message }).eq("id", migrationId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
