"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { agents, analytics, auditLogs } from "@/lib/api";
import type { Agent, AuditLog, TopAgent, AgentStatus } from "@/lib/types";
import { Bot, Zap, Pause, AlertTriangle, Archive, FileEdit, Activity } from "lucide-react";

// -- Status helpers -----------------------------------------------------------

const statusConfig: Record<AgentStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700", icon: FileEdit },
  running: { label: "Running", color: "bg-green-100 text-green-700", icon: Zap },
  paused: { label: "Paused", color: "bg-yellow-100 text-yellow-700", icon: Pause },
  stopped: { label: "Stopped", color: "bg-gray-100 text-gray-700", icon: Bot },
  error: { label: "Error", color: "bg-red-100 text-red-700", icon: AlertTriangle },
  archived: { label: "Archived", color: "bg-gray-100 text-gray-500", icon: Archive },
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// -- Component ----------------------------------------------------------------

export default function DashboardPage() {
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [topAgentsList, setTopAgentsList] = useState<TopAgent[]>([]);
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<{ total_tokens: number; total_sessions: number; estimated_cost_usd: number; error_count: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [agentsRes, topRes, logsRes, summaryRes] = await Promise.allSettled([
          agents.list({ limit: 100 }),
          analytics.topAgents({ dimension: "tokens", limit: 5 }),
          auditLogs.list({ limit: 10 }),
          analytics.ownerSummary(),
        ]);

        if (agentsRes.status === "fulfilled") setAgentList(agentsRes.value.data);
        if (topRes.status === "fulfilled") setTopAgentsList(topRes.value.data);
        if (logsRes.status === "fulfilled") setRecentLogs(logsRes.value.data);
        if (summaryRes.status === "fulfilled") setSummary(summaryRes.value);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Count agents by status.
  const statusCounts = agentList.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your Agent Operating System</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Agents</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : agentList.length}</div>
            <p className="text-xs text-muted-foreground">
              {statusCounts["running"] ?? 0} running, {statusCounts["draft"] ?? 0} draft
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.total_sessions ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.total_tokens ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              ~${(summary?.estimated_cost_usd ?? 0).toFixed(2)} estimated cost
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Errors</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.error_count ?? 0)}</div>
            <p className="text-xs text-muted-foreground">
              {statusCounts["error"] ?? 0} agents in error state
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Agent Status Breakdown + Top Agents */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Agent Status Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Status</CardTitle>
            <CardDescription>Distribution of agents by status</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : agentList.length === 0 ? (
              <p className="text-muted-foreground text-sm">No agents yet. <Link href="/dashboard/agents" className="underline">Create one</Link></p>
            ) : (
              <div className="space-y-3">
                {(Object.keys(statusConfig) as AgentStatus[]).map((status) => {
                  const count = statusCounts[status] ?? 0;
                  if (count === 0) return null;
                  const config = statusConfig[status];
                  const Icon = config.icon;
                  const pct = agentList.length > 0 ? (count / agentList.length) * 100 : 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span>{config.label}</span>
                          <span className="font-medium">{count}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-muted">
                          <div
                            className={`h-2 rounded-full ${status === "running" ? "bg-green-500" : status === "error" ? "bg-red-500" : status === "paused" ? "bg-yellow-500" : "bg-gray-400"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Agents */}
        <Card>
          <CardHeader>
            <CardTitle>Top Agents</CardTitle>
            <CardDescription>By token usage (last 30 days)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-sm">Loading...</p>
            ) : topAgentsList.length === 0 ? (
              <p className="text-muted-foreground text-sm">No usage data yet</p>
            ) : (
              <div className="space-y-3">
                {topAgentsList.map((ta, i) => (
                  <div key={ta.agent_id} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground w-5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ta.agent_name}</p>
                    </div>
                    <span className="text-sm font-mono">{ta.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest audit log entries</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : recentLogs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 text-sm">
                  <Badge
                    variant={log.severity === "critical" ? "destructive" : log.severity === "warning" ? "secondary" : "outline"}
                    className="mt-0.5 shrink-0"
                  >
                    {log.severity}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-muted-foreground truncate">
                      {log.resource_type}{log.resource_id ? ` / ${log.resource_id.slice(0, 8)}...` : ""}
                    </p>
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {formatRelativeTime(log.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
