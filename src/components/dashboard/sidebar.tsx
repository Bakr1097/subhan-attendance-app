"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

interface SidebarProps {
  role: "admin" | "supervisor";
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname();

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");

  return (
    <aside className="hidden md:flex flex-col w-60 min-h-screen bg-slate-900 text-slate-100 shrink-0">
      <div className="px-6 py-5 border-b border-slate-700">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Subhan Terminal
        </p>
        <p className="text-lg font-bold text-white leading-tight">
          Attendance
        </p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {items.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-slate-700">
        <p className="text-xs text-slate-500 capitalize">{role}</p>
      </div>
    </aside>
  );
}
