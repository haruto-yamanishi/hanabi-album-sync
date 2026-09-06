create extension if not exists pgcrypto;

create table if not exists contributors (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text unique not null,
  display_name text not null,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists competition_weeks (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  week_no integer not null,
  starts_on date not null,
  ends_on date not null,
  unique(year, week_no)
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  parent_ts text not null,
  message_ts text unique not null,
  contributor_id uuid references contributors(id),
  week_id uuid not null references competition_weeks(id),
  caption text not null default '',
  permalink text,
  reactions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  category text not null check (category in ('snaps','shorts','films')),
  media_type text not null check (media_type in ('image','video','other')),
  original_name text not null,
  mime_type text not null,
  bytes bigint not null default 0,
  checksum text,
  state text not null check (state in ('DISCOVERED','FETCHING','UPLOADING','SYNCED','FAILED_RETRYABLE','FAILED_FINAL','ARCHIVED')),
  warning text,
  created_at timestamptz not null default now()
);

create table if not exists slack_file_sources (
  asset_id uuid primary key references assets(id) on delete cascade,
  slack_file_id text unique not null,
  private_url_ref text,
  created_at timestamptz
);

create table if not exists drive_objects (
  asset_id uuid primary key references assets(id) on delete cascade,
  drive_file_id text unique not null,
  parent_folder_id text not null,
  stored_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists award_records (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references competition_weeks(id),
  category text not null check (category in ('snaps','shorts','films')),
  asset_id uuid not null references assets(id),
  award_type text not null check (award_type in ('winner','shortlist')),
  decided_by text,
  decided_at timestamptz not null default now(),
  notify_status text not null default 'NOT_REQUIRED' check (notify_status in ('NOT_REQUIRED','QUEUED','POSTING','POSTED','FAILED')),
  notify_error text,
  slack_result_ts text,
  slack_result_file_id text,
  result_history jsonb not null default '[]'::jsonb
);

create unique index if not exists award_unique_winner on award_records(week_id, category) where award_type='winner';
create unique index if not exists award_unique_shortlist_asset on award_records(asset_id) where award_type='shortlist';

create table if not exists sync_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('event','migration')),
  source_id text unique not null,
  channel_id text not null,
  parent_ts text not null,
  message_ts text not null,
  state text not null check (state in ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  attempt integer not null default 0,
  error_code text,
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists migration_runs (
  id uuid primary key default gen_random_uuid(),
  state text not null check (state in ('QUEUED','RUNNING','PAUSED','FAILED','COMPLETED')),
  cursor text,
  counters jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table contributors enable row level security;
alter table competition_weeks enable row level security;
alter table submissions enable row level security;
alter table assets enable row level security;
alter table slack_file_sources enable row level security;
alter table drive_objects enable row level security;
alter table award_records enable row level security;
alter table sync_jobs enable row level security;
alter table migration_runs enable row level security;

-- No anon/authenticated policies by design. The Next.js server uses only the service-role client
-- after validating the logged-in user's role. This keeps Drive/Slack identifiers off direct client queries.
