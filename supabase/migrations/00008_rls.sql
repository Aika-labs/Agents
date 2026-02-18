-- 00008_rls.sql
-- Row-Level Security policies and performance indexes.

-- =========================================================================
-- Enable RLS on all tables.
-- =========================================================================

alter table public.agents enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.feature_flags enable row level security;
alter table public.audit_logs enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_reviews enable row level security;

-- =========================================================================
-- RLS Policies: agents
-- =========================================================================

create policy "Users can view their own agents"
    on public.agents for select
    using (auth.uid() = owner_id);

create policy "Users can create agents"
    on public.agents for insert
    with check (auth.uid() = owner_id);

create policy "Users can update their own agents"
    on public.agents for update
    using (auth.uid() = owner_id);

create policy "Users can delete their own agents"
    on public.agents for delete
    using (auth.uid() = owner_id);

-- =========================================================================
-- RLS Policies: agent_sessions
-- =========================================================================

create policy "Users can view their own sessions"
    on public.agent_sessions for select
    using (auth.uid() = owner_id);

create policy "Users can create sessions for their agents"
    on public.agent_sessions for insert
    with check (auth.uid() = owner_id);

create policy "Users can update their own sessions"
    on public.agent_sessions for update
    using (auth.uid() = owner_id);

create policy "Users can delete their own sessions"
    on public.agent_sessions for delete
    using (auth.uid() = owner_id);

-- =========================================================================
-- RLS Policies: agent_messages
-- Messages are scoped through the session's owner.
-- =========================================================================

create policy "Users can view messages in their sessions"
    on public.agent_messages for select
    using (
        exists (
            select 1 from public.agent_sessions s
            where s.id = agent_messages.session_id
              and s.owner_id = auth.uid()
        )
    );

create policy "Users can insert messages in their sessions"
    on public.agent_messages for insert
    with check (
        exists (
            select 1 from public.agent_sessions s
            where s.id = agent_messages.session_id
              and s.owner_id = auth.uid()
        )
    );

-- Messages are append-only; no update or delete policies.

-- =========================================================================
-- RLS Policies: agent_wallets
-- =========================================================================

create policy "Users can view their own wallets"
    on public.agent_wallets for select
    using (auth.uid() = owner_id);

create policy "Users can create wallets for their agents"
    on public.agent_wallets for insert
    with check (auth.uid() = owner_id);

create policy "Users can update their own wallets"
    on public.agent_wallets for update
    using (auth.uid() = owner_id);

create policy "Users can delete their own wallets"
    on public.agent_wallets for delete
    using (auth.uid() = owner_id);

-- =========================================================================
-- RLS Policies: wallet_transactions
-- Scoped through the wallet's owner.
-- =========================================================================

create policy "Users can view transactions for their wallets"
    on public.wallet_transactions for select
    using (
        exists (
            select 1 from public.agent_wallets w
            where w.id = wallet_transactions.wallet_id
              and w.owner_id = auth.uid()
        )
    );

create policy "Users can insert transactions for their wallets"
    on public.wallet_transactions for insert
    with check (
        exists (
            select 1 from public.agent_wallets w
            where w.id = wallet_transactions.wallet_id
              and w.owner_id = auth.uid()
        )
    );

-- Transactions are append-only; no update or delete policies.

-- =========================================================================
-- RLS Policies: feature_flags
-- =========================================================================

create policy "Users can view their own flags"
    on public.feature_flags for select
    using (auth.uid() = owner_id);

create policy "Users can create flags"
    on public.feature_flags for insert
    with check (auth.uid() = owner_id);

create policy "Users can update their own flags"
    on public.feature_flags for update
    using (auth.uid() = owner_id);

create policy "Users can delete their own flags"
    on public.feature_flags for delete
    using (auth.uid() = owner_id);

-- =========================================================================
-- RLS Policies: audit_logs
-- Read-only for the actor who generated them.
-- =========================================================================

create policy "Users can view their own audit logs"
    on public.audit_logs for select
    using (auth.uid() = actor_id);

-- Audit logs are inserted by the backend (service role), not by users directly.
-- No insert/update/delete policies for end users.

-- =========================================================================
-- RLS Policies: marketplace_listings
-- Public read for published listings; owner-only write.
-- =========================================================================

create policy "Anyone can view published listings"
    on public.marketplace_listings for select
    using (status = 'published' or auth.uid() = owner_id);

create policy "Users can create listings for their agents"
    on public.marketplace_listings for insert
    with check (auth.uid() = owner_id);

create policy "Users can update their own listings"
    on public.marketplace_listings for update
    using (auth.uid() = owner_id);

create policy "Users can delete their own listings"
    on public.marketplace_listings for delete
    using (auth.uid() = owner_id);

-- =========================================================================
-- RLS Policies: marketplace_reviews
-- Public read; authenticated users can write their own.
-- =========================================================================

create policy "Anyone can view reviews"
    on public.marketplace_reviews for select
    using (true);

create policy "Authenticated users can create reviews"
    on public.marketplace_reviews for insert
    with check (auth.uid() = reviewer_id);

create policy "Users can update their own reviews"
    on public.marketplace_reviews for update
    using (auth.uid() = reviewer_id);

create policy "Users can delete their own reviews"
    on public.marketplace_reviews for delete
    using (auth.uid() = reviewer_id);

-- =========================================================================
-- Performance indexes.
-- =========================================================================

-- agents
create index idx_agents_owner on public.agents(owner_id);
create index idx_agents_status on public.agents(status) where deleted_at is null;
create index idx_agents_framework on public.agents(framework);
create index idx_agents_name_trgm on public.agents using gin (name extensions.gin_trgm_ops);
create index idx_agents_tags on public.agents using gin (tags);
create index idx_agents_embedding on public.agents using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

-- agent_sessions
create index idx_sessions_agent on public.agent_sessions(agent_id);
create index idx_sessions_owner on public.agent_sessions(owner_id);
create index idx_sessions_status on public.agent_sessions(status);
create index idx_sessions_created on public.agent_sessions(created_at desc);

-- agent_messages
create index idx_messages_session on public.agent_messages(session_id);
create index idx_messages_agent on public.agent_messages(agent_id);
create index idx_messages_created on public.agent_messages(created_at);

-- agent_wallets
create index idx_wallets_agent on public.agent_wallets(agent_id);
create index idx_wallets_owner on public.agent_wallets(owner_id);
create index idx_wallets_address on public.agent_wallets(wallet_address);

-- wallet_transactions
create index idx_tx_wallet on public.wallet_transactions(wallet_id);
create index idx_tx_agent on public.wallet_transactions(agent_id);
create index idx_tx_status on public.wallet_transactions(status);
create index idx_tx_created on public.wallet_transactions(created_at desc);

-- feature_flags
create index idx_flags_owner on public.feature_flags(owner_id);
create index idx_flags_agent on public.feature_flags(agent_id);
create index idx_flags_key on public.feature_flags(key);

-- audit_logs
create index idx_audit_actor on public.audit_logs(actor_id);
create index idx_audit_action on public.audit_logs(action);
create index idx_audit_resource on public.audit_logs(resource_type, resource_id);
create index idx_audit_agent on public.audit_logs(agent_id);
create index idx_audit_created on public.audit_logs(created_at desc);
create index idx_audit_severity on public.audit_logs(severity) where severity != 'info';

-- marketplace_listings
create index idx_listings_agent on public.marketplace_listings(agent_id);
create index idx_listings_owner on public.marketplace_listings(owner_id);
create index idx_listings_status on public.marketplace_listings(status);
create index idx_listings_category on public.marketplace_listings(category);
create index idx_listings_tags on public.marketplace_listings using gin (tags);
create index idx_listings_featured on public.marketplace_listings(featured) where status = 'published';
create index idx_listings_embedding on public.marketplace_listings using ivfflat (embedding extensions.vector_cosine_ops) with (lists = 100);

-- marketplace_reviews
create index idx_reviews_listing on public.marketplace_reviews(listing_id);
create index idx_reviews_reviewer on public.marketplace_reviews(reviewer_id);
