"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sessions } from "@/lib/api";
import type { Session, Message, MessageRole } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Send, Bot, User, Wrench, Globe, Monitor } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const roleConfig: Record<MessageRole, { label: string; icon: React.ElementType; align: "left" | "right" }> = {
  system: { label: "System", icon: Monitor, align: "left" },
  user: { label: "User", icon: User, align: "right" },
  assistant: { label: "Assistant", icon: Bot, align: "left" },
  tool: { label: "Tool", icon: Wrench, align: "left" },
  a2a: { label: "A2A", icon: Globe, align: "left" },
};

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [messageList, setMessageList] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, msgs] = await Promise.all([
        sessions.get(sessionId),
        sessions.listMessages(sessionId, { limit: 100 }),
      ]);
      setSession(s);
      setMessageList(msgs.data);
    } catch {
      // API unreachable (demo mode or backend down) -- render empty state.
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messageList]);

  async function handleSend() {
    if (!newMessage.trim()) return;
    setSending(true);
    try {
      const msg = await sessions.createMessage(sessionId, {
        role: "user",
        content: newMessage.trim(),
      });
      setMessageList((prev) => [...prev, msg]);
      setNewMessage("");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return <div className="p-6"><p className="text-muted-foreground">Loading session...</p></div>;
  }

  if (!session) {
    return <div className="p-6"><p className="text-destructive">Session not found</p></div>;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 border-b px-6 py-4">
        <Link href="/dashboard/sessions">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold truncate">{session.title || `Session ${session.id.slice(0, 8)}`}</h1>
            <Badge variant="outline">{session.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Agent: {session.agent_id.slice(0, 8)}... | {session.turn_count} turns | {session.total_tokens.toLocaleString()} tokens
          </p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6" ref={scrollRef}>
        <div className="space-y-4 py-4 max-w-3xl mx-auto">
          {messageList.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No messages yet</p>
          ) : (
            messageList.map((msg) => {
              const config = roleConfig[msg.role];
              const Icon = config.icon;
              const isUser = config.align === "right";
              return (
                <div key={msg.id} className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : ""}`}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">{config.label}</span>
                      {msg.model && <span>({msg.model})</span>}
                      <span>{formatDistanceToNow(new Date(msg.created_at), { addSuffix: true })}</span>
                    </div>
                    <Card className={isUser ? "bg-primary text-primary-foreground" : ""}>
                      <CardContent className="p-3">
                        <p className="text-sm whitespace-pre-wrap">{msg.content || "(empty)"}</p>
                        {msg.tool_calls && msg.tool_calls.length > 0 && (
                          <>
                            <Separator className="my-2" />
                            <p className="text-xs text-muted-foreground">
                              {msg.tool_calls.length} tool call(s)
                            </p>
                          </>
                        )}
                      </CardContent>
                    </Card>
                    {(msg.prompt_tokens > 0 || msg.completion_tokens > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {msg.prompt_tokens} prompt + {msg.completion_tokens} completion tokens
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      {(session.status === "active" || session.status === "idle") && (
        <div className="border-t px-6 py-4">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <Textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="resize-none"
            />
            <Button onClick={handleSend} disabled={sending || !newMessage.trim()} size="icon" className="shrink-0 h-auto">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Session Info */}
      <div className="border-t px-6 py-3">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Session Details</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <dl className="grid gap-1 text-xs md:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="font-mono truncate">{session.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{new Date(session.created_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{new Date(session.updated_at).toLocaleString()}</dd>
              </div>
              {session.ended_at && (
                <div>
                  <dt className="text-muted-foreground">Ended</dt>
                  <dd>{new Date(session.ended_at).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
