"use client";

import { useEffect, useState, useCallback } from "react";
import { auditLogs } from "@/lib/api";
import type { AuditLog, AuditSeverity } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollText, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";

const ALL_SEVERITIES: AuditSeverity[] = ["info", "warning", "critical"];

const severityVariant: Record<AuditSeverity, "outline" | "secondary" | "destructive"> = {
  info: "outline",
  warning: "secondary",
  critical: "destructive",
};

const PAGE_SIZE = 25;

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  // Filters.
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [untilFilter, setUntilFilter] = useState("");

  // Detail drawer.
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset };
      if (severityFilter !== "all") params.severity = severityFilter;
      if (actionFilter.trim()) params.action = actionFilter.trim();
      if (resourceTypeFilter.trim()) params.resource_type = resourceTypeFilter.trim();
      if (sinceFilter) params.since = sinceFilter;
      if (untilFilter) params.until = untilFilter;
      const res = await auditLogs.list(params);
      setLogs(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [offset, severityFilter, actionFilter, resourceTypeFilter, sinceFilter, untilFilter]);

  useEffect(() => { load(); }, [load]);

  // Reset offset when filters change.
  useEffect(() => { setOffset(0); }, [severityFilter, actionFilter, resourceTypeFilter, sinceFilter, untilFilter]);

  const hasNext = total !== null ? offset + PAGE_SIZE < total : logs.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-muted-foreground">Track all actions across your platform</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {ALL_SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Action..."
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-[180px]"
            />
            <Input
              placeholder="Resource type..."
              value={resourceTypeFilter}
              onChange={(e) => setResourceTypeFilter(e.target.value)}
              className="w-[180px]"
            />
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground shrink-0">From:</Label>
              <Input
                type="date"
                value={sinceFilter}
                onChange={(e) => setSinceFilter(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground shrink-0">To:</Label>
              <Input
                type="date"
                value={untilFilter}
                onChange={(e) => setUntilFilter(e.target.value)}
                className="w-[160px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {loading ? (
        <p className="text-muted-foreground">Loading logs...</p>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <ScrollText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No audit logs found</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(log)}
                  >
                    <TableCell>
                      <Badge variant={severityVariant[log.severity]}>{log.severity}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell className="text-sm">
                      <span className="text-muted-foreground">{log.resource_type}</span>
                      {log.resource_id && (
                        <span className="font-mono text-xs ml-1">/{log.resource_id.slice(0, 8)}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {log.actor_id ? log.actor_id.slice(0, 8) + "..." : log.actor_type}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {offset + 1}–{offset + logs.length}
              {total !== null && ` of ${total}`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!hasPrev} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setOffset((o) => o + PAGE_SIZE)}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Detail Drawer */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-[500px] sm:max-w-[500px]">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.action}</SheetTitle>
                <SheetDescription>
                  <Badge variant={severityVariant[selected.severity]} className="mr-2">{selected.severity}</Badge>
                  {format(new Date(selected.created_at), "PPpp")}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">ID</dt>
                    <dd className="font-mono">{selected.id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Resource</dt>
                    <dd>{selected.resource_type} / {selected.resource_id ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Actor</dt>
                    <dd>{selected.actor_type}: {selected.actor_id ?? "—"}</dd>
                  </div>
                  {selected.agent_id && (
                    <div>
                      <dt className="text-muted-foreground">Agent</dt>
                      <dd className="font-mono">{selected.agent_id}</dd>
                    </div>
                  )}
                  {selected.session_id && (
                    <div>
                      <dt className="text-muted-foreground">Session</dt>
                      <dd className="font-mono">{selected.session_id}</dd>
                    </div>
                  )}
                  {selected.ip_address && (
                    <div>
                      <dt className="text-muted-foreground">IP Address</dt>
                      <dd>{selected.ip_address}</dd>
                    </div>
                  )}
                  {selected.request_id && (
                    <div>
                      <dt className="text-muted-foreground">Request ID</dt>
                      <dd className="font-mono text-xs">{selected.request_id}</dd>
                    </div>
                  )}
                </dl>
                {Object.keys(selected.evidence).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Evidence</CardTitle>
                      <CardDescription>Additional context captured with this event</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[300px]">
                        {JSON.stringify(selected.evidence, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
