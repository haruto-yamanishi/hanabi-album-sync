import crypto from "node:crypto";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function driveAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const credentials = JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON")) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const data = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !data.access_token) throw new Error(`Google OAuth failed: ${data.error ?? response.status}`);
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

export async function ensureDriveFolder(name: string, parentId: string) {
  const token = await driveAccessToken();
  const escaped = name.replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and name='${escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  const data = await list.json() as { files?: Array<{ id: string; name: string }> };
  if (!list.ok) throw new Error(`Drive folder lookup failed: ${list.status}`);
  if (data.files?.[0]) return data.files[0].id;

  const create = await fetch(`${DRIVE_API}/files?supportsAllDrives=true&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
  });
  const created = await create.json() as { id?: string };
  if (!create.ok || !created.id) throw new Error(`Drive folder create failed: ${create.status}`);
  return created.id;
}

export async function uploadDriveResumable(input: { name: string; mimeType: string; parentId: string; bytes: Buffer }) {
  const token = await driveAccessToken();
  const start = await fetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,md5Checksum,size`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.bytes.byteLength)
    },
    body: JSON.stringify({ name: input.name, mimeType: input.mimeType, parents: [input.parentId] })
  });
  if (!start.ok) throw new Error(`Drive resumable start failed: ${start.status}`);
  const location = start.headers.get("location");
  if (!location) throw new Error("Drive resumable upload did not return a session URL");

  const upload = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": input.mimeType, "Content-Length": String(input.bytes.byteLength) },
    body: new Uint8Array(input.bytes)
  });
  const data = await upload.json() as { id?: string; name?: string; size?: string };
  if (!upload.ok || !data.id) throw new Error(`Drive upload failed: ${upload.status}`);
  return data;
}

export async function fetchDriveMedia(fileId: string, range?: string | null) {
  const token = await driveAccessToken();
  return fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) },
    cache: "no-store"
  });
}

export function sha256(bytes: Buffer) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function b64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
