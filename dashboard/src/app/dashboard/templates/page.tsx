"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { templates } from "@/lib/api";
import type { AgentTemplate, TemplateCategory } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Globe, Lock } from "lucide-react";

const ALL_CATEGORIES: TemplateCategory[] = [
  "assistant", "coding", "data", "research", "customer_support", "automation", "creative", "custom",
];

const categoryColors: Record<TemplateCategory, string> = {
  assistant: "bg-blue-100 text-blue-700",
  coding: "bg-purple-100 text-purple-700",
  data: "bg-green-100 text-green-700",
  research: "bg-orange-100 text-orange-700",
  customer_support: "bg-pink-100 text-pink-700",
  automation: "bg-cyan-100 text-cyan-700",
  creative: "bg-yellow-100 text-yellow-700",
  custom: "bg-gray-100 text-gray-700",
};

export default function TemplatesPage() {
  const [templateList, setTemplateList] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 50 };
      if (categoryFilter !== "all") params.category = categoryFilter;
      const res = await templates.list(params);
      setTemplateList(res.data);
    } catch {
      // API unreachable (demo mode or backend down) -- render empty state.
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground">Reusable agent configurations</p>
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {ALL_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading templates...</p>
      ) : templateList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No templates found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templateList.map((t) => (
            <Link key={t.id} href={`/dashboard/templates/${t.id}`}>
              <Card className="hover:border-foreground/20 transition-colors cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base truncate">{t.name}</CardTitle>
                    {t.is_public ? (
                      <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </div>
                  <CardDescription className="line-clamp-2">
                    {t.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={categoryColors[t.category]}>
                      {t.category.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground capitalize">
                      {t.framework.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      v{t.current_version} | {t.use_count} uses
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
