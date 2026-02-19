"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { memory } from "@/lib/api";
import type { AgentMemory, MemoryType } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Brain, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ALL_TYPES: MemoryType[] = ["episodic", "semantic", "procedural", "reflection"];

const typeColors: Record<MemoryType, string> = {
  episodic: "bg-blue-100 text-blue-700",
  semantic: "bg-green-100 text-green-700",
  procedural: "bg-purple-100 text-purple-700",
  reflection: "bg-orange-100 text-orange-700",
};

export default function MemoryPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selected, setSelected] = useState<AgentMemory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p: Record<string, string | number> = { limit: 50 };
      if (typeFilter !== "all") p.memory_type = typeFilter;
      const res = await memory.list(agentId, p);
      setMemories(res.data);
    } finally {
      setLoading(false);
    }
  }, [agentId, typeFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(memoryId: string) {
    if (!confirm("Delete this memory?")) return;
    await memory.delete(agentId, memoryId);
    setMemories((prev) => prev.filter((m) => m.id !== memoryId));
    if (selected?.id === memoryId) setSelected(null);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Memory</h2>
          <p className="text-muted-foreground text-sm">Agent long-term memory store</p>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ALL_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : memories.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Brain className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No memories stored</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Importance</TableHead>
                <TableHead>Accessed</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {memories.map((m) => (
                <TableRow
                  key={m.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(m)}
                >
                  <TableCell>
                    <Badge variant="outline" className={typeColors[m.memory_type]}>{m.memory_type}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-sm">{m.content}</TableCell>
                  <TableCell className="text-sm">{m.importance.toFixed(1)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.access_count}x
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail Drawer */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="w-[500px] sm:max-w-[500px]">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>Memory Detail</SheetTitle>
                <SheetDescription>
                  <Badge variant="outline" className={typeColors[selected.memory_type]}>{selected.memory_type}</Badge>
                  {" "}Importance: {selected.importance.toFixed(1)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Content</p>
                  <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded-md">{selected.content}</p>
                </div>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-muted-foreground">ID</dt>
                    <dd className="font-mono text-xs">{selected.id}</dd>
                  </div>
                  {selected.session_id && (
                    <div>
                      <dt className="text-muted-foreground">Session</dt>
                      <dd className="font-mono text-xs">{selected.session_id}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-muted-foreground">Access Count</dt>
                    <dd>{selected.access_count}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{new Date(selected.created_at).toLocaleString()}</dd>
                  </div>
                  {selected.last_accessed_at && (
                    <div>
                      <dt className="text-muted-foreground">Last Accessed</dt>
                      <dd>{new Date(selected.last_accessed_at).toLocaleString()}</dd>
                    </div>
                  )}
                </dl>
                {Object.keys(selected.metadata).length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Metadata</p>
                    <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[200px]">
                      {JSON.stringify(selected.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
