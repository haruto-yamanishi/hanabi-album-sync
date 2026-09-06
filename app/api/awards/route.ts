import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { publishInternal } from "@/lib/jobs";

export async function POST(request: Request) {
  const body = await request.json() as { assetId?: string; awardType?: "winner" | "shortlist" };
  const minimum = body.awardType === "shortlist" ? "judge" : "admin";
  const auth = await requireApiRole(minimum);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!body.assetId || !body.awardType) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = createServiceClient();
  const { data: asset, error: assetError } = await db.from("assets").select("id,category,submission:submissions(week_id)").eq("id", body.assetId).single();
  if (assetError) return NextResponse.json({ error: assetError.message }, { status: 404 });
  const submission = Array.isArray(asset.submission) ? asset.submission[0] : asset.submission;
  if (!submission?.week_id) return NextResponse.json({ error: "week_missing" }, { status: 409 });

  if (body.awardType === "shortlist") {
    const { data: existing } = await db.from("award_records").select("id").eq("asset_id", body.assetId).eq("award_type", "shortlist").maybeSingle();
    if (existing) return NextResponse.json({ award: existing, duplicate: true });
    const { data, error } = await db.from("award_records").insert({
      week_id: submission.week_id, category: asset.category, asset_id: body.assetId, award_type: "shortlist",
      decided_by: auth.user.email, notify_status: "NOT_REQUIRED"
    }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ award: data });
  }

  const { data: existingWinner } = await db.from("award_records").select("*").eq("week_id", submission.week_id).eq("category", asset.category).eq("award_type", "winner").maybeSingle();
  if (existingWinner?.asset_id === body.assetId && existingWinner.notify_status === "POSTED") {
    return NextResponse.json({ award: existingWinner, duplicate: true });
  }

  let award;
  if (existingWinner) {
    const history = Array.isArray(existingWinner.result_history) ? existingWinner.result_history : [];
    const { data, error } = await db.from("award_records").update({
      asset_id: body.assetId,
      decided_by: auth.user.email,
      decided_at: new Date().toISOString(),
      notify_status: "QUEUED",
      notify_error: null,
      result_history: existingWinner.asset_id === body.assetId ? history : [...history, { replaced_asset_id: existingWinner.asset_id, replaced_at: new Date().toISOString() }]
    }).eq("id", existingWinner.id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    award = data;
  } else {
    const { data, error } = await db.from("award_records").insert({
      week_id: submission.week_id, category: asset.category, asset_id: body.assetId, award_type: "winner",
      decided_by: auth.user.email, notify_status: "QUEUED"
    }).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    award = data;
  }

  const queued = await publishInternal("/api/internal/award", { awardId: award.id }).catch(() => false);
  if (!queued) {
    const { publishAward } = await import("@/lib/awards");
    await publishAward(award.id);
  }
  return NextResponse.json({ award });
}
