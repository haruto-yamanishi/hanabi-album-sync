"use client";

import { useState } from "react";

export function AdminPanel() {
  const [status, setStatus] = useState("");
  async function migrate() {
    if (!window.confirm("Slackチャンネルの過去投稿Migrationを開始します。続行しますか？")) return;
    setStatus("Starting...");
    const response = await fetch("/api/admin/migrations", { method: "POST" });
    const data = await response.json();
    setStatus(response.ok ? `Migration ${data.migration.id} を作成しました` : data.error);
  }
  return <div className="panel"><button onClick={migrate}>過去Slack投稿をMigration</button>{status && <p>{status}</p>}</div>;
}
