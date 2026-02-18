-- API Keys -- Machine-to-machine authentication for the Control Plane API.
-- Keys are hashed with SHA-256 before storage; the raw key is only known
-- to the client at creation time.

create table public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  key_hash    text not null unique,
  label       text not null,
  scopes      text[] not null default '{}',
  is_active   boolean not null default true,
  last_used_at timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Index for fast lookup by hash (used on every authenticated request).
create index idx_api_keys_hash on public.api_keys (key_hash);

-- Index for listing keys by owner.
create index idx_api_keys_owner on public.api_keys (owner_id);

-- RLS: only the key owner can manage their own keys.
alter table public.api_keys enable row level security;

create policy "api_keys_owner_select"
  on public.api_keys for select
  using (auth.uid() = owner_id);

create policy "api_keys_owner_insert"
  on public.api_keys for insert
  with check (auth.uid() = owner_id);

create policy "api_keys_owner_update"
  on public.api_keys for update
  using (auth.uid() = owner_id);

create policy "api_keys_owner_delete"
  on public.api_keys for delete
  using (auth.uid() = owner_id);
