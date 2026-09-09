import { AssetMedia } from "@/components/AssetMedia";
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
  const requestedAward = scalar(params.award);
  const canJudge = role === "judge" || role === "admin";
  const selectedAward = requestedAward === "shortlist" && !canJudge ? "" : requestedAward;
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
    const shortlist = (asset.awards ?? []).find((award: any) => award.award_type === "shortlist");
    const weekKey = week ? `${week.year}-W${String(week.week_no).padStart(2, "0")}` : "";
    return { asset, submission, contributor, week, drive, winner, shortlist, weekKey };
  });

  const weeks = [...new Set(normalized.map((item) => item.weekKey).filter((week): week is string => Boolean(week)))].sort().reverse();
  const contributors = Array.from(new Set<string>(normalized.map((item) => item.contributor?.display_name).filter((name: unknown): name is string => typeof name === "string" && name.length > 0))).sort((a, b) => a.localeCompare(b, "ja"));
  const filtered = normalized.filter((item) => {
    if (selectedCategory && item.asset.category !== selectedCategory) return false;
    if (selectedWeek && item.weekKey !== selectedWeek) return false;
    if (selectedContributor && item.contributor?.display_name !== selectedContributor) return false;
    if (selectedAward === "winner" && !item.winner) return false;
    if (selectedAward === "shortlist" && !item.shortlist) return false;
    if (query) {
      const haystack = [item.asset.original_name, item.submission?.caption, item.contributor?.display_name, item.weekKey, item.asset.category]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(scalar(params.page));
  const page = Math.min(pageCount, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  function pageHref(target: number) {
    const next = new URLSearchParams();
    for (const key of ["category", "week", "contributor", "award", "q"]) {
      const value = key === "award" ? selectedAward : scalar(params[key]);
      if (value) next.set(key, value);
    }
    next.set("page", String(target));
    return `/?${next}`;
  }

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">FRC TEAM 9494 / HANABI</p><h1>Album-Sync<span className="title-dot">.</span></h1></div><nav aria-label="メインナビゲーション"><a href="https://log.9494hanabi.com">Hanabi Log ↗</a><span>{user.email}</span>{role === "admin" && <a href="/admin">Admin</a>}</nav></header>
    <div className="archive-heading"><h2>アルバム</h2></div>
    <form className="filters" action="/" method="get">
      <label>カテゴリ<select name="category" defaultValue={selectedCategory}><option value="">すべて</option><option value="snaps">Snaps</option><option value="shorts">Shorts</option><option value="films">Films</option></select></label>
      <label>活動週<select name="week" defaultValue={selectedWeek}><option value="">すべて</option>{weeks.map((week) => <option key={week} value={week}>{week}</option>)}</select></label>
      <label>投稿者<select name="contributor" defaultValue={selectedContributor}><option value="">すべて</option>{contributors.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>受賞<select name="award" defaultValue={selectedAward}><option value="">すべて</option>{canJudge && <option value="shortlist">Shortlist</option>}<option value="winner">Winner</option></select></label>
      <label className="search-field">検索<input type="search" name="q" defaultValue={scalar(params.q)} placeholder="キャプション・ファイル名・投稿者" /></label>
      <button type="submit">絞り込む</button>
      {(selectedCategory || selectedWeek || selectedContributor || selectedAward || query) && <a className="clear-filter" href="/">クリア</a>}
    </form>
    <p className="result-count">{filtered.length}件{filtered.length > 0 && ` · ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filtered.length)}件を表示`}{normalized.length === 500 && "（最新500件から検索）"}</p>
    {error && <p className="error">{error.message}</p>}
    <section className="grid">
      {visible.map(({ asset, submission, contributor, drive, winner, shortlist, weekKey }) => <article className="asset" id={`asset-${asset.id}`} key={asset.id}>
        <div className="media">
          <AssetMedia assetId={asset.id} mediaType={asset.media_type} name={asset.original_name} />
          <span className={`category ${asset.category}`}>{asset.category}</span>
          {winner && <span className="award">WINNER</span>}
          {canJudge && shortlist && !winner && <span className="award shortlist">SHORTLIST</span>}
        </div>
        <div className="meta">
          <div className="meta-line"><strong>{contributor?.display_name ?? "Unknown"}</strong><span>{weekKey}</span></div>
          {submission?.caption && <p>{submission.caption}</p>}
          <div className="links">{submission?.permalink && <a href={submission.permalink} target="_blank" rel="noopener noreferrer">Slack</a>}{drive?.drive_file_id && <a href={`https://drive.google.com/open?id=${drive.drive_file_id}`} target="_blank" rel="noopener noreferrer">Drive</a>}</div>
          {canJudge && <AdminAssetActions assetId={asset.id} canJudge canAdmin={role === "admin"} />}
        </div>
      </article>)}
    </section>
    {pageCount > 1 && <nav className="pagination" aria-label="ページ切り替え">
      {page > 1 ? <a className="button" href={pageHref(page - 1)}>← 前へ</a> : <span />}
      <span>{page} / {pageCount}</span>
      {page < pageCount ? <a className="button" href={pageHref(page + 1)}>次へ →</a> : <span />}
    </nav>}
    {!error && filtered.length === 0 && <p className="empty-state">条件に一致する作品はありません。</p>}
    <footer className="footer"><span>9494 HANABI / ALBUM-SYNC</span><a href="https://9494hanabi.com" target="_blank" rel="noopener noreferrer">Hanabi公式サイト ↗</a></footer>
  </main>;
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
