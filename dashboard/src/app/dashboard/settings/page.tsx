"use client";

import { useAuth } from "@/components/auth-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, Key, Shield } from "lucide-react";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Account and platform configuration</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <User className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Profile</CardTitle>
              <CardDescription>Your account information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">User ID</dt>
              <dd className="font-mono text-xs">{user?.id ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{user?.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Last Sign In</dt>
              <dd>{user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email Confirmed</dt>
              <dd>
                <Badge variant={user?.email_confirmed_at ? "default" : "secondary"}>
                  {user?.email_confirmed_at ? "Confirmed" : "Pending"}
                </Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Separator />

      {/* API Keys */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">API Keys</CardTitle>
              <CardDescription>
                Manage API keys for programmatic access. Keys are created via the control plane API.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            API keys provide X-API-Key authentication for the control plane. Keys are SHA-256 hashed
            and stored securely. Use the API to create, list, and revoke keys.
          </p>
          <div className="mt-4 rounded-md bg-muted p-4">
            <p className="text-sm font-mono">
              curl -X POST {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/api-keys \<br />
              &nbsp;&nbsp;-H &quot;Authorization: Bearer $TOKEN&quot; \<br />
              &nbsp;&nbsp;-H &quot;Content-Type: application/json&quot; \<br />
              &nbsp;&nbsp;-d &apos;{`{"label": "my-key", "scopes": ["agents:read", "agents:write"]}`}&apos;
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Security */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">Security</CardTitle>
              <CardDescription>Authentication and access control</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Auth Provider</dt>
              <dd>Supabase (JWT)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">MFA</dt>
              <dd>
                <Badge variant="secondary">Not configured</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
