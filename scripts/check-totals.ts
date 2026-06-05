import { drizzle } from "drizzle-orm/postgres-js";
import { dailySummary } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";
import { createWorkerClient } from "../src/lib/server/postgres-client";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const client = createWorkerClient(DATABASE_URL);
const db = drizzle(client);

async function main() {
  const result = await db
    .select({
      totalInput: sql<number>`sum(${dailySummary.tokensInput})`,
      totalOutput: sql<number>`sum(${dailySummary.tokensOutput})`,
      totalCacheRead: sql<number>`sum(${dailySummary.tokensCacheRead})`,
      totalCacheWrite: sql<number>`sum(${dailySummary.tokensCacheWrite})`,
    })
    .from(dailySummary);

  const totals = result[0];
  console.log("DB Totals (OpenCode + Claude):");
  console.log(`Input: ${Number(totals.totalInput).toLocaleString()}`);
  console.log(`Output: ${Number(totals.totalOutput).toLocaleString()}`);
  console.log(`Cache Read: ${Number(totals.totalCacheRead).toLocaleString()}`);
  console.log(`Cache Write: ${Number(totals.totalCacheWrite).toLocaleString()}`);
  
  const grandTotal = Number(totals.totalInput) + Number(totals.totalCacheRead);
  console.log(`Grand Total (Input + Cache): ${grandTotal.toLocaleString()}`);

  await client.end();
  process.exit(0);
}

main().catch(console.error);
