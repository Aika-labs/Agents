"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { agents } from "@/lib/api";
import type { Agent, AgentStatus, AgentFramework } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Bot, Zap, Pause, AlertTriangle, Archive, FileEdit, Square } from "lucide-react";

// -- Helpers ------------------------------------------------------------------

const statusIcons: Record<AgentStatus, React.ElementType> = {
  draft: FileEdit, running: Zap, paused: Pause, stopped: Square,
  error: AlertTriangle, archived: Archive,
};

const statusColors: Record<AgentStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  running: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  stopped: "bg-gray-100 text-gray-700",
  error: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-500",
};

const ALL_STATUSES: AgentStatus[] = ["draft", "running", "paused", "stopped", "error", "archived"];
const ALL_FRAMEWORKS: AgentFramework[] = ["google_adk", "langgraph", "crewai", "autogen", "openai_sdk", "custom"];

// -- Component ----------------------------------------------------------------

export default function AgentsPage() {
  const router = useRouter();
  const [agentList, setAgentList] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [frameworkFilter, setFrameworkFilter] = useState<string>("all");

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createFramework, setCreateFramework] = useState<AgentFramework>("google_adk");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number | boolean> = { limit: 100 };
      if (statusFilter !== "all") params.status = statusFilter;
      if (frameworkFilter !== "all") params.framework = frameworkFilter;
      const res = await agents.list(params);
      setAgentList(res.data);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, frameworkFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    setCreating(true);
    try {
      const agent = await agents.create({
        name: createName,
        description: createDesc || undefined,
        framework: createFramework,
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateDesc("");
      router.push(`/dashboard/agents/${agent.id}`);
    } finally {
      setCreating(false);
    }
  }

  // Client-side name search.
  const filtered = agentList.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-muted-foreground">Manage your AI agents</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> New Agent</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Agent</DialogTitle>
              <DialogDescription>Configure a new AI agent</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="My Agent" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea id="desc" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="What does this agent do?" rows={3} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="framework">Framework</Label>
                <Select value={createFramework} onValueChange={(v) => setCreateFramework(v as AgentFramework)}>
                  <SelectTrigger id="framework"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_FRAMEWORKS.map((f) => (
                      <SelectItem key={f} value={f}>{f.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!createName.trim() || creating}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={frameworkFilter} onValueChange={setFrameworkFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Framework" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All frameworks</SelectItem>
            {ALL_FRAMEWORKS.map((f) => (
              <SelectItem key={f} value={f}>{f.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agent Grid */}
      {loading ? (
        <p className="text-muted-foreground">Loading agents...</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No agents found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((agent) => {
            const StatusIcon = statusIcons[agent.status];
            return (
              <Link key={agent.id} href={`/dashboard/agents/${agent.id}`}>
                <Card className="hover:border-foreground/20 transition-colors cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base truncate">{agent.name}</CardTitle>
                      <Badge variant="outline" className={statusColors[agent.status]}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {agent.status}
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {agent.description || "No description"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="capitalize">{agent.framework.replace(/_/g, " ")}</span>
                      <span>v{agent.version}</span>
                      {agent.tags.length > 0 && (
                        <span className="truncate">{agent.tags.slice(0, 3).join(", ")}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
