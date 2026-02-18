-- 00001_extensions.sql
-- Enable required PostgreSQL extensions.

-- pgvector: vector similarity search for agent embeddings.
create extension if not exists vector with schema extensions;

-- pg_trgm: trigram-based fuzzy text search for agent names/descriptions.
create extension if not exists pg_trgm with schema extensions;

-- moddatetime: auto-update updated_at timestamps on row modification.
create extension if not exists moddatetime with schema extensions;
