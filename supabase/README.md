# Supabase Database Schema

Database migrations for the Agent Operating System platform.

## Structure

```
supabase/
├── config.toml              # Supabase CLI configuration
├── migrations/
│   ├── 00001_extensions.sql # Enable required PG extensions
│   ├── 00002_agents.sql     # Core agents table with pgvector
│   ├── 00003_sessions.sql   # Agent sessions & messages
│   ├── 00004_wallets.sql    # Crypto wallet tracking
│   ├── 00005_features.sql   # Feature flags system
│   ├── 00006_audit.sql      # Audit logs (SOC2/GDPR)
│   ├── 00007_marketplace.sql# Agent marketplace listings
│   └── 00008_rls.sql        # Row-Level Security policies
└── seed.sql                 # Development seed data
```

## Running Migrations

### With Supabase CLI (local development)

```bash
supabase start          # Start local Supabase
supabase db reset       # Apply all migrations + seed
```

### With Supabase CLI (remote)

```bash
supabase link --project-ref <your-project-ref>
supabase db push        # Apply pending migrations
```

### Direct SQL (any PostgreSQL client)

Migrations are plain SQL files and can be applied in order with `psql`:

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -f "$f"
done
```

## Design Decisions

- **UUIDs** as primary keys (distributed-friendly, Supabase default).
- **pgvector** for agent embeddings (semantic search in marketplace).
- **JSONB** for flexible fields (model_config, tools, mcp_servers, targeting_rules).
- **RLS** on every table scoped to `auth.uid()` for multi-tenant isolation.
- **Timestamps with timezone** for global correctness.
- **Soft deletes** via `deleted_at` where appropriate.
