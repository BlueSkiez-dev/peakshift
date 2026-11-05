-- PeakShift authoritative state store (also created automatically on first connection).
-- One JSONB document, mutated only inside row-locked transactions (SELECT ... FOR UPDATE).
create table if not exists peakshift_state (
  id int primary key,
  seed_version text not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Short-lived shared cache (AG Studio agent thinking-block replay across serverless instances).
create table if not exists peakshift_kv (
  k text primary key,
  v jsonb not null,
  created_at timestamptz not null default now()
);

-- The app connects server-side with the database URL only; never expose these tables to the
-- Supabase Data API.
alter table peakshift_state enable row level security;
alter table peakshift_kv enable row level security;
