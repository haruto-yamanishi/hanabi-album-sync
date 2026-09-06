import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const auth = await requireApiRole("viewer");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const media = url.searchParams.get("media");
  const db = createServiceClient();
  let query = db.from("assets").select("*, submission:submissions(*, contributor:contributors(*), week:competition_weeks(*)), drive:drive_objects(*), awards:award_records(*)").order("created_at", { ascending: false }).limit(250);
  if (category) query = query.eq("category", category);
  if (media) query = query.eq("media_type", media);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ assets: data });
}
