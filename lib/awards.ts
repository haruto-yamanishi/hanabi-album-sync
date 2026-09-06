import crypto from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchDriveMedia } from "@/lib/drive";
import { uploadSlackResult } from "@/lib/slack";

const POSTING_LEASE_MS = 10 * 60 * 1000;

export async function publishAward(awardId: string) {
  const db = createServiceClient();
  const { data: award, error } = await db.from("award_records").select(`
    id, award_type, notify_status, notify_started_at, notify_lease_id, slack_result_ts, result_history,
    category,
    week:competition_weeks(year,week_no),
    asset:assets(id,original_name,mime_type,category,
      submission:submissions(caption,contributor:contributors(display_name,slack_user_id)),
      drive:drive_objects(drive_file_id)
    )
  `).eq("id", awardId).single();
  if (error) throw error;
  if (award.notify_status === "POSTED") return award;

  const claimable = ["QUEUED", "FAILED", "POSTING"].includes(award.notify_status);
  if (!claimable) return award;
  if (award.notify_status === "POSTING" && !isLeaseStale(award.notify_started_at)) return award;

  const leaseId = crypto.randomUUID();
  let claim = db.from("award_records")
    .update({
      notify_status: "POSTING",
      notify_error: null,
      notify_started_at: new Date().toISOString(),
      notify_lease_id: leaseId
    })
    .eq("id", awardId)
    .eq("notify_status", award.notify_status);

  claim = award.notify_lease_id
    ? claim.eq("notify_lease_id", award.notify_lease_id)
    : claim.is("notify_lease_id", null);

  const { data: claimed } = await claim.select("id").maybeSingle();
  if (!claimed) return award;

  const channel = process.env.SLACK_CHANNEL_ID || "C093FCBUZC7";
  const week = unwrap(award.week);
  const asset = unwrap(award.asset);
  const submission = unwrap(asset.submission);
  const contributor = unwrap(submission.contributor);
  const drive = unwrap(asset.drive);
  const history = Array.isArray(award.result_history) ? award.result_history : [];
  const isCorrection = Boolean(award.slack_result_ts || history.some((entry: any) => entry?.ts || entry?.replaced_asset_id));
  const mention = contributor?.slack_user_id ? `<@${contributor.slack_user_id}>` : contributor?.display_name || "Unknown";
  const weekKey = `${week.year}-W${String(week.week_no).padStart(2, "0")}`;
  const albumBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || "";
  const detailUrl = `${albumBase}/#asset-${asset.id}`;
  const text = [
    `${isCorrection ? "🔁" : "🏆"} *Hanabi Best Shot Winner${isCorrection ? " Updated" : ""} / ${weekKey} / ${capitalize(award.category)}*`,
    `Winner: ${mention}`,
    submission.caption ? `「${submission.caption}」` : null,
    detailUrl ? `Albumで見る: ${detailUrl}` : null
  ].filter(Boolean).join("\n");

  try {
    const media = await fetchDriveMedia(drive.drive_file_id);
    if (!media.ok) throw new Error(`Drive media fetch failed: ${media.status}`);
    const bytes = Buffer.from(await media.arrayBuffer());
    const uploaded = await uploadSlackResult(channel, asset.original_name, bytes, text);
    const resultTs = uploaded.messageTs;
    const resultFileId = uploaded.fileId;

    await db.from("award_records").update({
      notify_status: "POSTED",
      notify_started_at: null,
      notify_lease_id: null,
      slack_result_ts: resultTs,
      slack_result_file_id: resultFileId,
      result_history: [...history, { ts: resultTs, file_id: resultFileId, asset_id: asset.id, posted_at: new Date().toISOString() }]
    }).eq("id", awardId).eq("notify_lease_id", leaseId);
  } catch (notifyError) {
    await db.from("award_records").update({
      notify_status: "FAILED",
      notify_started_at: null,
      notify_lease_id: null,
      notify_error: notifyError instanceof Error ? notifyError.message : String(notifyError)
    }).eq("id", awardId).eq("notify_lease_id", leaseId);
    throw notifyError;
  }
}

function isLeaseStale(startedAt: string | null | undefined) {
  if (!startedAt) return true;
  const started = new Date(startedAt).getTime();
  return !Number.isFinite(started) || Date.now() - started >= POSTING_LEASE_MS;
}

function unwrap<T>(value: T | T[] | null): T {
  if (Array.isArray(value)) return value[0] as T;
  if (!value) throw new Error("Award relation is missing");
  return value;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
