"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const agentTabs = [
  { href: "", label: "Overview" },
  { href: "/permissions", label: "Permissions" },
  { href: "/approvals", label: "HITL" },
  { href: "/evals", label: "Evals" },
  { href: "/pipelines", label: "Pipelines" },
  { href: "/deployments", label: "Deployments" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/memory", label: "Memory" },
];

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const base = `/dashboard/agents/${params.id as string}`;

  return (
    <div className="flex h-full flex-col">
      {/* Sub-navigation */}
      <div className="border-b px-6">
        <nav className="flex gap-4 overflow-x-auto">
          {agentTabs.map((tab) => {
            const href = `${base}${tab.href}`;
            const isActive = tab.href === ""
              ? pathname === base
              : pathname.startsWith(href);
            return (
              <Link
                key={tab.href}
                href={href}
                className={cn(
                  "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
