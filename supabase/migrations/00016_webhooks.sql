-- Sprint 16: Webhooks & Notifications
-- Configurable webhook subscriptions for agent events with delivery tracking.

-- ---------------------------------------------------------------------------
-- Enum: webhook_event
-- ---------------------------------------------------------------------------

CREATE TYPE webhook_event AS ENUM (
  'agent.created',
  'agent.updated',
  'agent.deleted',
  'session.started',
  'session.ended',
  'deployment.started',
  'deployment.completed',
  'deployment.failed',
  'eval.completed',
  'pipeline.completed',
  'pipeline.failed',
  'approval.requested',
  'approval.resolved',
  'error.occurred'
);

-- ---------------------------------------------------------------------------
-- Enum: delivery_status
-- ---------------------------------------------------------------------------

CREATE TYPE delivery_status AS ENUM (
  'pending',
  'success',
  'failed',
  'retrying'
);

-- ---------------------------------------------------------------------------
-- Table: agent_webhooks
-- ---------------------------------------------------------------------------
-- Per-agent webhook subscriptions. Each webhook listens for specific events
-- and delivers signed payloads to the configured URL.

CREATE TABLE agent_webhooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  url             TEXT NOT NULL,
  -- HMAC-SHA256 signing secret (stored encrypted in production).
  secret          TEXT NOT NULL,
  -- Events this webhook subscribes to.
  events          webhook_event[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- Retry configuration.
  max_retries     INTEGER NOT NULL DEFAULT 3,
  retry_delay_seconds INTEGER NOT NULL DEFAULT 30,
  -- Timeout for delivery requests (ms).
  timeout_ms      INTEGER NOT NULL DEFAULT 10000,
  -- Delivery stats.
  total_deliveries   INTEGER NOT NULL DEFAULT 0,
  failed_deliveries  INTEGER NOT NULL DEFAULT 0,
  last_delivered_at  TIMESTAMPTZ,
  last_error         TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Table: webhook_deliveries
-- ---------------------------------------------------------------------------
-- Delivery log for webhook events. Tracks each attempt with status,
-- response details, and retry information.

CREATE TABLE webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID NOT NULL REFERENCES agent_webhooks(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  event           webhook_event NOT NULL,
  status          delivery_status NOT NULL DEFAULT 'pending',
  -- Request details.
  payload         JSONB NOT NULL DEFAULT '{}',
  -- Response details.
  response_status INTEGER,
  response_body   TEXT,
  response_time_ms NUMERIC(10, 2),
  -- Retry tracking.
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  max_attempts    INTEGER NOT NULL DEFAULT 4,
  next_retry_at   TIMESTAMPTZ,
  -- Error info.
  error_message   TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_agent_webhooks_agent ON agent_webhooks (agent_id)
  WHERE is_active = true;
CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id);
CREATE INDEX idx_webhook_deliveries_agent ON webhook_deliveries (agent_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries (status)
  WHERE status IN ('pending', 'retrying');

-- ---------------------------------------------------------------------------
-- Triggers: auto-update updated_at
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_agent_webhooks_updated_at
  BEFORE UPDATE ON agent_webhooks
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE agent_webhooks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries  ENABLE ROW LEVEL SECURITY;

-- Webhooks: owner + shared users can read; owner manages.
CREATE POLICY agent_webhooks_select ON agent_webhooks
  FOR SELECT USING (
    owner_id = auth.uid()
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY agent_webhooks_insert ON agent_webhooks
  FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY agent_webhooks_update ON agent_webhooks
  FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY agent_webhooks_delete ON agent_webhooks
  FOR DELETE USING (owner_id = auth.uid());

-- Deliveries: readable by webhook owner + shared users.
CREATE POLICY webhook_deliveries_select ON webhook_deliveries
  FOR SELECT USING (
    webhook_id IN (SELECT id FROM agent_webhooks WHERE owner_id = auth.uid())
    OR agent_id IN (SELECT agent_id FROM agent_permissions WHERE user_id = auth.uid())
  );
CREATE POLICY webhook_deliveries_insert ON webhook_deliveries
  FOR INSERT WITH CHECK (
    webhook_id IN (SELECT id FROM agent_webhooks WHERE owner_id = auth.uid())
  );
