# Infrastructure -- Pulumi GCP

Pulumi TypeScript program that provisions all GCP resources for the Agent Operating System platform.

## Resources

| Resource | Type | Purpose |
|----------|------|---------|
| VPC + Subnet | `gcp.compute.Network/Subnetwork` | Private networking (10.0.0.0/20) |
| Cloud Run v2 | `gcp.cloudrunv2.Service` | Control Plane API (auto-scaling 0-10) |
| GKE Autopilot | `gcp.container.Cluster` | Agent runtime cluster (private nodes) |
| Cloud Memorystore | `gcp.redis.Instance` | Redis 7.2 (BASIC dev / STANDARD_HA prod) |
| Artifact Registry | `gcp.artifactregistry.Repository` | Docker images (7-day untagged cleanup) |
| Cloud Storage | `gcp.storage.Bucket` x2 | Artifacts (90-day) + Log archive (365-day) |
| Secret Manager | `gcp.secretmanager.Secret` x2 | Supabase URL + service key |
| IAM | `gcp.serviceaccount.Account` x2 | Control plane + agent runtime SAs |
| Monitoring | `gcp.monitoring.AlertPolicy` x3 | Latency, error rate, pod restarts |
| Log Sink | `gcp.logging.ProjectSink` | Routes Cloud Run + GKE logs to archive |

## Configuration

| Key | Required | Description |
|-----|----------|-------------|
| `gcp:project` | Yes | GCP project ID |
| `gcp:region` | No | Region (default: `us-central1`) |
| `agents-platform:environment` | No | Environment name (default: `dev`) |

```bash
pulumi config set gcp:project YOUR_PROJECT_ID
pulumi config set gcp:region us-central1
pulumi config set agents-platform:environment dev
```

## Stacks

| Stack | Environment | Redis Tier | Notes |
|-------|-------------|------------|-------|
| `dev` | Development | BASIC (1 GB) | Scale-to-zero Cloud Run, public endpoint |
| `staging` | Staging | STANDARD_HA | Same as prod but smaller limits |
| `prod` | Production | STANDARD_HA | IAP-protected, custom domain, HA Redis |

## Production Deployment Guide

### 1. Custom Domain + HTTPS

Cloud Run supports custom domain mapping. After deploying:

```bash
# Map a custom domain to the Cloud Run service
gcloud run domain-mappings create \
  --service=control-plane-api \
  --domain=api.yourdomain.com \
  --region=us-central1

# Verify DNS ownership and add the CNAME record shown
```

Alternatively, use a Global External Application Load Balancer with Cloud Armor for DDoS protection and WAF rules.

### 2. Identity-Aware Proxy (IAP)

For production, replace the `allUsers` IAM binding with IAP:

```bash
# Remove public access
gcloud run services remove-iam-policy-binding control-plane-api \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --region=us-central1

# Enable IAP on the load balancer backend
gcloud iap web enable --resource-type=backend-services \
  --service=YOUR_BACKEND_SERVICE_NAME
```

### 3. Redis High Availability

The infrastructure automatically uses `STANDARD_HA` tier when `environment` is set to `prod`. This provides:
- Automatic failover with a replica in a different zone
- 99.9% availability SLA
- No data loss on failover

For staging/prod, increase memory:

```bash
pulumi config set agents-platform:redisMemoryGb 5  # 5 GB for prod
```

### 4. Connection Pooling

**Supabase**: The Supabase client uses connection pooling by default via Supavisor (port 6543). For high-throughput scenarios, configure the pooler mode:

```
# Use transaction mode for serverless (Cloud Run)
SUPABASE_URL=postgresql://...@db.xxx.supabase.co:6543/postgres?pgbouncer=true
```

**Redis**: The `ioredis` client supports connection pooling natively. For Cloud Run with multiple instances, each instance maintains its own connection. No additional pooling is needed since Cloud Memorystore handles concurrent connections.

### 5. Secrets Management

Replace placeholder secrets with real values:

```bash
# Set Supabase URL
echo -n "https://xxx.supabase.co" | \
  gcloud secrets versions add agents-supabase-url-prod --data-file=-

# Set Supabase service key
echo -n "eyJ..." | \
  gcloud secrets versions add agents-supabase-key-prod --data-file=-
```

### 6. Monitoring & Alerting

Three alert policies are pre-configured:

1. **Control Plane Latency**: p99 > 5s over 5 minutes
2. **Control Plane Errors**: 5xx rate > 5% over 5 minutes
3. **Agent Pod Restarts**: > 5 restarts in 10 minutes

To add a notification channel:

```bash
# Create an email notification channel
gcloud monitoring channels create \
  --display-name="Platform Alerts" \
  --type=email \
  --channel-labels=email_address=team@yourdomain.com

# Link it to alert policies via the GCP Console or Pulumi
```

## Outputs

| Export | Description |
|--------|-------------|
| `projectId` | GCP project ID |
| `region` | Deployment region |
| `env` | Environment name |
| `controlPlaneUrl` | Cloud Run service URL |
| `controlPlaneServiceAccount` | Control plane SA email |
| `agentRuntimeServiceAccount` | Agent runtime SA email |
| `containerRegistryUrl` | Artifact Registry URL |
| `redisHost` | Redis instance host |
| `redisPort` | Redis instance port |
| `artifactsBucketName` | Artifacts GCS bucket |
| `gkeClusterName` | GKE cluster name |
| `gkeClusterEndpoint` | GKE cluster API endpoint |
| `logArchiveBucketName` | Log archive GCS bucket |

## Commands

```bash
# Preview changes
pulumi preview --stack dev

# Deploy
pulumi up --stack dev

# View outputs
pulumi stack output --stack dev

# Destroy (dev only!)
pulumi destroy --stack dev
```
