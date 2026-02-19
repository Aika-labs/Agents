"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { deployments } from "@/lib/api";
import type { Deployment, DeploymentStatus } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Rocket, CheckCircle, XCircle, Loader2, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const statusConfig: Record<DeploymentStatus, { color: string; icon: React.ElementType }> = {
  pending: { color: "bg-gray-100 text-gray-700", icon: Clock },
  building: { color: "bg-blue-100 text-blue-700", icon: Loader2 },
  deploying: { color: "bg-blue-100 text-blue-700", icon: Loader2 },
  running: { color: "bg-green-100 text-green-700", icon: CheckCircle },
  stopped: { color: "bg-gray-100 text-gray-700", icon: Clock },
  failed: { color: "bg-red-100 text-red-700", icon: XCircle },
  rolled_back: { color: "bg-yellow-100 text-yellow-700", icon: XCircle },
};

export default function DeploymentsPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [deploymentList, setDeploymentList] = useState<Deployment[]>([]);
  const [active, setActive] = useState<Deployment | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, act] = await Promise.allSettled([
        deployments.list(agentId, { limit: 20 }),
        deployments.getActive(agentId),
      ]);
      if (list.status === "fulfilled") setDeploymentList(list.value.data);
      if (act.status === "fulfilled") setActive(act.value);
    } catch {
      // API unreachable (demo mode or backend down) -- render empty state.
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Deployments</h2>
        <p className="text-muted-foreground text-sm">Deployment history and active deployment</p>
      </div>

      {/* Active Deployment */}
      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Deployment</CardTitle>
            <CardDescription>Currently running deployment</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Badge variant="outline" className={statusConfig[active.status].color}>
                {active.status}
              </Badge>
              <span className="text-sm">Target: {active.target}</span>
              <span className="text-sm text-muted-foreground">v{active.agent_version}</span>
              {active.started_at && (
                <span className="text-sm text-muted-foreground">
                  Started {formatDistanceToNow(new Date(active.started_at), { addSuffix: true })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deployment History */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : deploymentList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Rocket className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No deployments yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deploymentList.map((d) => {
                const config = statusConfig[d.status];
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Badge variant="outline" className={config.color}>{d.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{d.target}</TableCell>
                    <TableCell className="text-sm">v{d.agent_version}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {d.started_at ? format(new Date(d.started_at), "MMM d, HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {d.completed_at ? format(new Date(d.completed_at), "MMM d, HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-destructive max-w-[200px] truncate">
                      {d.error_message || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
