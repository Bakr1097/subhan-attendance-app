import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { terminals, departments, workers } from "@/db/schema";
import { eq, count } from "drizzle-orm";
import { Building2, Layers, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [terminalCount] = await db.select({ value: count() }).from(terminals);
  const [deptCount] = await db.select({ value: count() }).from(departments);
  const [workerCount] = await db
    .select({ value: count() })
    .from(workers)
    .where(eq(workers.status, "active"));

  const stats = [
    {
      label: "Terminals",
      value: terminalCount.value,
      icon: Building2,
      href: "/dashboard/terminals",
    },
    {
      label: "Departments",
      value: deptCount.value,
      icon: Layers,
      href: "/dashboard/departments",
    },
    {
      label: "Active Workers",
      value: workerCount.value,
      icon: Users,
      href: "/dashboard/workers",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back, {session.user.name}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
