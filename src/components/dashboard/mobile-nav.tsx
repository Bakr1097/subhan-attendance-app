"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";

interface MobileNavProps {
  role: "admin" | "supervisor";
  open: boolean;
  onClose: () => void;
}

// Slide-out drawer shown below md, standing in for the desktop Sidebar
// (which is `hidden` below md) so the fixed 240px column never squeezes
// page content on a phone.
export function MobileNav({ role, open, onClose }: MobileNavProps) {
  const pathname = usePathname();

  if (!open) return null;

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");

  return (
    <div className="md:hidden fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="absolute left-0 top-0 h-full w-64 max-w-[80vw] flex flex-col bg-slate-900 text-slate-100 shadow-xl">
        <div className="px-6 py-5 border-b border-slate-700 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
              Subhan Terminal
            </p>
            <p className="text-lg font-bold text-white leading-tight">
              Attendance
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {items.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
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
    </div>
  );
}
