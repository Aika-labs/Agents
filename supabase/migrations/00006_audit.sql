-- 00006_audit.sql
-- Audit logs: SOC2/GDPR/HIPAA-grade trail with evidence quality.
-- Every significant action on the platform is recorded here.

create type public.audit_severity as enum (
    'info',       -- Routine operations (agent started, config changed).
    'warning',    -- Potentially risky actions (spending limit raised).
    'critical'    -- Security-sensitive (kill switch triggered, wallet drained).
);

create table public.audit_logs (
    id              uuid primary key default gen_random_uuid(),

    -- Who performed the action.
    actor_id        uuid references auth.users(id) on delete set null,
    actor_type      text not null default 'user',
    -- actor_type: 'user', 'agent', 'system', 'a2a_agent'

    -- What happened.
    action          text not null,
    -- Namespaced actions: 'agent.created', 'agent.killed', 'wallet.tx.sent',
    -- 'session.started', 'flag.toggled', 'marketplace.listed', etc.

    severity        public.audit_severity not null default 'info',

    -- What was affected.
    resource_type   text not null,
    -- 'agent', 'session', 'wallet', 'feature_flag', 'marketplace_listing'
    resource_id     uuid,

    -- Evidence: structured proof of what changed (before/after snapshots).
    -- SOC2 auditors need this to verify compliance.
    evidence        jsonb not null default '{}'::jsonb,
    -- Example:
    -- {
    --   "before": {"status": "running", "model": "gpt-4o"},
    --   "after":  {"status": "paused",  "model": "gpt-4o"},
    --   "reason": "User triggered kill switch"
    -- }

    -- Request context for forensics.
    ip_address      inet,
    user_agent      text,
    request_id      text,  -- Correlation ID for distributed tracing.

    -- Optional links to related entities.
    agent_id        uuid references public.agents(id) on delete set null,
    session_id      uuid references public.agent_sessions(id) on delete set null,

    metadata        jsonb not null default '{}'::jsonb,

    created_at      timestamptz not null default now()
);

-- Audit logs are append-only. No update trigger needed.

comment on table public.audit_logs is
    'Immutable audit trail for all platform actions (SOC2/GDPR/HIPAA compliance).';
comment on column public.audit_logs.evidence is
    'Structured before/after snapshots and reasoning for the action.';
comment on column public.audit_logs.request_id is
    'Distributed tracing correlation ID for cross-service forensics.';
