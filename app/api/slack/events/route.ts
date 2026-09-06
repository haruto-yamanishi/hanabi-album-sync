import { NextResponse } from "next/server";
import { enqueueSync } from "@/lib/jobs";
import { verifySlackSignature } from "@/lib/slack";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifySlackSignature(raw, request.headers)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const payload = JSON.parse(raw) as any;
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const event = payload.event;
  const channel = process.env.SLACK_CHANNEL_ID || "C093FCBUZC7";
  if (event?.type !== "message" || event.channel !== channel) {
    return NextResponse.json({ ok: true });
  }

  // Slack may deliver uploaded files as an ordinary message or as the file_share subtype.
  // Both shapes carry the thread timestamp and files array.
  const isAssetReply =
    event.thread_ts &&
    event.ts &&
    (!event.subtype || event.subtype === "file_share") &&
    ((event.files?.length ?? 0) > 0 || (event.x_files?.length ?? 0) > 0);

  if (isAssetReply) {
    await enqueueSync({ channelId: channel, parentTs: event.thread_ts, messageTs: event.ts });
  }

  // Keep captions/reactions current without touching the archived Drive original.
  if (event.subtype === "message_changed" && event.message?.ts && event.message?.thread_ts) {
    const db = createServiceClient();
    await db.from("submissions").update({
      caption: event.message.text ?? "",
      reactions: event.message.reactions ?? [],
      updated_at: new Date().toISOString()
    }).eq("message_ts", event.message.ts);
  }

  return NextResponse.json({ ok: true });
}
