import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sessions, turns } from "../src/lib/db/schema";
import { isNull, sql, eq } from "drizzle-orm";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function main() {
  // 1. Count total sessions
  const total = await db.select({ count: sql<number>`count(*)` }).from(sessions);
  
  // 2. Count missing titles
  const missing = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(isNull(sessions.title));

  console.log(`Total Sessions: ${total[0].count}`);
  console.log(`Missing Titles: ${missing[0].count}`);

  // 3. Sample a few missing ones
  const samples = await db
    .select()
    .from(sessions)
    .where(isNull(sessions.title))
    .limit(5);

  console.log("\nSample Missing Titles:");
  samples.forEach(s => console.log(` - ${s.sessionId} (Project: ${s.projectDir})`));

  await client.end();
  process.exit(0);
}

main().catch(console.error);
