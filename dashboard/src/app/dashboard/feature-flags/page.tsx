"use client";

import { useEffect, useState, useCallback } from "react";
import { featureFlags } from "@/lib/api";
import type { FeatureFlag, FlagScope } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Plus, Flag, Trash2, FlaskConical } from "lucide-react";
import { format } from "date-fns";

const ALL_SCOPES: FlagScope[] = ["platform", "agent", "user"];

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createScope, setCreateScope] = useState<FlagScope>("platform");
  const [createRollout, setCreateRollout] = useState("100");
  const [creating, setCreating] = useState(false);

  // Evaluate panel.
  const [evalOpen, setEvalOpen] = useState(false);
  const [evalKey, setEvalKey] = useState("");
  const [evalResult, setEvalResult] = useState<{ enabled: boolean; reason: string } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await featureFlags.list({ limit: 100 });
      setFlags(res.data);
    } catch {
      // API unreachable (demo mode or backend down) -- render empty state.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleToggle(flag: FeatureFlag) {
    const updated = await featureFlags.update(flag.id, { enabled: !flag.enabled });
    setFlags((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  async function handleCreate() {
    setCreating(true);
    try {
      await featureFlags.create({
        key: createKey,
        name: createName,
        description: createDesc || undefined,
        scope: createScope,
        rollout_pct: Number(createRollout),
      });
      setCreateOpen(false);
      setCreateKey("");
      setCreateName("");
      setCreateDesc("");
      setCreateRollout("100");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this feature flag?")) return;
    await featureFlags.delete(id);
    setFlags((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleEvaluate() {
    setEvaluating(true);
    setEvalResult(null);
    try {
      const res = await featureFlags.evaluate({ key: evalKey });
      setEvalResult(res);
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="text-muted-foreground">Control feature rollouts and experiments</p>
        </div>
        <div className="flex gap-2">
          {/* Evaluate Dialog */}
          <Dialog open={evalOpen} onOpenChange={setEvalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><FlaskConical className="mr-2 h-4 w-4" /> Evaluate</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Evaluate Flag</DialogTitle>
                <DialogDescription>Test if a flag key resolves to enabled or disabled</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="eval-key">Flag Key</Label>
                  <Input id="eval-key" value={evalKey} onChange={(e) => setEvalKey(e.target.value)} placeholder="my-feature" />
                </div>
                {evalResult && (
                  <Card>
                    <CardContent className="py-3">
                      <div className="flex items-center gap-3">
                        <Badge variant={evalResult.enabled ? "default" : "secondary"}>
                          {evalResult.enabled ? "ENABLED" : "DISABLED"}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{evalResult.reason}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleEvaluate} disabled={!evalKey.trim() || evaluating}>
                  {evaluating ? "Evaluating..." : "Evaluate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Create Dialog */}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> New Flag</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Feature Flag</DialogTitle>
                <DialogDescription>Define a new feature flag</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="flag-key">Key</Label>
                    <Input id="flag-key" value={createKey} onChange={(e) => setCreateKey(e.target.value)} placeholder="my-feature" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="flag-name">Name</Label>
                    <Input id="flag-name" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="My Feature" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="flag-desc">Description</Label>
                  <Textarea id="flag-desc" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} rows={2} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Scope</Label>
                    <Select value={createScope} onValueChange={(v) => setCreateScope(v as FlagScope)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALL_SCOPES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="flag-rollout">Rollout %</Label>
                    <Input id="flag-rollout" type="number" min={0} max={100} value={createRollout} onChange={(e) => setCreateRollout(e.target.value)} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!createKey.trim() || !createName.trim() || creating}>
                  {creating ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Flags Table */}
      {loading ? (
        <p className="text-muted-foreground">Loading flags...</p>
      ) : flags.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Flag className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No feature flags yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enabled</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Rollout</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((flag) => (
                <TableRow key={flag.id}>
                  <TableCell>
                    <Switch checked={flag.enabled} onCheckedChange={() => handleToggle(flag)} />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{flag.key}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium">{flag.name}</p>
                      {flag.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{flag.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{flag.scope}</Badge>
                  </TableCell>
                  <TableCell>{flag.rollout_pct}%</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {flag.starts_at || flag.expires_at ? (
                      <div>
                        {flag.starts_at && <div>From: {format(new Date(flag.starts_at), "MMM d, HH:mm")}</div>}
                        {flag.expires_at && <div>Until: {format(new Date(flag.expires_at), "MMM d, HH:mm")}</div>}
                      </div>
                    ) : (
                      "Always"
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(flag.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
