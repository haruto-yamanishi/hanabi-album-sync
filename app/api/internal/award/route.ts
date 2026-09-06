import { NextResponse } from "next/server";
import { verifyInternal } from "@/lib/jobs";
import { publishAward } from "@/lib/awards";

export async function POST(request: Request) {
  if (!verifyInternal(request.headers)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { awardId } = await request.json() as { awardId: string };
  try {
    await publishAward(awardId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
