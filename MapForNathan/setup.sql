-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again if you already ran an earlier version.
create table if not exists trees (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,            -- your custom tree ID
  species text not null default '',
  notes text not null default '',
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);

alter table trees enable row level security;

-- Remove older policies (including the sign-in-only ones)
drop policy if exists "public read" on trees;
drop policy if exists "auth insert" on trees;
drop policy if exists "auth update" on trees;
drop policy if exists "auth delete" on trees;
drop policy if exists "open insert" on trees;
drop policy if exists "open update" on trees;
drop policy if exists "open delete" on trees;

-- No sign-in: anyone with the page can view, add, edit and delete trees
create policy "public read" on trees for select using (true);
create policy "open insert" on trees for insert to anon, authenticated with check (true);
create policy "open update" on trees for update to anon, authenticated using (true) with check (true);
create policy "open delete" on trees for delete to anon, authenticated using (true);