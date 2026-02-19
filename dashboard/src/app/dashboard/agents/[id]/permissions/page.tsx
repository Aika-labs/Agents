"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { permissions } from "@/lib/api";
import type { AgentPermission, AgentRole } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Shield, Trash2 } from "lucide-react";
import { format } from "date-fns";

const ALL_ROLES: AgentRole[] = ["admin", "editor", "viewer"];

const roleColors: Record<AgentRole, string> = {
  owner: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  editor: "bg-green-100 text-green-700",
  viewer: "bg-gray-100 text-gray-700",
};

export default function PermissionsPage() {
  const params = useParams();
  const agentId = params.id as string;
  const [permList, setPermList] = useState<AgentPermission[]>([]);
  const [loading, setLoading] = useState(true);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantRole, setGrantRole] = useState<AgentRole>("viewer");
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await permissions.list(agentId, { limit: 100 });
      setPermList(res.data);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  async function handleGrant() {
    setGranting(true);
    try {
      await permissions.grant(agentId, { user_id: grantUserId, role: grantRole });
      setGrantOpen(false);
      setGrantUserId("");
      load();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(permId: string) {
    if (!confirm("Revoke this permission?")) return;
    await permissions.revoke(agentId, permId);
    setPermList((prev) => prev.filter((p) => p.id !== permId));
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Permissions</h2>
          <p className="text-muted-foreground text-sm">Manage who can access this agent</p>
        </div>
        <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="mr-2 h-4 w-4" /> Grant Access</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Grant Permission</DialogTitle>
              <DialogDescription>Add a user to this agent</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>User ID</Label>
                <Input value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} placeholder="user-uuid" />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={grantRole} onValueChange={(v) => setGrantRole(v as AgentRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGrantOpen(false)}>Cancel</Button>
              <Button onClick={handleGrant} disabled={!grantUserId.trim() || granting}>
                {granting ? "Granting..." : "Grant"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : permList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No permissions configured</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {permList.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-sm">{p.user_id.slice(0, 12)}...</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={roleColors[p.role]}>{p.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(p.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.expires_at ? format(new Date(p.expires_at), "MMM d, yyyy") : "Never"}
                  </TableCell>
                  <TableCell>
                    {p.role !== "owner" && (
                      <Button variant="ghost" size="icon" onClick={() => handleRevoke(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
