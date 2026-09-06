import { createServiceClient } from "@/lib/supabase/server";
import { ingestSlackReply } from "@/lib/ingest";

export async function enqueueSync(input: { channelId: string; parentTs: string; messageTs: string; sourceType?: "event" | "migration" }) {
  const db = createServiceClient();
  const sourceId = `${input.channelId}:${input.messageTs}`;
  const { data: existing, error: existingError } = await db.from("sync_jobs").select("id,state").eq("source_id", sourceId).maybeSingle();
  if (existingError) throw existingError;

  if (existing) {
    if (existing.state === "FAILED") {
      const { error: resetError } = await db.from("sync_jobs").update({
        state: "QUEUED",
        error_code: null,
        error_message: null,
        finished_at: null
      }).eq("id", existing.id).eq("state", "FAILED");
      if (resetError) throw resetError;
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

export async function processSyncJob(jobId: string) {
  const db = createServiceClient();
  const { data: job, error } = await db.from("sync_jobs").select("*").eq("id", jobId).single();
  if (error) throw error;
  if (job.state === "SUCCEEDED") return { skipped: true, result: job.result };

  const { data: claimed, error: claimError } = await db.from("sync_jobs").update({
    state: "RUNNING",
    attempt: (job.attempt ?? 0) + 1,
    started_at: new Date().toISOString(),
    finished_at: null,
    error_code: null,
    error_message: null
  }).eq("id", jobId).in("state", ["QUEUED", "FAILED"]).select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { skipped: true, result: job.result };

  try {
    const result = await ingestSlackReply({ channelId: job.channel_id, parentTs: job.parent_ts, messageTs: job.message_ts });
    if (result.failed > 0) {
      const message = `${result.failed} asset(s) failed to sync`;
      await db.from("sync_jobs").update({
        state: "FAILED",
        error_message: message,
        result,
        finished_at: new Date().toISOString()
      }).eq("id", jobId);
      throw new Error(message);
    }

    const { error: finishError } = await db.from("sync_jobs").update({
      state: "SUCCEEDED",
      error_code: null,
      error_message: null,
      finished_at: new Date().toISOString(),
      result
    }).eq("id", jobId);
    if (finishError) throw finishError;
    return { skipped: false, result };
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : String(syncError);
    await db.from("sync_jobs").update({
      state: "FAILED",
      error_message: message,
      finished_at: new Date().toISOString()
    }).eq("id", jobId);
    throw syncError;
  }
}

export async function retrySyncJob(jobId: string) {
  const db = createServiceClient();
  const { data: job, error } = await db.from("sync_jobs").select("id,state").eq("id", jobId).single();
  if (error) throw error;
  if (job.state === "RUNNING") return { queued: false, running: true };

  const { error: resetError } = await db.from("sync_jobs").update({
    state: "QUEUED",
    error_code: null,
    error_message: null,
    finished_at: null
  }).eq("id", jobId);
  if (resetError) throw resetError;

  const queued = await publishInternal("/api/internal/sync", { jobId }).catch(() => false);
  if (!queued) await processSyncJob(jobId);
  return { queued, running: false };
}

export async function publishInternal(path: string, body: unknown) {
  const token = process.env.QSTASH_TOKEN;
  const base = process.env.PUBLIC_BASE_URL;
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!token || !base || !secret) return false;

  const target = `${base.replace(/\/$/, "")}${path}`;
  const qstashBase = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(/\/$/, "");
  const response = await fetch(`${qstashBase}/v2/publish/${target}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Upstash-Forward-X-Internal-Secret": secret,
      "Upstash-Retries": "3"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`QStash publish failed: ${response.status}${details ? ` ${details}` : ""}`);
  }
  return true;
}

export function verifyInternal(headers: Headers) {
  const expected = process.env.INTERNAL_JOB_SECRET;
  return Boolean(expected && headers.get("x-internal-secret") === expected);
}
