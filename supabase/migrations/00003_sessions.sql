-- 00003_sessions.sql
-- Agent sessions and messages: conversation history and state tracking.

-- Enum for session lifecycle.
create type public.session_status as enum (
    'active',      -- Currently in use.
    'idle',        -- No recent activity, can be resumed.
    'completed',   -- Finished normally.
    'expired',     -- Timed out.
    'error'        -- Terminated due to an error.
);

-- Enum for message roles (follows OpenAI/A2A conventions).
create type public.message_role as enum (
    'system',
    'user',
    'assistant',
    'tool',
    'a2a'          -- Messages from other agents via A2A protocol.
);

create table public.agent_sessions (
    id            uuid primary key default gen_random_uuid(),
    agent_id      uuid not null references public.agents(id) on delete cascade,
    owner_id      uuid not null references auth.users(id) on delete cascade,

    -- Session state.
    status        public.session_status not null default 'active',
    title         text,  -- Optional user-facing session title.

    -- Context window tracking.
    total_tokens  bigint not null default 0,
    turn_count    integer not null default 0,

    -- Arbitrary session-level state the agent runtime can persist between turns.
    context       jsonb not null default '{}'::jsonb,

    -- A2A: if this session was initiated by another agent.
    parent_agent_id uuid references public.agents(id) on delete set null,
    a2a_task_id     text,  -- A2A protocol task identifier.

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    ended_at      timestamptz
);

create trigger agent_sessions_updated_at
    before update on public.agent_sessions
    for each row
    execute function extensions.moddatetime(updated_at);

comment on table public.agent_sessions is
    'Conversation sessions between users (or other agents) and an AI agent.';
comment on column public.agent_sessions.context is
    'Runtime state persisted across turns (memory, scratchpad, etc).';
comment on column public.agent_sessions.a2a_task_id is
    'Task ID from the A2A protocol when session is agent-initiated.';

-- ---------------------------------------------------------------------------

create table public.agent_messages (
    id            uuid primary key default gen_random_uuid(),
    session_id    uuid not null references public.agent_sessions(id) on delete cascade,
    agent_id      uuid not null references public.agents(id) on delete cascade,

    -- Message content.
    role          public.message_role not null,
    content       text,  -- May be null for pure tool-call messages.

    -- Token accounting.
    prompt_tokens   integer not null default 0,
    completion_tokens integer not null default 0,

    -- Tool calls made by the assistant in this turn.
    tool_calls    jsonb,
    -- Example: [{"id": "call_abc", "name": "web_search", "arguments": {...}, "result": {...}}]

    -- Tool response (when role = 'tool').
    tool_call_id  text,
    tool_name     text,

    -- Model that generated this message (for hot-swap auditing).
    model         text,

    -- Metadata (latency, cost, provider response headers, etc).
    metadata      jsonb not null default '{}'::jsonb,

    created_at    timestamptz not null default now()
);

comment on table public.agent_messages is
    'Individual messages within an agent session (conversation history).';
comment on column public.agent_messages.tool_calls is
    'Tool/function calls made by the assistant, with arguments and results.';
comment on column public.agent_messages.model is
    'The specific model used for this message (tracks hot-swap history).';
