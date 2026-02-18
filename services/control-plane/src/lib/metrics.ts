/**
 * In-process metrics collector with Prometheus-compatible text exposition.
 *
 * Lightweight, zero-dependency metrics for the control plane. Tracks:
 *   - HTTP request count (by method, route, status)
 *   - HTTP request duration histogram (by method, route)
 *   - Error count (by type)
 *   - Active sessions gauge
 *   - Memory operations counter (store, search, delete)
 *
 * Exposed via GET /metrics in Prometheus text format, ready for
 * GCP Managed Prometheus / Cloud Monitoring scraping.
 */

// =============================================================================
// Counter
// =============================================================================

interface CounterLabels {
  [key: string]: string;
}

class Counter {
  readonly name: string;
  readonly help: string;
  private values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: CounterLabels = {}, value = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const [key, val] of this.values) {
      lines.push(`${this.name}${key} ${val}`);
    }
    return lines.join("\n");
  }
}

// =============================================================================
// Gauge
// =============================================================================

class Gauge {
  readonly name: string;
  readonly help: string;
  private values = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: CounterLabels, value: number): void {
    this.values.set(labelKey(labels), value);
  }

  inc(labels: CounterLabels = {}, value = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  dec(labels: CounterLabels = {}, value = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) - value);
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    for (const [key, val] of this.values) {
      lines.push(`${this.name}${key} ${val}`);
    }
    return lines.join("\n");
  }
}

// =============================================================================
// Histogram
// =============================================================================

class Histogram {
  readonly name: string;
  readonly help: string;
  private readonly bucketBounds: number[];
  private data = new Map<
    string,
    { buckets: number[]; sum: number; count: number }
  >();

  constructor(name: string, help: string, buckets: number[]) {
    this.name = name;
    this.help = help;
    this.bucketBounds = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: CounterLabels, value: number): void {
    const key = labelKey(labels);
    let entry = this.data.get(key);
    if (!entry) {
      entry = {
        buckets: new Array(this.bucketBounds.length).fill(0) as number[],
        sum: 0,
        count: 0,
      };
      this.data.set(key, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.bucketBounds.length; i++) {
      if (value <= this.bucketBounds[i]) {
        entry.buckets[i] += 1;
      }
    }
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];
    for (const [key, entry] of this.data) {
      const labelStr = key;
      const baseLabels = labelStr.replace(/^\{/, "").replace(/\}$/, "");

      for (let i = 0; i < this.bucketBounds.length; i++) {
        const le = this.bucketBounds[i];
        const sep = baseLabels ? "," : "";
        lines.push(
          `${this.name}_bucket{${baseLabels}${sep}le="${le}"} ${entry.buckets[i]}`,
        );
      }
      const infSep = baseLabels ? "," : "";
      lines.push(
        `${this.name}_bucket{${baseLabels}${infSep}le="+Inf"} ${entry.count}`,
      );
      lines.push(`${this.name}_sum${key} ${entry.sum}`);
      lines.push(`${this.name}_count${key} ${entry.count}`);
    }
    return lines.join("\n");
  }
}

// =============================================================================
// Metric instances
// =============================================================================

export const httpRequestsTotal = new Counter(
  "http_requests_total",
  "Total HTTP requests processed",
);

export const httpRequestDuration = new Histogram(
  "http_request_duration_seconds",
  "HTTP request duration in seconds",
  [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
);

export const httpErrorsTotal = new Counter(
  "http_errors_total",
  "Total HTTP errors by status code",
);

export const activeSessionsGauge = new Gauge(
  "active_sessions",
  "Number of currently active agent sessions",
);

export const memoryOpsTotal = new Counter(
  "memory_ops_total",
  "Total memory operations by type (store, search, delete, recall)",
);

const processStartTime = Date.now() / 1000;

// =============================================================================
// Rendering
// =============================================================================

const allMetrics: Array<Counter | Gauge | Histogram> = [
  httpRequestsTotal,
  httpRequestDuration,
  httpErrorsTotal,
  activeSessionsGauge,
  memoryOpsTotal,
];

/**
 * Render all metrics in Prometheus text exposition format.
 */
export function renderMetrics(): string {
  const sections = allMetrics.map((m) => m.render());

  const uptimeSeconds = Date.now() / 1000 - processStartTime;
  sections.push(
    `# HELP process_uptime_seconds Time since process start in seconds`,
    `# TYPE process_uptime_seconds gauge`,
    `process_uptime_seconds ${uptimeSeconds.toFixed(3)}`,
  );

  return sections.join("\n\n") + "\n";
}

// =============================================================================
// Helpers
// =============================================================================

function labelKey(labels: CounterLabels): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => `${k}="${v}"`);
  return `{${parts.join(",")}}`;
}
