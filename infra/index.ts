import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

// ---------------------------------------------------------------------------
// Configuration -- all values parameterized for multi-environment support.
// ---------------------------------------------------------------------------

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");

const gcpProject = gcpConfig.require("project");
const gcpRegion = gcpConfig.get("region") ?? "us-central1";
const environment = config.get("environment") ?? "dev";

const commonLabels: Record<string, string> = {
    "managed-by": "pulumi",
    project: "agents-platform",
    environment,
};

// ---------------------------------------------------------------------------
// Enable required GCP APIs.
// ---------------------------------------------------------------------------

const requiredApis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "redis.googleapis.com",
    "container.googleapis.com",
];

const enabledApis = requiredApis.map(
    (api) =>
        new gcp.projects.Service(`api-${api}`, {
            service: api,
            disableOnDestroy: false,
        }),
);

// ---------------------------------------------------------------------------
// Networking -- custom VPC with a single subnet for Cloud Run & future GKE.
// ---------------------------------------------------------------------------

const network = new gcp.compute.Network(
    "agents-network",
    {
        autoCreateSubnetworks: false,
        description: "VPC for the Agent Operating System platform",
    },
    { dependsOn: enabledApis },
);

const subnet = new gcp.compute.Subnetwork("agents-subnet", {
    ipCidrRange: "10.0.0.0/20",
    region: gcpRegion,
    network: network.id,
    privateIpGoogleAccess: true,
    description: "Primary subnet for agents platform services",
});

// ---------------------------------------------------------------------------
// IAM -- dedicated service accounts with least-privilege.
// ---------------------------------------------------------------------------

const controlPlaneSa = new gcp.serviceaccount.Account(
    "control-plane-sa",
    {
        accountId: `agents-cp-${environment}`,
        displayName: "Agents Control Plane Service Account",
        description:
            "Service account for the Control Plane API (Cloud Run)",
    },
    { dependsOn: enabledApis },
);

const agentRuntimeSa = new gcp.serviceaccount.Account(
    "agent-runtime-sa",
    {
        accountId: `agents-rt-${environment}`,
        displayName: "Agent Runtime Service Account",
        description:
            "Service account for individual agent workloads",
    },
    { dependsOn: enabledApis },
);

// Grant the control plane SA permissions it needs.
const controlPlaneRoles = [
    "roles/run.invoker",
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/storage.objectAdmin",
];

controlPlaneRoles.forEach(
    (role) =>
        new gcp.projects.IAMMember(`cp-role-${role.split("/")[1]}`, {
            project: gcpProject,
            role,
            member: pulumi.interpolate`serviceAccount:${controlPlaneSa.email}`,
        }),
);

// Grant the agent runtime SA minimal permissions.
const agentRuntimeRoles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/storage.objectViewer",
];

agentRuntimeRoles.forEach(
    (role) =>
        new gcp.projects.IAMMember(`rt-role-${role.split("/")[1]}`, {
            project: gcpProject,
            role,
            member: pulumi.interpolate`serviceAccount:${agentRuntimeSa.email}`,
        }),
);

// ---------------------------------------------------------------------------
// Artifact Registry -- Docker repository for container images.
// ---------------------------------------------------------------------------

const containerRepo = new gcp.artifactregistry.Repository(
    "agents-container-repo",
    {
        repositoryId: `agents-${environment}`,
        location: gcpRegion,
        format: "DOCKER",
        description:
            "Docker images for the Agent Operating System platform",
        labels: commonLabels,
        cleanupPolicies: [
            {
                id: "delete-untagged",
                action: "DELETE",
                condition: {
                    tagState: "UNTAGGED",
                    olderThan: "604800s", // 7 days
                },
            },
        ],
    },
    { dependsOn: enabledApis },
);

// ---------------------------------------------------------------------------
// Cloud Run v2 -- Control Plane API service.
// Uses a placeholder image; the real image is deployed via CI/CD.
// ---------------------------------------------------------------------------

const controlPlaneService = new gcp.cloudrunv2.Service(
    "control-plane-api",
    {
        location: gcpRegion,
        description: "Agent Operating System - Control Plane API",
        ingress: "INGRESS_TRAFFIC_ALL",
        deletionProtection: false,
        labels: commonLabels,
        template: {
            serviceAccount: controlPlaneSa.email,
            scaling: {
                minInstanceCount: 0, // Scale to zero for cost savings.
                maxInstanceCount: 10,
            },
            containers: [
                {
                    // Placeholder image -- replaced by CI/CD pipeline.
                    image: "us-docker.pkg.dev/cloudrun/container/hello",
                    ports: { containerPort: 8080 },
                    resources: {
                        limits: {
                            cpu: "1",
                            memory: "512Mi",
                        },
                    },
                    envs: [
                        { name: "NODE_ENV", value: "production" },
                        { name: "ENVIRONMENT", value: environment },
                        { name: "GCP_PROJECT", value: gcpProject },
                        { name: "GCP_REGION", value: gcpRegion },
                    ],
                },
            ],
            vpcAccess: {
                networkInterfaces: [
                    {
                        network: network.name,
                        subnetwork: subnet.name,
                    },
                ],
            },
        },
    },
    { dependsOn: enabledApis },
);

// Allow unauthenticated access to the control plane API (public endpoint).
// In production, this would be behind an API gateway / IAP.
new gcp.cloudrunv2.ServiceIamMember("control-plane-public-access", {
    name: controlPlaneService.name,
    location: gcpRegion,
    role: "roles/run.invoker",
    member: "allUsers",
});

// ---------------------------------------------------------------------------
// Data Layer -- Redis for real-time agent state & pub/sub.
// BASIC tier (1 GB) is the cheapest option for dev; upgrade to STANDARD_HA
// for production.
// ---------------------------------------------------------------------------

const redisInstance = new gcp.redis.Instance(
    "agents-redis",
    {
        memorySizeGb: 1,
        tier: environment === "prod" ? "STANDARD_HA" : "BASIC",
        region: gcpRegion,
        authorizedNetwork: network.id,
        redisVersion: "REDIS_7_2",
        displayName: `Agents Platform Redis (${environment})`,
        labels: commonLabels,
        connectMode: "DIRECT_PEERING",
        redisConfigs: {
            "maxmemory-policy": "allkeys-lru",
            "notify-keyspace-events": "Ex", // Enable expiry notifications.
        },
    },
    { dependsOn: enabledApis },
);

// ---------------------------------------------------------------------------
// Data Layer -- Cloud Storage for agent artifacts (generated files, exports).
// ---------------------------------------------------------------------------

const artifactsBucket = new gcp.storage.Bucket(
    "agents-artifacts",
    {
        location: gcpRegion,
        uniformBucketLevelAccess: true,
        labels: commonLabels,
        lifecycleRules: [
            {
                action: { type: "Delete" },
                condition: { age: 90 }, // Auto-delete artifacts after 90 days.
            },
        ],
        versioning: { enabled: true },
    },
    { dependsOn: enabledApis },
);

// ---------------------------------------------------------------------------
// Data Layer -- Supabase connection stored as secrets.
// The actual Supabase instance is managed externally (supabase.com).
// We store the connection URL and anon key as GCP secrets so the
// Control Plane and Agent Runtime can access them securely.
// ---------------------------------------------------------------------------

const supabaseUrlSecret = new gcp.secretmanager.Secret(
    "supabase-url",
    {
        secretId: `agents-supabase-url-${environment}`,
        replication: { auto: {} },
        labels: commonLabels,
    },
    { dependsOn: enabledApis },
);

// Placeholder version -- the real value is set via:
//   gcloud secrets versions add <secret-id> --data-file=-
new gcp.secretmanager.SecretVersion("supabase-url-placeholder", {
    secret: supabaseUrlSecret.id,
    secretData: "PLACEHOLDER_SET_VIA_CLI",
});

const supabaseKeySecret = new gcp.secretmanager.Secret(
    "supabase-service-key",
    {
        secretId: `agents-supabase-key-${environment}`,
        replication: { auto: {} },
        labels: commonLabels,
    },
    { dependsOn: enabledApis },
);

new gcp.secretmanager.SecretVersion("supabase-key-placeholder", {
    secret: supabaseKeySecret.id,
    secretData: "PLACEHOLDER_SET_VIA_CLI",
});

// ---------------------------------------------------------------------------
// Agent Runtime -- GKE Autopilot cluster.
// Autopilot manages node pools automatically and bills per-pod, making it
// the most cost-effective option for variable agent workloads.
// ---------------------------------------------------------------------------

const gkeCluster = new gcp.container.Cluster(
    "agents-runtime",
    {
        location: gcpRegion,
        description: "GKE Autopilot cluster for running AI agent workloads",
        enableAutopilot: true,
        network: network.name,
        subnetwork: subnet.name,
        deletionProtection: false,
        resourceLabels: commonLabels,
        // Workload Identity lets K8s service accounts impersonate GCP SAs.
        workloadIdentityConfig: {
            workloadPool: `${gcpProject}.svc.id.goog`,
        },
        // Use the REGULAR release channel for stability.
        releaseChannel: {
            channel: "REGULAR",
        },
        // Private cluster: nodes have no public IPs, master is accessible.
        privateClusterConfig: {
            enablePrivateNodes: true,
            enablePrivateEndpoint: false,
            masterIpv4CidrBlock: "172.16.0.0/28",
        },
        // IP allocation for pods and services.
        ipAllocationPolicy: {},
    },
    { dependsOn: enabledApis },
);

// ---------------------------------------------------------------------------
// Observability -- Log sink for agent-related logs.
// Routes matching logs to a dedicated Cloud Storage bucket for long-term
// retention and offline analysis.
// ---------------------------------------------------------------------------

const logBucket = new gcp.storage.Bucket(
    "agents-log-archive",
    {
        location: gcpRegion,
        uniformBucketLevelAccess: true,
        labels: commonLabels,
        lifecycleRules: [
            {
                action: { type: "Delete" },
                condition: { age: 365 }, // Retain logs for 1 year.
            },
        ],
    },
    { dependsOn: enabledApis },
);

const logSink = new gcp.logging.ProjectSink("agents-log-sink", {
    filter: [
        `resource.type="cloud_run_revision" OR`,
        `resource.type="k8s_container" OR`,
        `resource.type="k8s_pod"`,
    ].join(" "),
    destination: pulumi.interpolate`storage.googleapis.com/${logBucket.name}`,
    uniqueWriterIdentity: true,
});

// Grant the log sink's writer identity permission to write to the bucket.
new gcp.storage.BucketIAMMember("log-sink-writer", {
    bucket: logBucket.name,
    role: "roles/storage.objectCreator",
    member: logSink.writerIdentity,
});

// ---------------------------------------------------------------------------
// Observability -- Monitoring alert policies.
// ---------------------------------------------------------------------------

// Alert: Cloud Run Control Plane latency > 5s (p99) over 5 minutes.
new gcp.monitoring.AlertPolicy("control-plane-latency", {
    displayName: `[${environment}] Control Plane API High Latency`,
    combiner: "OR",
    conditions: [
        {
            displayName: "Request latency > 5s (p99)",
            conditionThreshold: {
                filter: [
                    `resource.type = "cloud_run_revision"`,
                    `metric.type = "run.googleapis.com/request_latencies"`,
                ].join(" AND "),
                aggregations: [
                    {
                        alignmentPeriod: "300s",
                        perSeriesAligner: "ALIGN_PERCENTILE_99",
                    },
                ],
                comparison: "COMPARISON_GT",
                thresholdValue: 5000, // 5000 ms
                duration: "300s",
            },
        },
    ],
    alertStrategy: {
        autoClose: "1800s", // Auto-close after 30 minutes.
    },
});

// Alert: Cloud Run 5xx error rate > 5% over 5 minutes.
new gcp.monitoring.AlertPolicy("control-plane-errors", {
    displayName: `[${environment}] Control Plane API High Error Rate`,
    combiner: "OR",
    conditions: [
        {
            displayName: "5xx error rate > 5%",
            conditionThreshold: {
                filter: [
                    `resource.type = "cloud_run_revision"`,
                    `metric.type = "run.googleapis.com/request_count"`,
                    `metric.labels.response_code_class = "5xx"`,
                ].join(" AND "),
                aggregations: [
                    {
                        alignmentPeriod: "300s",
                        perSeriesAligner: "ALIGN_RATE",
                    },
                ],
                comparison: "COMPARISON_GT",
                thresholdValue: 0.05,
                duration: "300s",
            },
        },
    ],
    alertStrategy: {
        autoClose: "1800s",
    },
});

// Alert: GKE pod restart count > 5 in 10 minutes (crash-looping agents).
new gcp.monitoring.AlertPolicy("agent-pod-restarts", {
    displayName: `[${environment}] Agent Pod Excessive Restarts`,
    combiner: "OR",
    conditions: [
        {
            displayName: "Pod restart count > 5 in 10m",
            conditionThreshold: {
                filter: [
                    `resource.type = "k8s_container"`,
                    `metric.type = "kubernetes.io/container/restart_count"`,
                ].join(" AND "),
                aggregations: [
                    {
                        alignmentPeriod: "600s",
                        perSeriesAligner: "ALIGN_DELTA",
                    },
                ],
                comparison: "COMPARISON_GT",
                thresholdValue: 5,
                duration: "0s",
            },
        },
    ],
    alertStrategy: {
        autoClose: "1800s",
    },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const projectId = gcpProject;
export const region = gcpRegion;
export const env = environment;
export const vpcNetworkName = network.name;
export const subnetName = subnet.name;
export const controlPlaneUrl = controlPlaneService.uri;
export const controlPlaneServiceAccount = controlPlaneSa.email;
export const agentRuntimeServiceAccount = agentRuntimeSa.email;
export const containerRegistryUrl = containerRepo.registryUri;
export const redisHost = redisInstance.host;
export const redisPort = redisInstance.port;
export const artifactsBucketName = artifactsBucket.name;
export const supabaseUrlSecretId = supabaseUrlSecret.secretId;
export const supabaseKeySecretId = supabaseKeySecret.secretId;
export const gkeClusterName = gkeCluster.name;
export const gkeClusterEndpoint = gkeCluster.endpoint;
export const logArchiveBucketName = logBucket.name;
