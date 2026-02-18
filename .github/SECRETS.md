# Required GitHub Secrets

Configure these secrets in **Settings > Secrets and variables > Actions** before
the CI/CD pipelines will work.

## GCP Authentication (Workload Identity Federation)

| Secret | Description | Example |
|--------|-------------|---------|
| `GCP_PROJECT_ID` | GCP project ID | `my-project-123` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF provider resource name | `projects/123/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_SERVICE_ACCOUNT` | SA email for CI/CD | `github-ci@my-project.iam.gserviceaccount.com` |

### Setting up Workload Identity Federation

```bash
# 1. Create a Workload Identity Pool.
gcloud iam workload-identity-pools create "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions"

# 2. Create a provider for GitHub.
gcloud iam workload-identity-pools providers create-oidc "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# 3. Allow the GitHub repo to impersonate the service account.
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"
```

## Pulumi

| Secret | Description |
|--------|-------------|
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud access token for CI/CD |

## Supabase

| Secret | Description |
|--------|-------------|
| `SUPABASE_PROJECT_REF` | Supabase project reference ID (from project settings) |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token (from account settings) |
