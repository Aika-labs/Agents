-- 00009_memory.sql
-- Agent memory: long-term semantic memory with pgvector embeddings.

-- Enum for memory categories.
create type public.memory_type as enum (
    'episodic',    -- Specific events or interactions the agent experienced.
    'semantic',    -- General knowledge or facts the agent has learned.
    'procedural',  -- How-to knowledge, workflows, or learned procedures.
    'reflection'   -- Agent self-assessments, summaries, or meta-observations.
);

create table public.agent_memories (
    id            uuid primary key default gen_random_uuid(),
    agent_id      uuid not null references public.agents(id) on delete cascade,
    owner_id      uuid not null references auth.users(id) on delete cascade,

    -- Memory content.
    content       text not null,
    memory_type   public.memory_type not null default 'semantic',

    -- Semantic search embedding (1536 dimensions = OpenAI text-embedding-3-small).
    embedding     extensions.vector(1536),

    -- Provenance: which session/message produced this memory (nullable).
    session_id    uuid references public.agent_sessions(id) on delete set null,
    message_id    uuid references public.agent_messages(id) on delete set null,

    -- Importance score (0.0 - 1.0). Higher = more likely to be recalled.
    importance    real not null default 0.5
                  constraint importance_range check (importance >= 0.0 and importance <= 1.0),

    -- Access tracking for decay / reinforcement.
    access_count  integer not null default 0,
    last_accessed_at timestamptz,

    -- Arbitrary metadata (source, tags, extraction method, etc).
    metadata      jsonb not null default '{}'::jsonb,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Auto-update updated_at on row modification.
create trigger agent_memories_updated_at
    before update on public.agent_memories
    for each row
    execute function extensions.moddatetime(updated_at);

-- Index: list memories by agent, ordered by recency.
create index idx_agent_memories_agent_id
    on public.agent_memories (agent_id, created_at desc);

-- Index: filter by memory type.
create index idx_agent_memories_type
    on public.agent_memories (agent_id, memory_type);

-- Index: vector similarity search (IVFFlat for balanced speed/recall).
-- Lists = sqrt(expected_row_count). Start with 100 lists, re-tune as data grows.
create index idx_agent_memories_embedding
    on public.agent_memories
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);

-- RLS policies (consistent with 00008_rls.sql pattern).
alter table public.agent_memories enable row level security;

create policy "Users can manage their own agent memories"
    on public.agent_memories
    for all
    using (owner_id = auth.uid())
    with check (owner_id = auth.uid());

comment on table public.agent_memories is
    'Long-term semantic memory for agents, searchable via pgvector embeddings.';
comment on column public.agent_memories.embedding is
    'Vector embedding of the memory content for similarity search (1536-dim).';
comment on column public.agent_memories.importance is
    'Importance score (0.0-1.0) used to prioritize memories during context assembly.';
comment on column public.agent_memories.access_count is
    'Number of times this memory has been recalled, used for reinforcement/decay.';
