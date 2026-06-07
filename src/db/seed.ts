import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users, terminals, departments } from "./schema";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set in .env.local");

  const sql = neon(url);
  const db = drizzle(sql);

  // --- Admin user ---
  const adminEmail = "admin@subhan.com";
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  if (existing.length === 0) {
    const passwordHash = await hash("Admin@1234", 12);
    await db.insert(users).values({
      name: "Admin",
      email: adminEmail,
      passwordHash,
      role: "admin",
    });
    console.log("✓ Admin user created  (admin@subhan.com / Admin@1234)");
  } else {
    console.log("  Admin user already exists — skipped");
  }

  // --- Home terminal ---
  const terminalName = "Subhan Bus Terminal";
  const existingTerminal = await db
    .select()
    .from(terminals)
    .where(eq(terminals.name, terminalName))
    .limit(1);

  let terminalId: string;

  if (existingTerminal.length === 0) {
    const [newTerminal] = await db
      .insert(terminals)
      .values({ name: terminalName })
      .returning({ id: terminals.id });
    terminalId = newTerminal.id;
    console.log(`✓ Terminal created: ${terminalName}`);
  } else {
    terminalId = existingTerminal[0].id;
    console.log(`  Terminal already exists — skipped`);
  }

  // --- Starter departments ---
  const starterDepts = [
    "Ticketing",
    "Loading & Unloading",
    "Security",
    "Administration",
    "Maintenance",
  ];

  const existingDepts = await db
    .select()
    .from(departments)
    .where(eq(departments.terminalId, terminalId));

  const existingNames = new Set(existingDepts.map((d) => d.name));

  for (const name of starterDepts) {
    if (!existingNames.has(name)) {
      await db.insert(departments).values({ terminalId, name });
      console.log(`✓ Department created: ${name}`);
    } else {
      console.log(`  Department already exists: ${name} — skipped`);
    }
  }

  console.log("\nSeed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
