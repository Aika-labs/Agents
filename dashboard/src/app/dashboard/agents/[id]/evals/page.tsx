"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { evalSuites, evalRuns } from "@/lib/api";
import type { EvalSuite, EvalRun } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { FlaskConical, Play, CheckCircle, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const runStatusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export default function EvalsPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        evalSuites.list(agentId, { limit: 50 }),
        evalRuns.list(agentId, { limit: 20 }),
      ]);
      setSuites(s.data);
      setRuns(r.data);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  async function handleTrigger(suiteId: string) {
    setTriggering(suiteId);
    try {
      await evalRuns.trigger(agentId, { suite_id: suiteId });
      load();
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Evaluations</h2>
        <p className="text-muted-foreground text-sm">Test suites and evaluation runs</p>
      </div>

      <Tabs defaultValue="suites">
        <TabsList>
          <TabsTrigger value="suites">Suites ({suites.length})</TabsTrigger>
          <TabsTrigger value="runs">Runs ({runs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="suites" className="mt-4">
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : suites.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FlaskConical className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No eval suites configured</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {suites.map((suite) => (
                <Card key={suite.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{suite.name}</CardTitle>
                        <CardDescription>{suite.description || "No description"}</CardDescription>
                      </div>
                      <Badge variant={suite.is_active ? "default" : "secondary"}>
                        {suite.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {suite.case_count ?? 0} cases
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={triggering === suite.id}
                        onClick={() => handleTrigger(suite.id)}
                      >
                        <Play className="mr-1 h-3 w-3" />
                        {triggering === suite.id ? "Running..." : "Run"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          {runs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">No evaluation runs yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Results</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => {
                    const passRate = run.total_cases > 0 ? (run.passed_cases / run.total_cases) * 100 : 0;
                    return (
                      <TableRow key={run.id}>
                        <TableCell>
                          <Badge variant="outline" className={runStatusColors[run.status] ?? ""}>
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-3 w-3 text-green-600" />
                            <span className="text-sm">{run.passed_cases}</span>
                            <XCircle className="h-3 w-3 text-red-600" />
                            <span className="text-sm">{run.failed_cases}</span>
                            <span className="text-xs text-muted-foreground">/ {run.total_cases}</span>
                          </div>
                          <Progress value={passRate} className="mt-1 h-1.5" />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {Number(run.avg_score).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {Number(run.avg_latency_ms).toFixed(0)}ms
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {run.started_at
                            ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true })
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
