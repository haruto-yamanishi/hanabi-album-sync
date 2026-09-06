import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AdminPanel } from "@/components/AdminPanel";

export default async function AdminPage() {
  const { role } = await requireUser();
  if (role !== "admin") return <main className="shell"><p>Forbidden</p></main>;
  const db = createServiceClient();
  const [{ data: jobs }, { data: migrations }, { data: awards }] = await Promise.all([
    db.from("sync_jobs").select("*").order("created_at", { ascending: false }).limit(25),
    db.from("migration_runs").select("*").order("created_at", { ascending: false }).limit(10),
    db.from("award_records").select("id,category,award_type,notify_status,notify_error,decided_at").eq("award_type", "winner").order("decided_at", { ascending: false }).limit(20)
  ]);
  return <main className="shell"><header className="topbar"><div><p className="eyebrow">OPERATIONS</p><h1>Admin</h1></div><a href="/">Album</a></header>
    <AdminPanel/>
    <section className="admin-section"><h2>Winner notifications</h2><div className="table">{(awards ?? []).map((a:any)=><div className="row" key={a.id}><code>{a.category}</code><span>{a.notify_status}</span><small>{a.notify_error ?? ""}</small>{a.notify_status === "FAILED" && <form action={`/api/awards/${a.id}/slack-retry`} method="post"><button>Retry</button></form>}</div>)}</div></section>
    <section className="admin-section"><h2>Migration</h2><div className="table">{(migrations ?? []).map((m:any)=><div className="row" key={m.id}><code>{m.id.slice(0,8)}</code><span>{m.state}</span><small>{JSON.stringify(m.counters ?? {})}</small></div>)}</div></section>
    <section className="admin-section"><h2>Sync jobs</h2><div className="table">{(jobs ?? []).map((j:any)=><div className="row" key={j.id}><code>{j.source_type}</code><span>{j.state}</span><small>{j.message_ts}</small><small>{j.error_message ?? ""}</small></div>)}</div></section>
  </main>;
}
