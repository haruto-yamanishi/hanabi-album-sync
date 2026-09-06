import { createServiceClient } from "@/lib/supabase/server";
import { fetchDriveMedia } from "@/lib/drive";
import { postSlackMessage, uploadSlackResult } from "@/lib/slack";

export async function publishAward(awardId: string) {
  const db = createServiceClient();
  const { data: award, error } = await db.from("award_records").select(`
    id, award_type, notify_status, slack_result_ts, result_history,
    category,
    week:competition_weeks(year,week_no),
    asset:assets(id,original_name,mime_type,category,
      submission:submissions(caption,contributor:contributors(display_name,slack_user_id)),
      drive:drive_objects(drive_file_id)
    )
  `).eq("id", awardId).single();
  if (error) throw error;
  if (award.notify_status === "POSTED") return award;

  const { data: claimed } = await db.from("award_records")
    .update({ notify_status: "POSTING", notify_error: null })
    .eq("id", awardId)
    .in("notify_status", ["QUEUED", "FAILED"])
    .select("id")
    .maybeSingle();
  if (!claimed) return award;

  const channel = process.env.SLACK_CHANNEL_ID || "C093FCBUZC7";
  const week = unwrap(award.week);
  const asset = unwrap(award.asset);
  const submission = unwrap(asset.submission);
  const contributor = unwrap(submission.contributor);
  const drive = unwrap(asset.drive);
  const mention = contributor?.slack_user_id ? `<@${contributor.slack_user_id}>` : contributor?.display_name || "Unknown";
  const weekKey = `${week.year}-W${String(week.week_no).padStart(2, "0")}`;
  const albumBase = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || "";
  const detailUrl = `${albumBase}/?asset=${asset.id}`;
  const text = [
    `🏆 *Hanabi Best Shot Winner / ${weekKey} / ${capitalize(award.category)}*`,
    `Winner: ${mention}`,
    submission.caption ? `「${submission.caption}」` : null,
    detailUrl ? `Albumで見る: ${detailUrl}` : null
  ].filter(Boolean).join("\n");

  try {
    let resultTs: string | null = null;
    let resultFileId: string | null = null;
    try {
      const media = await fetchDriveMedia(drive.drive_file_id);
      if (!media.ok) throw new Error(`Drive media fetch failed: ${media.status}`);
      const bytes = Buffer.from(await media.arrayBuffer());
      const uploaded = await uploadSlackResult(channel, asset.original_name, bytes, text);
      resultTs = uploaded.messageTs;
      resultFileId = uploaded.fileId;
    } catch (uploadError) {
      console.error("Slack winner media upload failed; falling back to text", uploadError);
      const fallback = `${text}\nDrive原本: https://drive.google.com/open?id=${drive.drive_file_id}`;
      const posted = await postSlackMessage(channel, fallback);
      resultTs = posted.ts;
    }

    const history = Array.isArray(award.result_history) ? award.result_history : [];
    await db.from("award_records").update({
      notify_status: "POSTED",
      slack_result_ts: resultTs,
      slack_result_file_id: resultFileId,
      result_history: [...history, { ts: resultTs, file_id: resultFileId, asset_id: asset.id, posted_at: new Date().toISOString() }]
    }).eq("id", awardId);
  } catch (notifyError) {
    await db.from("award_records").update({
      notify_status: "FAILED",
      notify_error: notifyError instanceof Error ? notifyError.message : String(notifyError)
    }).eq("id", awardId);
    throw notifyError;
  }
}

function unwrap<T>(value: T | T[] | null): T {
  if (Array.isArray(value)) return value[0] as T;
  if (!value) throw new Error("Award relation is missing");
  return value;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}
