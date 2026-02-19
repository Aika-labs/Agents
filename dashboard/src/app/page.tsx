import Link from "next/link";
import {
  Bot,
  Zap,
  Shield,
  BarChart3,
  GitBranch,
  Layers,
  ArrowRight,
  Terminal,
  Globe,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const features = [
  {
    icon: Bot,
    title: "Multi-Framework Runtime",
    description:
      "Run agents built with Google ADK, LangGraph, or your own custom runtime on a unified execution layer.",
  },
  {
    icon: GitBranch,
    title: "A2A & MCP Protocols",
    description:
      "Agent-to-Agent task delegation and Model Context Protocol for tool sharing across your fleet.",
  },
  {
    icon: Shield,
    title: "Security & RBAC",
    description:
      "Fine-grained permissions, JWT auth, API keys, row-level security, and human-in-the-loop approvals.",
  },
  {
    icon: BarChart3,
    title: "Analytics & Observability",
    description:
      "Token usage, session metrics, cost estimates, structured logging, and Prometheus-compatible alerts.",
  },
  {
    icon: Layers,
    title: "Eval & Data Pipelines",
    description:
      "Test suites with automated runs, data connectors, multi-step pipelines, and vector memory search.",
  },
  {
    icon: Zap,
    title: "Feature Flags & Kill Switch",
    description:
      "Roll out capabilities gradually, toggle behaviour at runtime, and instantly stop any agent.",
  },
];

const stats = [
  { value: "80+", label: "API Endpoints" },
  { value: "22", label: "Dashboard Pages" },
  { value: "30+", label: "Database Tables" },
  { value: "9", label: "Architecture Layers" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ---- Navbar ---- */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <Terminal className="h-5 w-5" />
            Agent OS
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </nav>

      {/* ---- Hero ---- */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center lg:py-32">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm text-muted-foreground">
            <Globe className="h-3.5 w-3.5" />
            Open-source agent platform
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Build, deploy &amp; manage{" "}
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              AI agents
            </span>{" "}
            at scale
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            A full-stack platform with a unified control plane, multi-framework
            runtime, inter-agent protocols, and production-grade infrastructure
            on Google Cloud.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to Dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/Aika-labs/Agents"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border px-6 py-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              <svg
                className="h-4 w-4"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  clipRule="evenodd"
                />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ---- Stats ---- */}
      <section className="border-y bg-muted/40">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold tracking-tight">{s.value}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Features ---- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Everything you need to run agents in production
          </h2>
          <p className="mt-3 text-muted-foreground">
            Nine architectural layers covering the full agent lifecycle.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-lg border bg-card p-6 transition-shadow hover:shadow-md"
            >
              <div className="mb-4 inline-flex rounded-md bg-primary/10 p-2.5">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mb-2 font-semibold">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Tech Stack ---- */}
      <section className="border-t bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Tech Stack</h2>
          </div>
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            {[
              ["Hono", "API Framework"],
              ["Supabase", "Database + Auth"],
              ["Redis 7.2", "Cache & Pub/Sub"],
              ["Cloud Run v2", "API Gateway"],
              ["Pulumi", "Infrastructure"],
              ["Next.js 15", "Dashboard"],
              ["GitHub Actions", "CI/CD"],
              ["pgvector", "Vector Search"],
              ["Zod", "Validation"],
            ].map(([name, role]) => (
              <div
                key={name}
                className="rounded-md border bg-card px-4 py-3 text-center"
              >
                <div className="font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">{role}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- CTA ---- */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight">
          Ready to get started?
        </h2>
        <p className="mt-3 text-muted-foreground">
          Open the dashboard to explore agents, sessions, analytics, and more.
        </p>
        <div className="mt-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-muted-foreground">
          <span>Agent OS by Aika Labs</span>
          <a
            href="https://github.com/Aika-labs/Agents"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
