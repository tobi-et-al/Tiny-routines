-- Run this once in the Supabase SQL editor.
create table if not exists public.baby_shared_state (
  id text primary key,
  data jsonb not null default '{"name":"little one","entries":[],"activeTimer":null,"nightMode":false,"deletedEntries":{},"profile":{},"reminders":{"enabled":false,"intervalHours":3},"feedingPlan":{"enabled":true,"dayOfLife":4,"topUpMl":30},"planSessions":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.baby_shared_state enable row level security;

create policy "family can read shared state"
  on public.baby_shared_state for select to anon using (true);

create policy "family can create shared state"
  on public.baby_shared_state for insert to anon with check (id = 'family');

create policy "family can update shared state"
  on public.baby_shared_state for update to anon using (id = 'family') with check (id = 'family');
