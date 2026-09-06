import crypto from "node:crypto";

const SLACK_API = "https://slack.com/api";
const MAX_SLACK_ATTEMPTS = 3;

type SlackShares = Record<string, Record<string, Array<{ ts?: string }>>>;

export type SlackFile = {
  id: string;
  name: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
  timestamp?: number;
  shares?: SlackShares;
};

export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  files?: SlackFile[];
  reactions?: unknown[];
};

export function verifySlackSignature(rawBody: string, headers: Headers) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function slackApi<T>(method: string, params: Record<string, string | number | undefined> = {}) {
  const token = required("SLACK_BOT_TOKEN");

  for (let attempt = 1; attempt <= MAX_SLACK_ATTEMPTS; attempt += 1) {
    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => value !== undefined && body.set(key, String(value)));
    const response = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store"
    });

    if (response.status === 429 && attempt < MAX_SLACK_ATTEMPTS) {
      await sleep(retryAfterMs(response.headers));
      continue;
    }

    const data = await response.json() as T & { ok: boolean; error?: string };
    if (!data.ok) {
      if (data.error === "ratelimited" && attempt < MAX_SLACK_ATTEMPTS) {
        await sleep(retryAfterMs(response.headers));
        continue;
      }
      throw new Error(`Slack ${method}: ${data.error ?? response.statusText}`);
    }
    return data;
  }

  throw new Error(`Slack ${method}: retry exhausted`);
}

export async function getSlackThread(channel: string, parentTs: string) {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const result = await slackApi<{ messages: SlackMessage[]; response_metadata?: { next_cursor?: string } }>("conversations.replies", {
      channel, ts: parentTs, limit: 200, inclusive: 1, cursor
    });
    messages.push(...(result.messages ?? []));
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return messages;
}

export async function getSlackPermalink(channel: string, messageTs: string) {
  const result = await slackApi<{ permalink: string }>("chat.getPermalink", { channel, message_ts: messageTs });
  return result.permalink;
}

export async function getSlackUser(userId: string) {
  const result = await slackApi<{ user: { id: string; real_name?: string; profile?: { display_name?: string; real_name?: string; email?: string } } }>("users.info", { user: userId });
  return result.user;
}

export async function getSlackFile(fileId: string) {
  const result = await slackApi<{ file: SlackFile }>("files.info", { file: fileId });
  return result.file;
}

export async function downloadSlackFile(file: SlackFile) {
  const url = file.url_private_download ?? file.url_private;
  if (!url) throw new Error(`Slack file ${file.id} has no download URL`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${required("SLACK_BOT_TOKEN")}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Slack file download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function listSlackChannelHistory(channel: string, cursor?: string | null) {
  return slackApi<{ messages: SlackMessage[]; response_metadata?: { next_cursor?: string } }>("conversations.history", {
    channel, limit: 50, cursor: cursor || undefined
  });
}

export async function postSlackMessage(channel: string, text: string, threadTs?: string) {
  return slackApi<{ ts: string }>("chat.postMessage", { channel, text, thread_ts: threadTs });
}

export async function uploadSlackResult(channel: string, filename: string, bytes: Buffer, initialComment: string) {
  const token = required("SLACK_BOT_TOKEN");
  const upload = await slackApi<{ upload_url: string; file_id: string }>("files.getUploadURLExternal", {
    filename, length: bytes.byteLength
  });

  const uploadResponse = await fetch(upload.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(bytes)
  });
  if (!uploadResponse.ok) throw new Error(`Slack external upload failed: ${uploadResponse.status}`);

  const form = new URLSearchParams({
    files: JSON.stringify([{ id: upload.file_id, title: filename }]),
    channel_id: channel,
    initial_comment: initialComment
  });
  const response = await fetch(`${SLACK_API}/files.completeUploadExternal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const data = await response.json() as { ok: boolean; error?: string; files?: SlackFile[] };
  if (!data.ok) throw new Error(`Slack files.completeUploadExternal: ${data.error}`);

  // completeUploadExternal can omit share metadata. files.info after completion
  // exposes the channel share timestamp, which we persist for audit/history.
  const completedFile = await getSlackFile(upload.file_id).catch(() => null);
  return {
    fileId: upload.file_id,
    messageTs: extractShareTs(completedFile ? [completedFile] : data.files, channel)
  };
}

function extractShareTs(files: SlackFile[] | undefined, channel: string) {
  for (const file of files ?? []) {
    for (const kind of ["public", "private"]) {
      const ts = file.shares?.[kind]?.[channel]?.[0]?.ts;
      if (ts) return ts;
    }
  }
  return null;
}

function retryAfterMs(headers: Headers) {
  const seconds = Number(headers.get("retry-after") || "1");
  return Math.max(1, Number.isFinite(seconds) ? seconds : 1) * 1000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
