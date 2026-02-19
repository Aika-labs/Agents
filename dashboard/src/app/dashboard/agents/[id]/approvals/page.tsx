"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { approvals, hitlPolicies } from "@/lib/api";
import type { ApprovalRequest, HitlPolicy, ApprovalStatus } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, XCircle, Clock, HandMetal, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ALL_STATUSES: ApprovalStatus[] = ["pending", "approved", "rejected", "expired", "cancelled"];

const statusConfig: Record<ApprovalStatus, { color: string; icon: React.ElementType }> = {
  pending: { color: "bg-yellow-100 text-yellow-700", icon: Clock },
  approved: { color: "bg-green-100 text-green-700", icon: CheckCircle },
  rejected: { color: "bg-red-100 text-red-700", icon: XCircle },
  expired: { color: "bg-gray-100 text-gray-500", icon: Clock },
  cancelled: { color: "bg-gray-100 text-gray-500", icon: XCircle },
};

export default function ApprovalsPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [approvalList, setApprovalList] = useState<ApprovalRequest[]>([]);
  const [policies, setPolicies] = useState<HitlPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params_: Record<string, string | number> = { limit: 50 };
      if (statusFilter !== "all") params_.status = statusFilter;
      const [a, p] = await Promise.all([
        approvals.list(agentId, params_),
        hitlPolicies.list(agentId, { limit: 50 }),
      ]);
      setApprovalList(a.data);
      setPolicies(p.data);
    } catch {
      // API unreachable (demo mode or backend down) -- render empty state.
    } finally {
      setLoading(false);
    }
  }, [agentId, statusFilter]);

  useEffect(() => { void load(); }, [load]);

  async function handleResolve(approvalId: string, status: "approved" | "rejected") {
    await approvals.resolve(agentId, approvalId, { status });
    load();
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Human-in-the-Loop</h2>
        <p className="text-muted-foreground text-sm">Approval queue and HITL policies</p>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Approval Queue</TabsTrigger>
          <TabsTrigger value="policies">Policies ({policies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-4 space-y-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : approvalList.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <HandMetal className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No approval requests</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {approvalList.map((req) => {
                const config = statusConfig[req.status];
                const Icon = config.icon;
                return (
                  <Card key={req.id}>
                    <CardContent className="py-4">
                      <div className="flex items-start gap-4">
                        <Icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{req.action_type}</span>
                            <Badge variant="outline" className={config.color}>{req.status}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{req.action_summary}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                            {req.expires_at && ` | Expires ${formatDistanceToNow(new Date(req.expires_at), { addSuffix: true })}`}
                          </p>
                        </div>
                        {req.status === "pending" && (
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => handleResolve(req.id, "approved")}>
                              <CheckCircle className="mr-1 h-4 w-4" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleResolve(req.id, "rejected")}>
                              <XCircle className="mr-1 h-4 w-4" /> Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="policies" className="mt-4">
          {policies.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Shield className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No HITL policies configured</p>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Auto-approve</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Priority</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{p.name}</p>
                          {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{p.trigger_type}</Badge></TableCell>
                      <TableCell>{p.auto_approve ? "Yes" : "No"}</TableCell>
                      <TableCell>
                        <Badge variant={p.is_active ? "default" : "secondary"}>
                          {p.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>{p.priority}</TableCell>
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
