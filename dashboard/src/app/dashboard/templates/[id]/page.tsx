"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { templates, templateVersions } from "@/lib/api";
import type { AgentTemplate, TemplateVersion } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Rocket, Globe, Lock, History } from "lucide-react";
import { format } from "date-fns";

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<AgentTemplate | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [loading, setLoading] = useState(true);

  // Instantiate dialog.
  const [instantiateOpen, setInstantiateOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [instantiating, setInstantiating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, v] = await Promise.all([
        templates.get(templateId),
        templateVersions.list(templateId, { limit: 20 }),
      ]);
      setTemplate(t);
      setVersions(v.data);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  async function handleInstantiate() {
    setInstantiating(true);
    try {
      const agent = await templates.instantiate(templateId, { name: agentName });
      setInstantiateOpen(false);
      router.push(`/dashboard/agents/${agent.id}`);
    } finally {
      setInstantiating(false);
    }
  }

  if (loading) {
    return <div className="p-6"><p className="text-muted-foreground">Loading template...</p></div>;
  }

  if (!template) {
    return <div className="p-6"><p className="text-destructive">Template not found</p></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/templates">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{template.name}</h1>
            {template.is_public ? (
              <Badge variant="outline"><Globe className="mr-1 h-3 w-3" /> Public</Badge>
            ) : (
              <Badge variant="outline"><Lock className="mr-1 h-3 w-3" /> Private</Badge>
            )}
          </div>
          <p className="text-muted-foreground">{template.description || "No description"}</p>
        </div>
        <Dialog open={instantiateOpen} onOpenChange={setInstantiateOpen}>
          <DialogTrigger asChild>
            <Button><Rocket className="mr-2 h-4 w-4" /> Create Agent</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Agent from Template</DialogTitle>
              <DialogDescription>Instantiate &quot;{template.name}&quot; as a new agent</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Agent Name</Label>
                <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="My New Agent" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInstantiateOpen(false)}>Cancel</Button>
              <Button onClick={handleInstantiate} disabled={!agentName.trim() || instantiating}>
                {instantiating ? "Creating..." : "Create Agent"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Template Info */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Category</dt>
                <dd className="capitalize">{template.category.replace(/_/g, " ")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Framework</dt>
                <dd className="capitalize">{template.framework.replace(/_/g, " ")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Current Version</dt>
                <dd>v{template.current_version}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Usage Count</dt>
                <dd>{template.use_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={template.is_active ? "default" : "secondary"}>
                    {template.is_active ? "Active" : "Inactive"}
                  </Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Prompt</CardTitle>
          </CardHeader>
          <CardContent>
            {template.system_prompt ? (
              <pre className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-md max-h-[200px] overflow-auto">
                {template.system_prompt}
              </pre>
            ) : (
              <p className="text-muted-foreground text-sm">No system prompt configured</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Model Config */}
      {Object.keys(template.model_config).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model Config</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-muted p-3 rounded-md overflow-auto max-h-[200px]">
              {JSON.stringify(template.model_config, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Version History */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <History className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-bold">Version History</h2>
        </div>
        {versions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No versions published yet
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Framework</TableHead>
                  <TableHead>Changelog</TableHead>
                  <TableHead>Published</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">v{v.version_number}</TableCell>
                    <TableCell className="capitalize text-sm">{v.framework.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-sm max-w-[300px] truncate">
                      {v.changelog || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(v.created_at), "MMM d, yyyy HH:mm")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Tags */}
      {template.default_tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default Tags</CardTitle>
            <CardDescription>Applied to agents created from this template</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {template.default_tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
