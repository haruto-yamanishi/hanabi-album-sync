export type AlbumCategory = "snaps" | "shorts" | "films";

export function classifyCategory(text: string | null | undefined): AlbumCategory | null {
  const value = (text ?? "").toLowerCase();
  if (value.includes("hanabi snaps")) return "snaps";
  if (value.includes("hanabi shorts")) return "shorts";
  if (value.includes("hanabi films")) return "films";
  return null;
}

export function isoWeekFromSlackTs(ts: string) {
  const date = new Date(Number(ts.split(".")[0]) * 1000);
  return isoWeek(date);
}

export function isoWeek(date: Date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  const monday = new Date(utc);
  monday.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() || 7) - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    year: utc.getUTCFullYear(),
    weekNo,
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
    key: `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`,
    folder: `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}_${formatMMDD(monday)}-${formatMMDD(sunday)}`
  };
}

function formatMMDD(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}
