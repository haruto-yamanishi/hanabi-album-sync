import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchDriveMedia, fetchDriveThumbnail } from "@/lib/drive";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole("viewer");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db.from("assets").select("mime_type,drive:drive_objects(drive_file_id)").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const drive = Array.isArray(data.drive) ? data.drive[0] : data.drive;
  if (!drive?.drive_file_id) return NextResponse.json({ error: "drive_object_missing" }, { status: 404 });
  if (new URL(request.url).searchParams.get("thumbnail") === "1") {
    const thumbnail = await fetchDriveThumbnail(drive.drive_file_id);
    if (!thumbnail?.ok) return NextResponse.json({ error: "thumbnail_unavailable" }, { status: 404 });
    return new Response(thumbnail.body, { headers: {
      "Content-Type": thumbnail.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, max-age=300",
      "Vary": "Cookie",
      "X-Content-Type-Options": "nosniff"
    } });
  }
  const upstream = await fetchDriveMedia(drive.drive_file_id, request.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: `drive_${upstream.status}` }, { status: 502 });
  const headers = new Headers();
  headers.set("Content-Type", data.mime_type || upstream.headers.get("content-type") || "application/octet-stream");
  for (const key of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Vary", "Cookie");
  return new Response(upstream.body, { status: upstream.status, headers });
}
