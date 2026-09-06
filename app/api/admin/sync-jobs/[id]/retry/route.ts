import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { retrySyncJob } from "@/lib/jobs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiRole("admin");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;

  try {
    await retrySyncJob(id);
    return NextResponse.redirect(new URL("/admin", request.url), 303);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
