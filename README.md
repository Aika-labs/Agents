# Agent Operating System

A full-stack platform for building, deploying, and managing AI agents at scale. Provides a unified control plane, multi-framework runtime, inter-agent communication protocols, and production-grade infrastructure on Google Cloud.

## Architecture

The platform is organized into **9 architectural layers**, each addressing a distinct concern of the agent lifecycle:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Marketplace Layer                          │
│              Listings · Reviews · Discovery                     │
├─────────────────────────────────────────────────────────────────┤
│                      Security Layer                             │
│       RBAC · API Keys · JWT Auth · RLS · HITL Approvals         │
├─────────────────────────────────────────────────────────────────┤
│                    Observability Layer                           │
│     Structured Logging · Prometheus Metrics · Alert Policies    │
├─────────────────────────────────────────────────────────────────┤
│                       Data Layer                                │
│   Supabase (PostgreSQL + pgvector) · Redis · GCS Artifacts      │
├─────────────────────────────────────────────────────────────────┤
│                     Financial Layer                              │
│              Wallets · Transactions · Usage Tracking             │
├─────────────────────────────────────────────────────────────────┤
│                      Control Layer                              │
│    Feature Flags · Kill Switch · Audit Logs · Rate Limiting     │
├─────────────────────────────────────────────────────────────────┤
│                   Communication Layer                           │
│           A2A Protocol · MCP Protocol · Webhooks                │
├─────────────────────────────────────────────────────────────────┤
│                      Runtime Layer                              │
│   GKE Autopilot · Framework Adapters · K8s Lifecycle · Redis    │
├─────────────────────────────────────────────────────────────────┤
│                     Creation Layer                              │
│       Templates · Versioned Snapshots · Deployment FSM          │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **API** | [Hono](https://hono.dev/) (TypeScript, Node.js) |
| **Database** | [Supabase](https://supabase.com/) (PostgreSQL + pgvector) |
| **Cache / Pub-Sub** | Redis 7.2 (Cloud Memorystore) |
| **Container Runtime** | GKE Autopilot |
| **API Gateway** | Cloud Run v2 |
| **Object Storage** | Google Cloud Storage |
| **Secrets** | GCP Secret Manager |
| **Infrastructure** | [Pulumi](https://pulumi.com/) (TypeScript, GCP) |
| **CI/CD** | GitHub Actions |
| **Validation** | Zod (runtime), TypeScript (compile-time) |

## Repository Structure

```
.
├── infra/                          # Pulumi IaC (GCP)
│   ├── index.ts                    # VPC, Cloud Run, GKE, Redis, GCS, IAM, Monitoring
│   ├── Pulumi.yaml
│   └── Pulumi.dev.yaml
├── services/
│   ├── control-plane/              # Core API (port 8080)
│   │   └── src/
│   │       ├── app.ts              # Hono app with middleware chain
│   │       ├── index.ts            # Server entry + graceful shutdown
│   │       ├── middleware/          # 7 middleware modules
│   │       ├── routes/             # 14 route modules
│   │       ├── lib/                # 16 library modules
│   │       └── types/              # Database types + env bindings
│   ├── agent-runtime/              # Agent execution engine
│   │   └── src/
│   │       ├── frameworks/         # Google ADK, LangGraph adapters
│   │       ├── k8s/                # Pod lifecycle + manifest generation
│   │       └── redis/              # Event bus + state sync
│   └── protocols/                  # Inter-agent communication (port 8082)
│       └── src/
│           ├── a2a/                # Agent-to-Agent protocol
│           └── mcp/                # Model Context Protocol
├── supabase/
│   ├── migrations/                 # 16 sequential migrations
│   ├── seed.sql                    # Development seed data
│   └── config.toml                 # Supabase project config
└── .github/workflows/              # CI + deploy pipelines
```

## Services

### Control Plane (`services/control-plane`)

The central API that manages all platform resources. Runs on Cloud Run v2 (port 8080).

**Middleware chain** (applied in order):
1. `requestIdMiddleware` -- Generates/propagates `X-Request-Id`
2. `traceMiddleware` -- OpenTelemetry-compatible trace context
3. `cors` -- Configurable CORS with rate-limit header exposure
4. `securityHeaders` -- HSTS, CSP, X-Frame-Options, etc.
5. `ipRateLimiter` -- 100 req/min per IP (sliding window)
6. `apiKeyMiddleware` -- X-API-Key authentication (protected routes)
7. `authMiddleware` -- JWT Bearer authentication (protected routes)
8. `userRateLimiter` -- 200 req/min per user (protected routes)

### Agent Runtime (`services/agent-runtime`)

Executes agent workloads on GKE Autopilot. Supports multiple AI frameworks through a pluggable adapter system.

**Supported frameworks:**
- Google ADK (Agent Development Kit)
- LangGraph
- Custom (bring your own runtime)

### Protocols Service (`services/protocols`)

Handles inter-agent and tool communication via standardized protocols.

- **A2A** (Agent-to-Agent): Agent card discovery, task delegation, streaming results
- **MCP** (Model Context Protocol): Tool registration, context sharing, capability negotiation

## API Reference

All endpoints below require authentication (API key or JWT) unless marked as public.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/live` | Kubernetes liveness probe |
| GET | `/health/ready` | Readiness probe (checks Supabase + Redis) |
| GET | `/health/metrics` | Prometheus metrics endpoint |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents` | Create an agent |
| GET | `/agents` | List agents (owner-scoped) |
| GET | `/agents/:agentId` | Get agent detail |
| PATCH | `/agents/:agentId` | Update an agent |
| DELETE | `/agents/:agentId` | Delete an agent |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sessions` | Create a session |
| GET | `/sessions` | List sessions |
| GET | `/sessions/:sessionId` | Get session detail |
| PATCH | `/sessions/:sessionId` | Update session |
| DELETE | `/sessions/:sessionId` | End a session |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/:agentId/memories` | Store a memory |
| GET | `/agents/:agentId/memories` | List memories |
| POST | `/agents/:agentId/memories/search` | Semantic search (pgvector) |
| DELETE | `/agents/:agentId/memories/:memoryId` | Delete a memory |

### Permissions (RBAC)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/:agentId/permissions` | Grant access |
| GET | `/agents/:agentId/permissions` | List permissions |
| PATCH | `/agents/:agentId/permissions/:permissionId` | Update role |
| DELETE | `/agents/:agentId/permissions/:permissionId` | Revoke access |

**Role hierarchy:** `owner` > `admin` > `editor` > `viewer`

### Human-in-the-Loop (HITL)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/:agentId/hitl-policies` | Create approval policy |
| GET | `/agents/:agentId/hitl-policies` | List policies |
| PATCH | `/agents/:agentId/hitl-policies/:policyId` | Update policy |
| DELETE | `/agents/:agentId/hitl-policies/:policyId` | Delete policy |
| POST | `/agents/:agentId/approvals` | Create approval request |
| GET | `/agents/:agentId/approvals` | List approval requests |
| PATCH | `/agents/:agentId/approvals/:requestId` | Resolve (approve/reject) |

### Evaluations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/:agentId/evals/suites` | Create test suite |
| GET | `/agents/:agentId/evals/suites` | List suites |
| GET | `/agents/:agentId/evals/suites/:suiteId` | Get suite detail |
| PATCH | `/agents/:agentId/evals/suites/:suiteId` | Update suite |
| DELETE | `/agents/:agentId/evals/suites/:suiteId` | Delete suite |
| POST | `/agents/:agentId/evals/suites/:suiteId/cases` | Add test case |
| GET | `/agents/:agentId/evals/suites/:suiteId/cases` | List cases |
| PATCH | `/agents/:agentId/evals/suites/:suiteId/cases/:caseId` | Update case |
| DELETE | `/agents/:agentId/evals/suites/:suiteId/cases/:caseId` | Delete case |
| POST | `/agents/:agentId/evals/runs` | Start eval run |
| GET | `/agents/:agentId/evals/runs` | List runs |
| GET | `/agents/:agentId/evals/runs/:runId` | Get run detail + results |

### Data Pipelines

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/:agentId/data/connectors` | Create data connector |
| GET | `/agents/:agentId/data/connectors` | List connectors |
| PATCH | `/agents/:agentId/data/connectors/:connectorId` | Update connector |
| DELETE | `/agents/:agentId/data/connectors/:connectorId` | Delete connector |
| POST | `/agents/:agentId/data/pipelines` | Create pipeline |
| GET | `/agents/:agentId/data/pipelines` | List pipelines |
| PATCH | `/agents/:agentId/data/pipelines/:pipelineId` | Update pipeline |
| DELETE | `/agents/:agentId/data/pipelines/:pipelineId` | Delete pipeline |
| POST | `/agents/:agentId/data/pipelines/:pipelineId/steps` | Add step |
| GET | `/agents/:agentId/data/pipelines/:pipelineId/steps` | List steps |
| PATCH | `/agents/:agentId/data/pipelines/:pipelineId/steps/:stepId` | Update step |
| DELETE | `/agents/:agentId/data/pipelines/:pipelineId/steps/:stepId` | Delete step |
| POST | `/agents/:agentId/data/runs` | Trigger pipeline run |
| GET | `/agents/:agentId/data/runs` | List runs |
| GET | `/agents/:agentId/data/runs/:runId` | Get run detail |

### Templates & Deployments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/templates` | Create template |
| GET | `/templates` | List templates |
| GET | `/templates/:templateId` | Get template detail |
| PATCH | `/templates/:templateId` | Update template |
| DELETE | `/templates/:templateId` | Delete template |
| POST | `/templates/:templateId/versions` | Publish version |
| GET | `/templates/:templateId/versions` | List versions |
| GET | `/templates/:templateId/versions/:versionId` | Get version detail |
| POST | `/agents/:agentId/deployments` | Create deployment |
| GET | `/agents/:agentId/deployments` | List deployments |
| GET | `/agents/:agentId/deployments/:deploymentId` | Get deployment detail |
| PATCH | `/agents/:agentId/deployments/:deploymentId` | Update deployment state |

**Deployment states:** `pending` → `building` → `deploying` → `running` → `stopped` | `failed` | `rolled_back`

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics/dashboard` | Owner dashboard (all agents) |
| GET | `/analytics/usage` | Daily usage rollups |
| GET | `/agents/:agentId/analytics/metrics` | Agent metrics (time-bucketed) |
| GET | `/agents/:agentId/analytics/dashboard` | Agent dashboard |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/:agentId/webhooks` | Create webhook subscription |
| GET | `/agents/:agentId/webhooks` | List webhooks |
| GET | `/agents/:agentId/webhooks/:webhookId` | Get webhook detail |
| PATCH | `/agents/:agentId/webhooks/:webhookId` | Update webhook |
| DELETE | `/agents/:agentId/webhooks/:webhookId` | Delete webhook |
| POST | `/agents/:agentId/webhooks/:webhookId/test` | Send test delivery |
| GET | `/agents/:agentId/webhooks/:webhookId/deliveries` | List deliveries |
| GET | `/agents/:agentId/webhooks/:webhookId/deliveries/:deliveryId` | Get delivery detail |

**Supported events:** `agent.created`, `agent.updated`, `agent.deleted`, `session.started`, `session.ended`, `deployment.started`, `deployment.completed`, `deployment.failed`, `eval.completed`, `pipeline.completed`, `pipeline.failed`, `approval.requested`, `approval.resolved`, `error.occurred`

Payloads are signed with HMAC-SHA256 (`X-Webhook-Signature` header).

### Batch Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/batch/create` | Bulk create agents (up to 100) |
| POST | `/agents/batch/update-status` | Bulk update agent status |
| POST | `/agents/batch/delete` | Bulk soft-delete agents |
| POST | `/agents/:agentId/sessions/batch/close-stale` | Close stale sessions |

### Feature Flags

| Method | Path | Description |
|--------|------|-------------|
| POST | `/feature-flags` | Create flag |
| GET | `/feature-flags` | List flags |
| PATCH | `/feature-flags/:flagId` | Update flag |
| DELETE | `/feature-flags/:flagId` | Delete flag |

### Audit Logs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit-logs` | List audit logs (owner-scoped) |
| GET | `/audit-logs/:logId` | Get log detail |

## Database Schema

16 migrations, 30+ tables across Supabase (PostgreSQL):

| Migration | Tables | Purpose |
|-----------|--------|---------|
| 00001 | — | Extensions (uuid-ossp, pgvector, moddatetime) |
| 00002 | `agents` | Core agent definitions |
| 00003 | `agent_sessions`, `agent_messages` | Conversation sessions |
| 00004 | `agent_wallets`, `wallet_transactions` | Financial layer |
| 00005 | `feature_flags` | Feature flag system |
| 00006 | `audit_logs` | Audit trail |
| 00007 | `marketplace_listings`, `marketplace_reviews` | Marketplace |
| 00008 | — | Row-Level Security policies |
| 00009 | `agent_memories` | Vector memory (pgvector) |
| 00010 | `agent_permissions` | RBAC permissions |
| 00011 | `hitl_policies`, `approval_requests` | Human-in-the-loop |
| 00012 | `eval_suites`, `eval_cases`, `eval_runs`, `eval_results` | Evaluation framework |
| 00013 | `data_connectors`, `data_pipelines`, `pipeline_steps`, `pipeline_runs` | Data pipelines |
| 00014 | `agent_templates`, `template_versions`, `agent_deployments` | Creation layer |
| 00015 | `agent_metrics`, `agent_usage_daily` | Analytics |
| 00016 | `agent_webhooks`, `webhook_deliveries` | Webhooks |

All tables use UUID primary keys, `created_at`/`updated_at` timestamps, and Row-Level Security.

## Infrastructure (Pulumi)

The `infra/` directory contains a Pulumi TypeScript program that provisions all GCP resources:

| Resource | Purpose |
|----------|---------|
| **VPC + Subnet** | Private networking (10.0.0.0/20) |
| **Cloud Run v2** | Control Plane API (auto-scaling 0-10 instances) |
| **GKE Autopilot** | Agent runtime cluster (private nodes, Workload Identity) |
| **Cloud Memorystore** | Redis 7.2 (BASIC for dev, STANDARD_HA for prod) |
| **Artifact Registry** | Docker image repository (7-day untagged cleanup) |
| **Cloud Storage** | Artifacts bucket (90-day lifecycle) + Log archive (365-day) |
| **Secret Manager** | Supabase URL + service key |
| **IAM** | Least-privilege service accounts (control-plane, agent-runtime) |
| **Monitoring** | Alert policies: latency p99 > 5s, 5xx rate > 5%, pod restarts > 5 |
| **Log Sink** | Routes Cloud Run + GKE logs to archive bucket |

```bash
cd infra
pulumi up --stack dev
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
- A [Supabase](https://supabase.com/) project

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/Aika-labs/Agents.git
cd Agents

# 2. Set up the control plane
cd services/control-plane
npm ci
cp .env.example .env  # Configure environment variables
npm run dev

# 3. Run database migrations
cd ../../supabase
supabase db push

# 4. (Optional) Start the agent runtime
cd ../services/agent-runtime
npm ci
npm run dev

# 5. (Optional) Start the protocols service
cd ../protocols
npm ci
npm run dev
```

### Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `PORT` | All | HTTP port (default: 8080 / 8082) |
| `NODE_ENV` | All | `development` or `production` |
| `SUPABASE_URL` | Control Plane | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Control Plane | Supabase service role key |
| `REDIS_URL` | Control Plane, Runtime | Redis connection string |
| `JWT_SECRET` | Control Plane | JWT signing secret |
| `CORS_ORIGIN` | Control Plane | Comma-separated allowed origins |
| `SERVICE_VERSION` | Control Plane | Reported in health checks |
| `GCP_PROJECT` | Infra | Google Cloud project ID |
| `GCP_REGION` | Infra | Deployment region |

## License

See [LICENSE](./LICENSE) for details.
