import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requests } from "../src/lib/db/schema";
import { sql, eq } from "drizzle-orm";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function main() {
  const result = await db
    .select({
      agent: requests.agent,
      cost: sql<number>`sum(${requests.costUsd})`,
      tokens: sql<number>`sum(${requests.tokensInput}) + sum(${requests.tokensOutput}) + sum(${requests.tokensCacheRead})`,
      reqs: sql<number>`count(*)`,
    })
    .from(requests)
    .groupBy(requests.agent);

  console.log("Breakdown by Agent:");
  console.table(result.map(r => ({
    agent: r.agent,
    cost: `$${Number(r.cost).toFixed(2)}`,
    tokens: (Number(r.tokens) / 1e9).toFixed(2) + "B",
    requests: Number(r.reqs)
  })));

  await client.end();
  process.exit(0);
}

main().catch(console.error);
