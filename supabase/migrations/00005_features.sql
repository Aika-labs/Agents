-- 00005_features.sql
-- Feature flags system for agent capabilities and platform features.

create type public.flag_scope as enum (
    'platform',   -- Global platform feature (e.g., "enable_marketplace").
    'agent',      -- Per-agent feature (e.g., "enable_web_browsing").
    'user'        -- Per-user feature (e.g., "beta_dashboard").
);

create table public.feature_flags (
    id              uuid primary key default gen_random_uuid(),
    owner_id        uuid not null references auth.users(id) on delete cascade,

    -- Flag identity.
    key             text not null,
    name            text not null,
    description     text,
    scope           public.flag_scope not null default 'agent',

    -- State.
    enabled         boolean not null default false,

    -- Gradual rollout: percentage of targets that see this flag enabled (0-100).
    rollout_pct     integer not null default 100
                    constraint rollout_pct_range check (rollout_pct between 0 and 100),

    -- Targeting rules: JSON array of conditions for fine-grained control.
    -- Example: [{"field": "agent.framework", "op": "eq", "value": "langgraph"}]
    targeting_rules jsonb not null default '[]'::jsonb,

    -- Optional: restrict flag to a specific agent.
    agent_id        uuid references public.agents(id) on delete cascade,

    -- Scheduling: auto-enable/disable at specific times.
    starts_at       timestamptz,
    expires_at      timestamptz,

    metadata        jsonb not null default '{}'::jsonb,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- Flag keys must be unique per owner (and optionally per agent).
    constraint unique_flag_key unique (owner_id, key, agent_id)
);

create trigger feature_flags_updated_at
    before update on public.feature_flags
    for each row
    execute function extensions.moddatetime(updated_at);

comment on table public.feature_flags is
    'Feature flags for toggling agent capabilities and platform features.';
comment on column public.feature_flags.rollout_pct is
    'Percentage of matching targets that see this flag enabled (0-100).';
comment on column public.feature_flags.targeting_rules is
    'JSON conditions for fine-grained targeting (field, operator, value).';
