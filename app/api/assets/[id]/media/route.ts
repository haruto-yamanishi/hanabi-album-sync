import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchDriveMedia } from "@/lib/drive";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole("viewer");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const db = createServiceClient();
  const { data, error } = await db.from("assets").select("mime_type,drive:drive_objects(drive_file_id)").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const drive = Array.isArray(data.drive) ? data.drive[0] : data.drive;
  if (!drive?.drive_file_id) return NextResponse.json({ error: "drive_object_missing" }, { status: 404 });
  const upstream = await fetchDriveMedia(drive.drive_file_id, request.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) return NextResponse.json({ error: `drive_${upstream.status}` }, { status: 502 });
  const headers = new Headers();
  headers.set("Content-Type", data.mime_type || upstream.headers.get("content-type") || "application/octet-stream");
  for (const key of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set("Cache-Control", "private, max-age=300");
  return new Response(upstream.body, { status: upstream.status, headers });
}
