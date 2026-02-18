-- 00004_wallets.sql
-- Crypto wallet tracking for AI agents (Coinbase AgentKit / x402 ready).

-- Enum for wallet providers.
create type public.wallet_provider as enum (
    'coinbase_agentkit',  -- Coinbase AgentKit (primary).
    'metamask',
    'walletconnect',
    'custom'
);

-- Enum for blockchain networks.
create type public.wallet_network as enum (
    'ethereum_mainnet',
    'ethereum_sepolia',
    'base_mainnet',
    'base_sepolia',
    'polygon_mainnet',
    'polygon_amoy',
    'arbitrum_mainnet',
    'solana_mainnet',
    'solana_devnet'
);

create table public.agent_wallets (
    id              uuid primary key default gen_random_uuid(),
    agent_id        uuid not null references public.agents(id) on delete cascade,
    owner_id        uuid not null references auth.users(id) on delete cascade,

    -- Wallet identity.
    provider        public.wallet_provider not null default 'coinbase_agentkit',
    network         public.wallet_network not null,
    wallet_address  text not null,
    label           text,  -- User-friendly name ("Agent Trading Wallet").

    -- Balance tracking (cached; source of truth is on-chain).
    balance         numeric(38, 18) not null default 0,  -- 18 decimals for wei precision.
    balance_usd     numeric(18, 2) not null default 0,
    last_synced_at  timestamptz,

    -- x402 protocol support: whether this wallet can pay for HTTP resources.
    x402_enabled    boolean not null default false,

    -- Spending controls (kill-switch capability).
    spending_limit_usd  numeric(18, 2),  -- Max spend per day; null = unlimited.
    is_active           boolean not null default true,

    -- Provider-specific config (API keys stored in Secret Manager, not here).
    provider_config jsonb not null default '{}'::jsonb,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- A wallet address must be unique per network per agent.
    constraint unique_wallet_per_agent unique (agent_id, network, wallet_address)
);

create trigger agent_wallets_updated_at
    before update on public.agent_wallets
    for each row
    execute function extensions.moddatetime(updated_at);

comment on table public.agent_wallets is
    'Crypto wallets attached to agents for autonomous transactions.';
comment on column public.agent_wallets.balance is
    'Cached on-chain balance in native token (18 decimal precision).';
comment on column public.agent_wallets.spending_limit_usd is
    'Daily spending cap in USD. Null means unlimited. Part of kill-switch system.';
comment on column public.agent_wallets.x402_enabled is
    'Whether this wallet supports the x402 HTTP payment protocol.';

-- ---------------------------------------------------------------------------
-- Wallet transactions: ledger of on-chain activity.
-- ---------------------------------------------------------------------------

create type public.tx_status as enum (
    'pending',
    'confirmed',
    'failed',
    'reverted'
);

create table public.wallet_transactions (
    id              uuid primary key default gen_random_uuid(),
    wallet_id       uuid not null references public.agent_wallets(id) on delete cascade,
    agent_id        uuid not null references public.agents(id) on delete cascade,

    -- Transaction details.
    tx_hash         text,
    from_address    text not null,
    to_address      text not null,
    amount          numeric(38, 18) not null,
    amount_usd      numeric(18, 2),
    token_symbol    text not null default 'ETH',

    status          public.tx_status not null default 'pending',
    block_number    bigint,

    -- Why this transaction happened (agent reasoning).
    purpose         text,
    session_id      uuid references public.agent_sessions(id) on delete set null,

    metadata        jsonb not null default '{}'::jsonb,

    created_at      timestamptz not null default now(),
    confirmed_at    timestamptz
);

comment on table public.wallet_transactions is
    'Ledger of on-chain transactions initiated by agent wallets.';
comment on column public.wallet_transactions.purpose is
    'Human-readable reason the agent initiated this transaction.';
