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

export const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, adminOnly: false },
  { label: "Terminals", href: "/dashboard/terminals", icon: Building2, adminOnly: true },
  { label: "Departments", href: "/dashboard/departments", icon: Layers, adminOnly: true },
  { label: "Shifts", href: "/dashboard/shifts", icon: Clock, adminOnly: true },
  { label: "Workers", href: "/dashboard/workers", icon: Users, adminOnly: false },
  { label: "Roster", href: "/dashboard/roster", icon: CalendarDays, adminOnly: false },
  { label: "Attendance", href: "/dashboard/attendance", icon: ClipboardList, adminOnly: false },
  { label: "Reports", href: "/dashboard/reports", icon: BarChart3, adminOnly: false },
  { label: "Payroll", href: "/dashboard/payroll", icon: Banknote, adminOnly: false },
  { label: "Audit Log", href: "/dashboard/audit", icon: ScrollText, adminOnly: true },
  { label: "Users", href: "/dashboard/users", icon: UserCog, adminOnly: true },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, adminOnly: true },
];
