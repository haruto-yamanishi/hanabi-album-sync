import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AdminAssetActions } from "@/components/AdminAssetActions";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AlbumPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, role } = await requireUser();
  const params = await searchParams;
  const selectedCategory = scalar(params.category);
  const selectedWeek = scalar(params.week);
  const selectedContributor = scalar(params.contributor);
  const selectedAward = scalar(params.award);
  const query = scalar(params.q).trim().toLowerCase();

  const db = createServiceClient();
  const { data: assets, error } = await db.from("assets").select(`
    id,category,media_type,original_name,mime_type,bytes,state,created_at,
    submission:submissions(caption,permalink,message_ts,
      contributor:contributors(display_name,slack_user_id),
      week:competition_weeks(year,week_no)
    ),
    drive:drive_objects(drive_file_id),
    awards:award_records(id,award_type,notify_status)
  `).eq("state", "SYNCED").order("created_at", { ascending: false }).limit(500);

  const normalized = (assets ?? []).map((asset: any) => {
    const submission = Array.isArray(asset.submission) ? asset.submission[0] : asset.submission;
    const contributor = Array.isArray(submission?.contributor) ? submission.contributor[0] : submission?.contributor;
    const week = Array.isArray(submission?.week) ? submission.week[0] : submission?.week;
    const drive = Array.isArray(asset.drive) ? asset.drive[0] : asset.drive;
    const winner = (asset.awards ?? []).find((award: any) => award.award_type === "winner");
    const weekKey = week ? `${week.year}-W${String(week.week_no).padStart(2, "0")}` : "";
    return { asset, submission, contributor, week, drive, winner, weekKey };
  });

  const weeks = [...new Set(normalized.map((item) => item.weekKey).filter((week): week is string => Boolean(week)))].sort().reverse();
  const contributors = Array.from(new Set<string>(normalized.map((item) => item.contributor?.display_name).filter((name: unknown): name is string => typeof name === "string" && name.length > 0))).sort((a, b) => a.localeCompare(b, "ja"));
  const filtered = normalized.filter((item) => {
    if (selectedCategory && item.asset.category !== selectedCategory) return false;
    if (selectedWeek && item.weekKey !== selectedWeek) return false;
    if (selectedContributor && item.contributor?.display_name !== selectedContributor) return false;
    if (selectedAward === "winner" && !item.winner) return false;
    if (query) {
      const haystack = [item.asset.original_name, item.submission?.caption, item.contributor?.display_name, item.weekKey, item.asset.category]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">TEAM HANABI / MEDIA ARCHIVE</p><h1>Album-Sync</h1></div><nav><span>{user.email}</span>{role === "admin" && <a href="/admin">Admin</a>}</nav></header>
    <section className="hero"><h2>Slackに投げる。<br/>あとは全部、残る。</h2><p>Snaps / Shorts / Films をDriveへ同期し、週・投稿者・受賞履歴ごとに辿れるアルバム。</p></section>
    <form className="filters" action="/" method="get">
      <label>Category<select name="category" defaultValue={selectedCategory}><option value="">All</option><option value="snaps">Snaps</option><option value="shorts">Shorts</option><option value="films">Films</option></select></label>
      <label>Week<select name="week" defaultValue={selectedWeek}><option value="">All</option>{weeks.map((week) => <option key={week} value={week}>{week}</option>)}</select></label>
      <label>Contributor<select name="contributor" defaultValue={selectedContributor}><option value="">All</option>{contributors.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Award<select name="award" defaultValue={selectedAward}><option value="">All</option><option value="winner">Winner</option></select></label>
      <label className="search-field">Search<input type="search" name="q" defaultValue={scalar(params.q)} placeholder="caption / file / name" /></label>
      <button type="submit">Filter</button>
      {(selectedCategory || selectedWeek || selectedContributor || selectedAward || query) && <a className="clear-filter" href="/">Clear</a>}
    </form>
    <p className="result-count">{filtered.length} / {normalized.length} assets</p>
    {error && <p className="error">{error.message}</p>}
    <section className="grid">
      {filtered.map(({ asset, submission, contributor, drive, winner, weekKey }) => <article className="asset" id={`asset-${asset.id}`} key={asset.id}>
        <div className="media">
          {asset.media_type === "video" ? <video controls preload="metadata" src={`/api/assets/${asset.id}/media`} /> : <img loading="lazy" src={`/api/assets/${asset.id}/media`} alt={asset.original_name} />}
          <span className={`category ${asset.category}`}>{asset.category}</span>
          {winner && <span className="award">WINNER</span>}
        </div>
        <div className="meta">
          <div className="meta-line"><strong>{contributor?.display_name ?? "Unknown"}</strong><span>{weekKey}</span></div>
          {submission?.caption && <p>{submission.caption}</p>}
          <div className="links">{submission?.permalink && <a href={submission.permalink} target="_blank">Slack</a>}{drive?.drive_file_id && <a href={`https://drive.google.com/open?id=${drive.drive_file_id}`} target="_blank">Drive</a>}</div>
          <AdminAssetActions assetId={asset.id} canJudge={role === "judge" || role === "admin"} canAdmin={role === "admin"} />
        </div>
      </article>)}
    </section>
    {!error && filtered.length === 0 && <p className="empty-state">条件に一致する作品はありません。</p>}
  </main>;
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
