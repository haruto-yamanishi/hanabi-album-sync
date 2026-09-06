import { NextResponse } from "next/server";
import { processSyncJob, verifyInternal } from "@/lib/jobs";

export async function POST(request: Request) {
  if (!verifyInternal(request.headers)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { jobId } = await request.json() as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "job_id_required" }, { status: 400 });

  try {
    const result = await processSyncJob(jobId);
    return NextResponse.json({ ok: true, ...result });
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : String(syncError);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
