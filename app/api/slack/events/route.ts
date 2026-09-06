import { NextResponse } from "next/server";
import { enqueueSync } from "@/lib/jobs";
import { verifySlackSignature } from "@/lib/slack";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySlackSignature(raw, request.headers)) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  const payload = JSON.parse(raw) as any;
  if (payload.type === "url_verification") return NextResponse.json({ challenge: payload.challenge });

  const event = payload.event;
  const channel = process.env.SLACK_CHANNEL_ID || "C093FCBUZC7";
  if (event?.type === "message" && event.channel === channel && event.thread_ts && event.ts && !event.subtype) {
    await enqueueSync({ channelId: channel, parentTs: event.thread_ts, messageTs: event.ts });
  }
  return NextResponse.json({ ok: true });
}
