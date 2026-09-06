"use client";

import { useState } from "react";

export function AdminAssetActions({ assetId, canJudge, canAdmin }: { assetId: string; canJudge: boolean; canAdmin: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function setAward(awardType: "shortlist" | "winner") {
    if (awardType === "winner" && !window.confirm("この作品をWinnerとして確定し、Slackへ受賞者と作品を投稿します。実行しますか？")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/awards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, awardType })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "award update failed");
      setMessage(awardType === "winner" ? "Winner確定・Slack通知処理を開始しました" : "Shortlistに追加しました");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!canJudge) return null;
  return (
    <div className="admin-actions">
      <button disabled={busy} onClick={() => setAward("shortlist")}>Shortlist</button>
      {canAdmin && <button className="winner" disabled={busy} onClick={() => setAward("winner")}>Winner確定 → Slack</button>}
      {message && <small>{message}</small>}
    </div>
  );
}
