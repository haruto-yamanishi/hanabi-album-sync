alter table award_records
  add column if not exists notify_started_at timestamptz,
  add column if not exists notify_lease_id uuid;

create index if not exists award_notify_pending_idx
  on award_records(notify_status, notify_started_at)
  where award_type = 'winner' and notify_status in ('QUEUED', 'POSTING', 'FAILED');
