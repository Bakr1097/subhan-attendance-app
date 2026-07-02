import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Without this, Next.js's fetch cache silently caches the Neon HTTP driver's
// underlying fetch() calls (it's a fetch under the hood) — indefinitely, for
// any query whose SQL text+params happen to repeat, which is any query that
// doesn't vary by date/id per request. Found via Step 19 kiosk testing: the
// worker list query (filtered only by terminal+status) served the exact same
// stale snapshot across dev server restarts because .next/cache/fetch-cache
// persists to disk. This affects the live production app the same way.
const sql = neon(process.env.DATABASE_URL, {
  fetchOptions: { cache: "no-store" },
});
export const db = drizzle(sql);

export async function pingDb(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
