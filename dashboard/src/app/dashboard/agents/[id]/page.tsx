"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { agents } from "@/lib/api";
import type { Agent, AgentStatus, AgentFramework } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Pause, Square, AlertTriangle, Archive, FileEdit,
  Play, Skull, Save, RotateCcw,
} from "lucide-react";

// -- Status FSM ---------------------------------------------------------------

const VALID_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  draft: ["running", "archived"],
  running: ["paused", "stopped", "error"],
  paused: ["running", "stopped", "archived"],
  stopped: ["running", "archived"],
  error: ["running", "stopped", "archived"],
  archived: [],
};

const statusColors: Record<AgentStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  running: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  stopped: "bg-gray-100 text-gray-700",
  error: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-500",
};

const transitionIcons: Record<string, React.ElementType> = {
  running: Play,
  paused: Pause,
  stopped: Square,
  error: AlertTriangle,
  archived: Archive,
};

const ALL_FRAMEWORKS: AgentFramework[] = ["google_adk", "langgraph", "crewai", "autogen", "openai_sdk", "custom"];

// -- Component ----------------------------------------------------------------

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  // Edit form state.
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editFramework, setEditFramework] = useState<AgentFramework>("google_adk");
  const [editSystemPrompt, setEditSystemPrompt] = useState("");
  const [editTags, setEditTags] = useState("");

  // Model config editor.
  const [modelConfigJson, setModelConfigJson] = useState("");
  const [modelConfigError, setModelConfigError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await agents.get(agentId);
      setAgent(a);
      setEditName(a.name);
      setEditDesc(a.description ?? "");
      setEditFramework(a.framework);
      setEditSystemPrompt(a.system_prompt ?? "");
      setEditTags(a.tags.join(", "));
      setModelConfigJson(JSON.stringify(a.model_config, null, 2));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!agent) return;
    setSaving(true);
    try {
      const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
      const updated = await agents.update(agentId, {
        name: editName,
        description: editDesc || null,
        framework: editFramework,
        system_prompt: editSystemPrompt || null,
        tags,
      });
      setAgent(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleTransition(newStatus: AgentStatus) {
    if (!agent) return;
    setTransitioning(true);
    try {
      const updated = await agents.update(agentId, { status: newStatus });
      setAgent(updated);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleKill() {
    if (!agent) return;
    if (!confirm("Emergency kill this agent? This will immediately stop it.")) return;
    setTransitioning(true);
    try {
      const res = await agents.kill(agentId);
      setAgent(res.agent);
    } finally {
      setTransitioning(false);
    }
  }

  async function handleDelete() {
    if (!agent) return;
    if (!confirm(`Delete agent "${agent.name}"? This is a soft delete.`)) return;
    await agents.delete(agentId);
    router.push("/dashboard/agents");
  }

  async function handleSaveModelConfig() {
    setModelConfigError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(modelConfigJson) as Record<string, unknown>;
    } catch {
      setModelConfigError("Invalid JSON");
      return;
    }
    setSavingConfig(true);
    try {
      const res = await agents.updateModelConfig(agentId, parsed);
      setModelConfigJson(JSON.stringify(res.model_config, null, 2));
      if (agent) {
        setAgent({ ...agent, model_config: res.model_config, version: res.version });
      }
    } finally {
      setSavingConfig(false);
    }
  }

  if (loading) {
    return <div className="p-6"><p className="text-muted-foreground">Loading agent...</p></div>;
  }

  if (!agent) {
    return <div className="p-6"><p className="text-destructive">Agent not found</p></div>;
  }

  const transitions = VALID_TRANSITIONS[agent.status];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/agents">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
            <Badge variant="outline" className={statusColors[agent.status]}>
              {agent.status}
            </Badge>
            <span className="text-sm text-muted-foreground">v{agent.version}</span>
          </div>
          <p className="text-muted-foreground">{agent.description || "No description"}</p>
        </div>
      </div>

      {/* Status Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Management</CardTitle>
          <CardDescription>Transition agent state or perform emergency actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {transitions.map((target) => {
              const Icon = transitionIcons[target] ?? FileEdit;
              return (
                <Button
                  key={target}
                  variant="outline"
                  size="sm"
                  disabled={transitioning}
                  onClick={() => handleTransition(target)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {target.charAt(0).toUpperCase() + target.slice(1)}
                </Button>
              );
            })}
            {(agent.status === "running" || agent.status === "paused") && (
              <Button
                variant="destructive"
                size="sm"
                disabled={transitioning}
                onClick={handleKill}
              >
                <Skull className="mr-2 h-4 w-4" />
                Emergency Kill
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Details / Model Config */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="model-config">Model Config</TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-framework">Framework</Label>
                  <Select value={editFramework} onValueChange={(v) => setEditFramework(v as AgentFramework)}>
                    <SelectTrigger id="edit-framework"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ALL_FRAMEWORKS.map((f) => (
                        <SelectItem key={f} value={f}>{f.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea id="edit-desc" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-prompt">System Prompt</Label>
                <Textarea id="edit-prompt" value={editSystemPrompt} onChange={(e) => setEditSystemPrompt(e.target.value)} rows={6} className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
                <Input id="edit-tags" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="tag1, tag2" />
              </div>
              <Separator />
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
                <Button variant="outline" onClick={load}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset
                </Button>
                <Button variant="destructive" onClick={handleDelete} className="ml-auto">
                  Delete Agent
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">ID</dt>
                  <dd className="font-mono">{agent.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd className="font-mono">{agent.owner_id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{new Date(agent.created_at).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd>{new Date(agent.updated_at).toLocaleString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Model Config Tab */}
        <TabsContent value="model-config" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model Configuration</CardTitle>
              <CardDescription>Hot-swap model config without restarting the agent</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={modelConfigJson}
                onChange={(e) => { setModelConfigJson(e.target.value); setModelConfigError(null); }}
                rows={16}
                className="font-mono text-sm"
                placeholder='{ "model": "gpt-4o", "temperature": 0.7 }'
              />
              {modelConfigError && (
                <p className="text-sm text-destructive">{modelConfigError}</p>
              )}
              <Button onClick={handleSaveModelConfig} disabled={savingConfig}>
                <Save className="mr-2 h-4 w-4" />
                {savingConfig ? "Saving..." : "Save Model Config"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
