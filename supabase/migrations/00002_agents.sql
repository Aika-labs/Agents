-- 00002_agents.sql
-- Core agents table: the central entity of the platform.

-- Enum for agent lifecycle status.
create type public.agent_status as enum (
    'draft',       -- Created but not yet deployed.
    'running',     -- Actively processing requests.
    'paused',      -- Temporarily suspended by user.
    'stopped',     -- Gracefully shut down.
    'error',       -- Crashed or in an error state.
    'archived'     -- Soft-deleted / retired.
);

-- Enum for supported agent frameworks.
create type public.agent_framework as enum (
    'google_adk',
    'langgraph',
    'crewai',
    'autogen',
    'openai_sdk',
    'custom'
);

create table public.agents (
    id            uuid primary key default gen_random_uuid(),
    owner_id      uuid not null references auth.users(id) on delete cascade,

    -- Identity.
    name          text not null,
    description   text,
    avatar_url    text,

    -- Runtime configuration.
    framework     public.agent_framework not null default 'google_adk',
    model_config  jsonb not null default '{}'::jsonb,
    -- model_config example:
    -- {
    --   "provider": "openai",
    --   "model": "gpt-4o",
    --   "temperature": 0.7,
    --   "max_tokens": 4096
    -- }

    system_prompt text,
    tools         jsonb not null default '[]'::jsonb,
    -- tools example: [{"name": "web_search", "enabled": true}]

    mcp_servers   jsonb not null default '[]'::jsonb,
    -- MCP server connections: [{"url": "https://...", "transport": "sse"}]

    a2a_config    jsonb not null default '{}'::jsonb,
    -- A2A protocol config: {"agent_card_url": "...", "capabilities": [...]}

    -- Lifecycle.
    status        public.agent_status not null default 'draft',
    version       integer not null default 1,

    -- Semantic search embedding (1536 dimensions = OpenAI ada-002 / text-embedding-3-small).
    embedding     extensions.vector(1536),

    -- Metadata.
    tags          text[] not null default '{}',
    metadata      jsonb not null default '{}'::jsonb,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    deleted_at    timestamptz
);

-- Auto-update updated_at on row modification.
create trigger agents_updated_at
    before update on public.agents
    for each row
    execute function extensions.moddatetime(updated_at);

comment on table public.agents is
    'AI agents created and managed on the platform.';
comment on column public.agents.model_config is
    'LLM provider/model configuration as JSON (provider, model, temperature, etc).';
comment on column public.agents.tools is
    'List of tools/functions available to the agent.';
comment on column public.agents.mcp_servers is
    'MCP (Model Context Protocol) server connections for tool access.';
comment on column public.agents.a2a_config is
    'Agent2Agent protocol configuration for inter-agent communication.';
comment on column public.agents.embedding is
    'Vector embedding for semantic search and marketplace discovery.';
