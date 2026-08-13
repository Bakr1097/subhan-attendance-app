import {
  LayoutDashboard,
  Building2,
  Layers,
  Clock,
  Users,
  UserCog,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Banknote,
  ScrollText,
  Settings,
} from "lucide-react";
import type { Role } from "@/lib/roles";

const ALL: Role[] = ["admin", "supervisor", "viewer"];
const ADMIN_ONLY: Role[] = ["admin"];
const NOT_VIEWER: Role[] = ["admin", "supervisor"];

// `roles` lists exactly who can see this link. Viewer is read-only, so it's
// left off anything that lets you write (Workers, Roster, Payroll) and
// anything admin-only (Terminals/Departments/Shifts/Audit/Users/Settings).
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ALL },
  { label: "Terminals", href: "/dashboard/terminals", icon: Building2, roles: ADMIN_ONLY },
  { label: "Departments", href: "/dashboard/departments", icon: Layers, roles: ADMIN_ONLY },
  { label: "Shifts", href: "/dashboard/shifts", icon: Clock, roles: ADMIN_ONLY },
  { label: "Workers", href: "/dashboard/workers", icon: Users, roles: NOT_VIEWER },
  { label: "Roster", href: "/dashboard/roster", icon: CalendarDays, roles: NOT_VIEWER },
  { label: "Attendance", href: "/dashboard/attendance", icon: ClipboardList, roles: ALL },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3, roles: ALL },
  { label: "Payroll", href: "/dashboard/payroll", icon: Banknote, roles: NOT_VIEWER },
  { label: "Audit Log", href: "/dashboard/audit", icon: ScrollText, roles: ADMIN_ONLY },
  { label: "Users", href: "/dashboard/users", icon: UserCog, roles: ADMIN_ONLY },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, roles: ADMIN_ONLY },
];
