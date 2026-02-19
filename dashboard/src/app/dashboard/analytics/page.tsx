"use client";

import { useEffect, useState, useCallback } from "react";
import { analytics, agents as agentsApi } from "@/lib/api";
import type { AnalyticsSummary, TopAgent, TimeSeriesPoint, Agent } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, Zap, MessageSquare, DollarSign, AlertTriangle, Clock } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import { format } from "date-fns";

const DIMENSIONS = [
  { value: "tokens", label: "Tokens" },
  { value: "sessions", label: "Sessions" },
  { value: "cost", label: "Cost" },
  { value: "errors", label: "Errors" },
];

const PERIODS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [topAgents, setTopAgents] = useState<TopAgent[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const [dimension, setDimension] = useState("tokens");
  const [selectedAgent, setSelectedAgent] = useState<string>("all");
  const [period, setPeriod] = useState("daily");

  // Load owner-level data.
  useEffect(() => {
    async function loadOwner() {
      setLoading(true);
      try {
        const [s, t, a] = await Promise.allSettled([
          analytics.ownerSummary(),
          analytics.topAgents({ dimension, limit: 10 }),
          agentsApi.list({ limit: 100 }),
        ]);
        if (s.status === "fulfilled") setSummary(s.value);
        if (t.status === "fulfilled") setTopAgents(t.value.data);
        if (a.status === "fulfilled") setAgentList(a.value.data);
      } finally {
        setLoading(false);
      }
    }
    loadOwner();
  }, [dimension]);

  // Load time series for selected agent.
  const loadTimeSeries = useCallback(async () => {
    if (selectedAgent === "all") {
      setTimeSeries([]);
      return;
    }
    try {
      const res = await analytics.agentTimeSeries(selectedAgent, { period });
      setTimeSeries(res.data);
    } catch {
      setTimeSeries([]);
    }
  }, [selectedAgent, period]);

  useEffect(() => { loadTimeSeries(); }, [loadTimeSeries]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">Usage metrics and performance insights</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tokens</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.total_tokens ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.total_sessions ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.total_messages ?? 0).toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Est. Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${loading ? "..." : (summary?.estimated_cost_usd ?? 0).toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Errors</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : (summary?.error_count ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? "..." : `${(summary?.avg_latency_ms ?? 0).toFixed(0)}ms`}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="leaderboard">
        <TabsList>
          <TabsTrigger value="leaderboard">Top Agents</TabsTrigger>
          <TabsTrigger value="timeseries">Time Series</TabsTrigger>
        </TabsList>

        {/* Top Agents Leaderboard */}
        <TabsContent value="leaderboard" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Rank by:</span>
            <Select value={dimension} onValueChange={setDimension}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIMENSIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : topAgents.length === 0 ? (
            <p className="text-muted-foreground">No data available</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Bar chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Agents by {dimension}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topAgents} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="agent_name" width={80} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Leaderboard</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead className="text-right capitalize">{dimension}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topAgents.map((ta, i) => (
                        <TableRow key={ta.agent_id}>
                          <TableCell className="font-medium">{i + 1}</TableCell>
                          <TableCell>{ta.agent_name}</TableCell>
                          <TableCell className="text-right font-mono">
                            {dimension === "cost" ? `$${ta.value.toFixed(2)}` : ta.value.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Time Series */}
        <TabsContent value="timeseries" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">Agent:</span>
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className="w-[250px]"><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Select an agent...</SelectItem>
                  {agentList.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-sm text-muted-foreground">Period:</span>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedAgent === "all" ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Select an agent to view time series data
              </CardContent>
            </Card>
          ) : timeSeries.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No time series data available for this agent
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Usage Over Time</CardTitle>
                <CardDescription>Tokens, sessions, and errors per {period} bucket</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={timeSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="bucket_start"
                      tickFormatter={(v: string) => format(new Date(v), period === "hourly" ? "HH:mm" : "MMM d")}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      labelFormatter={(v) => format(new Date(String(v)), "PPpp")}
                    />
                    <Area type="monotone" dataKey="total_tokens" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} name="Tokens" />
                    <Area type="monotone" dataKey="session_count" stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.2} name="Sessions" />
                    <Area type="monotone" dataKey="error_count" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.2} name="Errors" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
