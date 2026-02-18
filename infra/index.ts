import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";

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
// Networking -- Cloud Router + Cloud NAT for outbound internet access.
// GKE private nodes need NAT to pull external images and reach APIs.
// ---------------------------------------------------------------------------

const router = new gcp.compute.Router(
    "agents-router",
    {
        region: gcpRegion,
        network: network.id,
        description: "Cloud Router for NAT gateway",
    },
    { dependsOn: enabledApis },
);

new gcp.compute.RouterNat("agents-nat", {
    router: router.name,
    region: gcpRegion,
    natIpAllocateOption: "AUTO_ONLY",
    sourceSubnetworkIpRangesToNat: "ALL_SUBNETWORKS_ALL_IP_RANGES",
    logConfig: {
        enable: true,
        filter: "ERRORS_ONLY",
    },
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

// Protocols service account -- runs the MCP + A2A protocol gateway.
const protocolsSa = new gcp.serviceaccount.Account(
    "protocols-sa",
    {
        accountId: `agents-proto-${environment}`,
        displayName: "Agents Protocols Service Account",
        description:
            "Service account for the Protocols service (MCP + A2A on Cloud Run)",
    },
    { dependsOn: enabledApis },
);

const protocolsRoles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
];

protocolsRoles.forEach(
    (role) =>
        new gcp.projects.IAMMember(`proto-role-${role.split("/")[1]}`, {
            project: gcpProject,
            role,
            member: pulumi.interpolate`serviceAccount:${protocolsSa.email}`,
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

// Allow unauthenticated access to the control plane API in non-prod.
// Production should use IAP or an API gateway instead of allUsers.
if (environment !== "prod") {
    new gcp.cloudrunv2.ServiceIamMember("control-plane-public-access", {
        name: controlPlaneService.name,
        location: gcpRegion,
        role: "roles/run.invoker",
        member: "allUsers",
    });
}

// ---------------------------------------------------------------------------
// Cloud Run v2 -- Protocols service (MCP + A2A gateway).
// Uses a placeholder image; the real image is deployed via CI/CD.
// ---------------------------------------------------------------------------

const protocolsService = new gcp.cloudrunv2.Service(
    "protocols-api",
    {
        location: gcpRegion,
        description: "Agent Operating System - Protocols Service (MCP + A2A)",
        ingress: "INGRESS_TRAFFIC_ALL",
        deletionProtection: false,
        labels: commonLabels,
        template: {
            serviceAccount: protocolsSa.email,
            scaling: {
                minInstanceCount: 0,
                maxInstanceCount: 5,
            },
            containers: [
                {
                    // Placeholder image -- replaced by CI/CD pipeline.
                    image: "us-docker.pkg.dev/cloudrun/container/hello",
                    ports: { containerPort: 8082 },
                    resources: {
                        limits: {
                            cpu: "1",
                            memory: "512Mi",
                        },
                    },
                    envs: [
                        { name: "NODE_ENV", value: "production" },
                        { name: "ENVIRONMENT", value: environment },
                        { name: "PORT", value: "8082" },
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

// The protocols service needs to be reachable by other agents and services.
// In production, restrict access via IAP or service-to-service auth.
if (environment !== "prod") {
    new gcp.cloudrunv2.ServiceIamMember("protocols-public-access", {
        name: protocolsService.name,
        location: gcpRegion,
        role: "roles/run.invoker",
        member: "allUsers",
    });
}

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

// Secret versions are managed outside Pulumi via:
//   gcloud secrets versions add <secret-id> --data-file=-

const supabaseKeySecret = new gcp.secretmanager.Secret(
    "supabase-service-key",
    {
        secretId: `agents-supabase-key-${environment}`,
        replication: { auto: {} },
        labels: commonLabels,
    },
    { dependsOn: enabledApis },
);

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
// GKE Workloads -- Kubernetes provider, namespace, service account, and
// base deployment for the agent runtime.
// ---------------------------------------------------------------------------

const k8sProvider = new k8s.Provider("gke-provider", {
    kubeconfig: pulumi
        .all([gkeCluster.name, gkeCluster.endpoint, gkeCluster.masterAuth])
        .apply(([name, endpoint, auth]) => {
            const caCert = auth.clusterCaCertificate;
            return JSON.stringify({
                apiVersion: "v1",
                kind: "Config",
                clusters: [
                    {
                        name,
                        cluster: {
                            server: `https://${endpoint}`,
                            "certificate-authority-data": caCert,
                        },
                    },
                ],
                contexts: [
                    {
                        name,
                        context: { cluster: name, user: name },
                    },
                ],
                "current-context": name,
                users: [
                    {
                        name,
                        user: {
                            exec: {
                                apiVersion:
                                    "client.authentication.k8s.io/v1beta1",
                                command: "gke-gcloud-auth-plugin",
                                installHint:
                                    "Install gke-gcloud-auth-plugin for kubectl auth.",
                            },
                        },
                    },
                ],
            });
        }),
});

const agentsNamespace = new k8s.core.v1.Namespace(
    "agents-ns",
    {
        metadata: {
            name: "agents",
            labels: commonLabels,
        },
    },
    { provider: k8sProvider },
);

// Kubernetes service account annotated for Workload Identity so pods can
// impersonate the GCP agent-runtime service account.
const k8sAgentSa = new k8s.core.v1.ServiceAccount(
    "agent-runtime-k8s-sa",
    {
        metadata: {
            name: "agent-runtime",
            namespace: agentsNamespace.metadata.name,
            annotations: {
                "iam.gke.io/gcp-service-account": agentRuntimeSa.email,
            },
            labels: commonLabels,
        },
    },
    { provider: k8sProvider },
);

// Allow the K8s SA to impersonate the GCP SA via Workload Identity.
new gcp.serviceaccount.IAMMember("agent-runtime-wi-binding", {
    serviceAccountId: agentRuntimeSa.name,
    role: "roles/iam.workloadIdentityUser",
    member: pulumi.interpolate`serviceAccount:${gcpProject}.svc.id.goog[agents/agent-runtime]`,
});

// Base deployment for the agent runtime. Uses a placeholder image that
// CI/CD replaces with `kubectl set image`.
new k8s.apps.v1.Deployment(
    "agent-runtime-deploy",
    {
        metadata: {
            name: "agent-runtime",
            namespace: agentsNamespace.metadata.name,
            labels: { ...commonLabels, app: "agent-runtime" },
        },
        spec: {
            replicas: 1,
            selector: {
                matchLabels: { app: "agent-runtime" },
            },
            template: {
                metadata: {
                    labels: { app: "agent-runtime", ...commonLabels },
                },
                spec: {
                    serviceAccountName: k8sAgentSa.metadata.name,
                    containers: [
                        {
                            name: "agent-runtime",
                            // Placeholder -- CI/CD updates this image.
                            image: "us-docker.pkg.dev/cloudrun/container/hello",
                            ports: [{ containerPort: 8081 }],
                            resources: {
                                requests: { cpu: "250m", memory: "256Mi" },
                                limits: { cpu: "1", memory: "512Mi" },
                            },
                            env: [
                                {
                                    name: "NODE_ENV",
                                    value: "production",
                                },
                                {
                                    name: "ENVIRONMENT",
                                    value: environment,
                                },
                                {
                                    name: "PORT",
                                    value: "8081",
                                },
                            ],
                            livenessProbe: {
                                httpGet: { path: "/health", port: 8081 },
                                initialDelaySeconds: 15,
                                periodSeconds: 30,
                            },
                            readinessProbe: {
                                httpGet: { path: "/health", port: 8081 },
                                initialDelaySeconds: 5,
                                periodSeconds: 10,
                            },
                        },
                    ],
                },
            },
        },
    },
    { provider: k8sProvider },
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
export const protocolsServiceAccount = protocolsSa.email;
export const protocolsUrl = protocolsService.uri;
export const containerRegistryUrl = containerRepo.registryUri;
export const redisHost = redisInstance.host;
export const redisPort = redisInstance.port;
export const artifactsBucketName = artifactsBucket.name;
export const supabaseUrlSecretId = supabaseUrlSecret.secretId;
export const supabaseKeySecretId = supabaseKeySecret.secretId;
export const gkeClusterName = gkeCluster.name;
export const gkeClusterEndpoint = gkeCluster.endpoint;
export const logArchiveBucketName = logBucket.name;
