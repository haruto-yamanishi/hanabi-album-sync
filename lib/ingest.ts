import { createServiceClient } from "@/lib/supabase/server";
import { downloadSlackFile, getSlackFile, getSlackPermalink, getSlackThread, getSlackUser } from "@/lib/slack";
import { classifyCategory, isoWeekFromSlackTs } from "@/lib/week";
import { ensureDriveFolder, sha256, uploadDriveResumable } from "@/lib/drive";

export async function ingestSlackReply(input: { channelId: string; parentTs: string; messageTs: string }) {
  const db = createServiceClient();
  const thread = await getSlackThread(input.channelId, input.parentTs);
  const parent = thread[0];
  const reply = thread.find((message) => message.ts === input.messageTs);
  if (!parent || !reply) throw new Error("Slack parent/reply not found");
  const category = classifyCategory(parent.text);
  if (!category) return { submissionId: null, assetIds: [], synced: 0, skipped: reply.files?.length ?? 0, failed: 0, unclassified: true };
  if (!reply.files?.length) return { submissionId: null, assetIds: [], synced: 0, skipped: 0, failed: 0 };

  const week = isoWeekFromSlackTs(parent.ts);
  const { data: weekRow, error: weekError } = await db.from("competition_weeks").upsert({
    year: week.year, week_no: week.weekNo, starts_on: week.start, ends_on: week.end
  }, { onConflict: "year,week_no" }).select("id").single();
  if (weekError) throw weekError;

  let contributorId: string | null = null;
  if (reply.user) {
    const slackUser = await getSlackUser(reply.user);
    const displayName = slackUser.profile?.display_name || slackUser.profile?.real_name || slackUser.real_name || reply.user;
    const { data: contributor, error } = await db.from("contributors").upsert({
      slack_user_id: reply.user,
      display_name: displayName,
      email: slackUser.profile?.email ?? null
    }, { onConflict: "slack_user_id" }).select("id").single();
    if (error) throw error;
    contributorId = contributor.id;
  }

  const permalink = await getSlackPermalink(input.channelId, input.messageTs).catch(() => null);
  const { data: submission, error: submissionError } = await db.from("submissions").upsert({
    parent_ts: input.parentTs,
    message_ts: input.messageTs,
    contributor_id: contributorId,
    week_id: weekRow.id,
    caption: reply.text ?? "",
    permalink,
    reactions: reply.reactions ?? []
  }, { onConflict: "message_ts" }).select("id").single();
  if (submissionError) throw submissionError;

  const root = required("GOOGLE_DRIVE_ROOT_FOLDER_ID");
  const yearFolder = await ensureDriveFolder(String(week.year), root);
  const weekFolder = await ensureDriveFolder(week.folder, yearFolder);
  const categoryFolder = await ensureDriveFolder(capitalize(category), weekFolder);

  const assetIds: string[] = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const listed of reply.files) {
    let assetId: string | null = null;

    try {
      const { data: source, error: sourceError } = await db.from("slack_file_sources")
        .select("asset_id")
        .eq("slack_file_id", listed.id)
        .maybeSingle();
      if (sourceError) throw sourceError;

      if (source?.asset_id) {
        assetId = source.asset_id;
        const [{ data: existingAsset, error: existingAssetError }, { data: existingDrive, error: existingDriveError }] = await Promise.all([
          db.from("assets").select("id,state").eq("id", assetId).single(),
          db.from("drive_objects").select("drive_file_id").eq("asset_id", assetId).maybeSingle()
        ]);
        if (existingAssetError) throw existingAssetError;
        if (existingDriveError) throw existingDriveError;

        if (existingDrive?.drive_file_id || existingAsset.state === "SYNCED") {
          if (existingDrive?.drive_file_id && existingAsset.state !== "SYNCED") {
            await db.from("assets").update({ state: "SYNCED", warning: null }).eq("id", assetId);
          }
          assetIds.push(source.asset_id);
          skipped += 1;
          continue;
        }

        const { error: retryStateError } = await db.from("assets")
          .update({ state: "FETCHING", warning: null })
          .eq("id", assetId);
        if (retryStateError) throw retryStateError;
      }

      const file = await getSlackFile(listed.id);
      const bytes = await downloadSlackFile(file);
      const checksum = sha256(bytes);
      const created = new Date((file.timestamp ?? Number(input.messageTs.split(".")[0])) * 1000);
      const storedName = `${stamp(created)}_${category}_${file.id}_${sanitize(file.name || file.id)}`;
      const mimeType = file.mimetype || "application/octet-stream";
      const mediaType = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("image/") ? "image" : "other";

      if (assetId) {
        const { error: assetUpdateError } = await db.from("assets").update({
          submission_id: submission.id,
          category,
          media_type: mediaType,
          original_name: file.name || file.id,
          mime_type: mimeType,
          bytes: bytes.byteLength,
          checksum,
          state: "UPLOADING",
          warning: null
        }).eq("id", assetId);
        if (assetUpdateError) throw assetUpdateError;
      } else {
        const { data: asset, error: assetError } = await db.from("assets").insert({
          submission_id: submission.id,
          category,
          media_type: mediaType,
          original_name: file.name || file.id,
          mime_type: mimeType,
          bytes: bytes.byteLength,
          checksum,
          state: "UPLOADING"
        }).select("id").single();
        if (assetError) throw assetError;
        assetId = asset.id;

        const { error: sourceInsertError } = await db.from("slack_file_sources").insert({
          asset_id: assetId,
          slack_file_id: file.id,
          created_at: created.toISOString()
        });
        if (sourceInsertError) throw sourceInsertError;
      }

      if (!assetId) throw new Error(`Asset ID missing for Slack file ${listed.id}`);
      const persistedAssetId = assetId;
      const uploaded = await uploadDriveResumable({ name: storedName, mimeType, parentId: categoryFolder, bytes });
      const { error: driveError } = await db.from("drive_objects").upsert({
        asset_id: persistedAssetId,
        drive_file_id: uploaded.id,
        parent_folder_id: categoryFolder,
        stored_name: storedName
      }, { onConflict: "asset_id" });
      if (driveError) throw driveError;

      const { error: syncedError } = await db.from("assets").update({ state: "SYNCED", warning: null }).eq("id", persistedAssetId);
      if (syncedError) throw syncedError;
      assetIds.push(persistedAssetId);
      synced += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      if (assetId) {
        const { error: markFailedError } = await db.from("assets")
          .update({ state: "FAILED_RETRYABLE", warning: message.slice(0, 500) })
          .eq("id", assetId);
        if (markFailedError) console.error("failed to mark asset retryable", { asset_id: assetId, error: markFailedError });
      }
      console.error("asset ingest failed", { slack_file_id: listed.id, asset_id: assetId, error });
    }
  }

  return { submissionId: submission.id, assetIds, synced, skipped, failed };
}

function stamp(date: Date) {
  const p = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}_${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

function sanitize(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
