"use client";

import { useState } from "react";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { TopBar } from "./top-bar";
import { Toaster } from "@/components/ui/toaster";

interface DashboardShellProps {
  role: "admin" | "supervisor";
  userName: string;
  children: React.ReactNode;
}

export function DashboardShell({ role, userName, children }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar role={role} />
      <MobileNav role={role} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar
          userName={userName}
          userRole={role}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
