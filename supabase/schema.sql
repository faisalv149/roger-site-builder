-- Roger Site Builder storage on Supabase. Run once: Supabase → SQL Editor → paste → Run.
-- Records (builds, conversations, publishes) live here; generated site files go in the private "roger"
-- Storage bucket, which the app creates by itself. The app uses the service role key, which bypasses RLS;
-- RLS stays on with no policies, so the public anon key can't read any of it.
create table if not exists public.roger_docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.roger_docs enable row level security;
