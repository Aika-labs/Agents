"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { connectors, pipelines, pipelineRuns } from "@/lib/api";
import type { DataConnector, DataPipeline, PipelineRun } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Database, Play, Plug, Workflow } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const pipelineStatusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

export default function PipelinesPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [connectorList, setConnectorList] = useState<DataConnector[]>([]);
  const [pipelineList, setPipelineList] = useState<DataPipeline[]>([]);
  const [runList, setRunList] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p, r] = await Promise.all([
        connectors.list(agentId, { limit: 50 }),
        pipelines.list(agentId, { limit: 50 }),
        pipelineRuns.list(agentId, { limit: 20 }),
      ]);
      setConnectorList(c.data);
      setPipelineList(p.data);
      setRunList(r.data);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  async function handleTrigger(pipelineId: string) {
    setTriggering(pipelineId);
    try {
      await pipelineRuns.trigger(agentId, { pipeline_id: pipelineId });
      load();
    } finally {
      setTriggering(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Data Pipelines</h2>
        <p className="text-muted-foreground text-sm">Connectors, pipelines, and execution runs</p>
      </div>

      <Tabs defaultValue="pipelines">
        <TabsList>
          <TabsTrigger value="pipelines">Pipelines ({pipelineList.length})</TabsTrigger>
          <TabsTrigger value="connectors">Connectors ({connectorList.length})</TabsTrigger>
          <TabsTrigger value="runs">Runs ({runList.length})</TabsTrigger>
        </TabsList>

        {/* Pipelines */}
        <TabsContent value="pipelines" className="mt-4">
          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : pipelineList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Workflow className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pipelines configured</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pipelineList.map((p) => (
                <Card key={p.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-base">{p.name}</CardTitle>
                        <CardDescription>{p.description || "No description"}</CardDescription>
                      </div>
                      <Badge variant={p.is_active ? "default" : "secondary"}>
                        {p.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-muted-foreground">
                        {p.step_count ?? 0} steps
                        {p.schedule_cron && <span className="ml-2">| Cron: {p.schedule_cron}</span>}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={triggering === p.id}
                        onClick={() => handleTrigger(p.id)}
                      >
                        <Play className="mr-1 h-3 w-3" />
                        {triggering === p.id ? "Running..." : "Run"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Connectors */}
        <TabsContent value="connectors" className="mt-4">
          {connectorList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Plug className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No connectors configured</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {connectorList.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{c.name}</p>
                          {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{c.connector_type}</Badge></TableCell>
                      <TableCell className="text-sm">
                        {c.is_source && "Source"}
                        {c.is_source && c.is_sink && " / "}
                        {c.is_sink && "Sink"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.is_active ? "default" : "secondary"}>
                          {c.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Runs */}
        <TabsContent value="runs" className="mt-4">
          {runList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Database className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No pipeline runs yet</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Bytes</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runList.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant="outline" className={pipelineStatusColors[r.status] ?? ""}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="text-green-600">{r.records_written}</span>
                        {" / "}
                        <span>{r.records_read}</span>
                        {r.records_failed > 0 && (
                          <span className="text-red-600 ml-1">({r.records_failed} failed)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {(r.bytes_processed / 1024).toFixed(1)} KB
                      </TableCell>
                      <TableCell className="text-sm">{r.attempt_number}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.started_at
                          ? formatDistanceToNow(new Date(r.started_at), { addSuffix: true })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
