-- 00007_marketplace.sql
-- Agent marketplace: listings, reviews, and usage tracking.

create type public.listing_status as enum (
    'draft',       -- Not yet published.
    'pending',     -- Awaiting review/approval.
    'published',   -- Live on the marketplace.
    'suspended',   -- Temporarily removed (policy violation, etc).
    'archived'     -- Permanently removed by owner.
);

create type public.pricing_model as enum (
    'free',
    'one_time',       -- Single purchase.
    'per_use',        -- Pay per invocation.
    'subscription',   -- Recurring monthly/annual.
    'revenue_share'   -- Percentage of agent earnings.
);

create table public.marketplace_listings (
    id              uuid primary key default gen_random_uuid(),
    agent_id        uuid not null references public.agents(id) on delete cascade,
    owner_id        uuid not null references auth.users(id) on delete cascade,

    -- Listing details.
    title           text not null,
    short_desc      text not null,
    long_desc       text,
    category        text not null default 'general',
    tags            text[] not null default '{}',

    -- Pricing.
    pricing_model   public.pricing_model not null default 'free',
    price_usd       numeric(18, 2),  -- Null for free listings.
    revenue_share_pct integer
                    constraint revenue_share_range check (revenue_share_pct is null or revenue_share_pct between 0 and 100),

    -- A2A discovery: the agent's A2A Agent Card URL for interoperability.
    a2a_agent_card_url text,

    -- Stats (denormalized for fast reads; updated by background jobs).
    install_count   bigint not null default 0,
    rating_avg      numeric(3, 2) not null default 0,
    rating_count    integer not null default 0,

    -- Listing state.
    status          public.listing_status not null default 'draft',
    published_at    timestamptz,
    featured        boolean not null default false,

    -- Semantic search embedding (same dimensions as agents table).
    embedding       extensions.vector(1536),

    metadata        jsonb not null default '{}'::jsonb,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create trigger marketplace_listings_updated_at
    before update on public.marketplace_listings
    for each row
    execute function extensions.moddatetime(updated_at);

comment on table public.marketplace_listings is
    'Agent marketplace listings for discovery, purchase, and A2A interop.';
comment on column public.marketplace_listings.a2a_agent_card_url is
    'A2A protocol Agent Card URL for agent-to-agent discovery.';

-- ---------------------------------------------------------------------------
-- Marketplace reviews.
-- ---------------------------------------------------------------------------

create table public.marketplace_reviews (
    id              uuid primary key default gen_random_uuid(),
    listing_id      uuid not null references public.marketplace_listings(id) on delete cascade,
    reviewer_id     uuid not null references auth.users(id) on delete cascade,

    rating          integer not null constraint rating_range check (rating between 1 and 5),
    title           text,
    body            text,

    -- Verified purchase: reviewer actually used/installed the agent.
    verified        boolean not null default false,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- One review per user per listing.
    constraint unique_review unique (listing_id, reviewer_id)
);

create trigger marketplace_reviews_updated_at
    before update on public.marketplace_reviews
    for each row
    execute function extensions.moddatetime(updated_at);

comment on table public.marketplace_reviews is
    'User reviews and ratings for marketplace agent listings.';
