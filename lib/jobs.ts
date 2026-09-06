import { createServiceClient } from "@/lib/supabase/server";

export async function enqueueSync(input: { channelId: string; parentTs: string; messageTs: string; sourceType?: "event" | "migration" }) {
  const db = createServiceClient();
  const sourceId = `${input.channelId}:${input.messageTs}`;
  const { data: existing } = await db.from("sync_jobs").select("id,state").eq("source_id", sourceId).maybeSingle();

  if (existing) {
    if (existing.state === "FAILED") {
      await db.from("sync_jobs").update({
        state: "QUEUED",
        error_code: null,
        error_message: null,
        finished_at: null
      }).eq("id", existing.id);
      await publishInternal("/api/internal/sync", { jobId: existing.id });
    }
    return existing.id as string;
  }

  const { data, error } = await db.from("sync_jobs").insert({
    source_type: input.sourceType ?? "event",
    source_id: sourceId,
    channel_id: input.channelId,
    parent_ts: input.parentTs,
    message_ts: input.messageTs,
    state: "QUEUED"
  }).select("id").single();
  if (error) throw error;
  await publishInternal("/api/internal/sync", { jobId: data.id });
  return data.id as string;
}

export async function publishInternal(path: string, body: unknown) {
  const token = process.env.QSTASH_TOKEN;
  const base = process.env.PUBLIC_BASE_URL;
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!token || !base || !secret) return false;
  const target = `${base.replace(/\/$/, "")}${path}`;
  const response = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(target)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Upstash-Forward-X-Internal-Secret": secret,
      "Upstash-Retries": "3"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`QStash publish failed: ${response.status}`);
  return true;
}

export function verifyInternal(headers: Headers) {
  const expected = process.env.INTERNAL_JOB_SECRET;
  return Boolean(expected && headers.get("x-internal-secret") === expected);
}
