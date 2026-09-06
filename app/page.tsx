import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AdminAssetActions } from "@/components/AdminAssetActions";

export default async function AlbumPage() {
  const { user, role } = await requireUser();
  const db = createServiceClient();
  const { data: assets, error } = await db.from("assets").select(`
    id,category,media_type,original_name,mime_type,bytes,state,created_at,
    submission:submissions(caption,permalink,message_ts,
      contributor:contributors(display_name,slack_user_id),
      week:competition_weeks(year,week_no)
    ),
    drive:drive_objects(drive_file_id),
    awards:award_records(id,award_type,notify_status)
  `).eq("state", "SYNCED").order("created_at", { ascending: false }).limit(250);

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">TEAM HANABI / MEDIA ARCHIVE</p><h1>Album-Sync</h1></div><nav><span>{user.email}</span>{role === "admin" && <a href="/admin">Admin</a>}</nav></header>
    <section className="hero"><h2>Slackに投げる。<br/>あとは全部、残る。</h2><p>Snaps / Shorts / Films をDriveへ同期し、週・投稿者・受賞履歴ごとに辿れるアルバム。</p></section>
    {error && <p className="error">{error.message}</p>}
    <section className="grid">
      {(assets ?? []).map((asset: any) => {
        const submission = Array.isArray(asset.submission) ? asset.submission[0] : asset.submission;
        const contributor = Array.isArray(submission?.contributor) ? submission.contributor[0] : submission?.contributor;
        const week = Array.isArray(submission?.week) ? submission.week[0] : submission?.week;
        const drive = Array.isArray(asset.drive) ? asset.drive[0] : asset.drive;
        const winner = (asset.awards ?? []).find((a: any) => a.award_type === "winner");
        return <article className="asset" id={`asset-${asset.id}`} key={asset.id}>
          <div className="media">
            {asset.media_type === "video" ? <video controls preload="metadata" src={`/api/assets/${asset.id}/media`} /> : <img loading="lazy" src={`/api/assets/${asset.id}/media`} alt={asset.original_name} />}
            <span className={`category ${asset.category}`}>{asset.category}</span>
            {winner && <span className="award">WINNER</span>}
          </div>
          <div className="meta">
            <div className="meta-line"><strong>{contributor?.display_name ?? "Unknown"}</strong><span>{week ? `${week.year}-W${String(week.week_no).padStart(2, "0")}` : ""}</span></div>
            {submission?.caption && <p>{submission.caption}</p>}
            <div className="links">{submission?.permalink && <a href={submission.permalink} target="_blank">Slack</a>}{drive?.drive_file_id && <a href={`https://drive.google.com/open?id=${drive.drive_file_id}`} target="_blank">Drive</a>}</div>
            <AdminAssetActions assetId={asset.id} canJudge={role === "judge" || role === "admin"} canAdmin={role === "admin"} />
          </div>
        </article>;
      })}
    </section>
  </main>;
}
