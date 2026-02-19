"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { webhooks, webhookDeliveries } from "@/lib/api";
import type { Webhook, WebhookDelivery } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Webhook as WebhookIcon, Send, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const deliveryStatusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  retrying: "bg-yellow-100 text-yellow-700",
};

export default function WebhooksPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [webhookList, setWebhookList] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);

  // Delivery log drawer.
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await webhooks.list(agentId, { limit: 50 });
      setWebhookList(res.data);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(wh: Webhook) {
    const updated = await webhooks.update(agentId, wh.id, { is_active: !wh.is_active });
    setWebhookList((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }

  async function handleTest(webhookId: string) {
    setTesting(webhookId);
    try {
      await webhooks.test(agentId, webhookId);
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete(webhookId: string) {
    if (!confirm("Delete this webhook?")) return;
    await webhooks.delete(agentId, webhookId);
    setWebhookList((prev) => prev.filter((w) => w.id !== webhookId));
  }

  async function openDeliveries(wh: Webhook) {
    setSelectedWebhook(wh);
    setLoadingDeliveries(true);
    try {
      const res = await webhookDeliveries.list(agentId, wh.id, { limit: 20 });
      setDeliveries(res.data);
    } finally {
      setLoadingDeliveries(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold">Webhooks</h2>
        <p className="text-muted-foreground text-sm">Event subscriptions and delivery logs</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : webhookList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <WebhookIcon className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No webhooks configured</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {webhookList.map((wh) => (
            <Card key={wh.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{wh.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{wh.url}</CardDescription>
                  </div>
                  <Switch checked={wh.is_active} onCheckedChange={() => handleToggle(wh)} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1 mb-3">
                  {wh.events.map((e) => (
                    <Badge key={e} variant="outline" className="text-xs">{e}</Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {wh.total_deliveries} deliveries ({wh.failed_deliveries} failed)
                    {wh.last_delivered_at && (
                      <span className="ml-2">
                        | Last: {formatDistanceToNow(new Date(wh.last_delivered_at), { addSuffix: true })}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openDeliveries(wh)}>
                      Deliveries
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={testing === wh.id}
                      onClick={() => handleTest(wh.id)}
                    >
                      <Send className="mr-1 h-3 w-3" />
                      {testing === wh.id ? "Sending..." : "Test"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(wh.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Delivery Log Drawer */}
      <Sheet open={!!selectedWebhook} onOpenChange={(open) => { if (!open) setSelectedWebhook(null); }}>
        <SheetContent className="w-[600px] sm:max-w-[600px]">
          {selectedWebhook && (
            <>
              <SheetHeader>
                <SheetTitle>Deliveries: {selectedWebhook.name}</SheetTitle>
                <SheetDescription className="font-mono text-xs">{selectedWebhook.url}</SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                {loadingDeliveries ? (
                  <p className="text-muted-foreground">Loading...</p>
                ) : deliveries.length === 0 ? (
                  <p className="text-muted-foreground">No deliveries yet</p>
                ) : (
                  <div className="space-y-3">
                    {deliveries.map((d) => (
                      <Card key={d.id}>
                        <CardContent className="py-3">
                          <div className="flex items-center gap-3 text-sm">
                            <Badge variant="outline" className={deliveryStatusColors[d.status] ?? ""}>
                              {d.status}
                            </Badge>
                            <Badge variant="outline">{d.event}</Badge>
                            {d.response_status && (
                              <span className="font-mono">{d.response_status}</span>
                            )}
                            {d.response_time_ms && (
                              <span className="text-muted-foreground">{d.response_time_ms}ms</span>
                            )}
                            <span className="text-muted-foreground ml-auto">
                              Attempt {d.attempt_number}/{d.max_attempts}
                            </span>
                          </div>
                          {d.error_message && (
                            <p className="text-xs text-destructive mt-1">{d.error_message}</p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
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
