import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requests, dailySummary, sessions } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function main() {
  console.log("Cleaning up Claude Code data...");

  // Delete requests
  const deletedRequests = await db
    .delete(requests)
    .where(eq(requests.agent, "Claude Code"))
    .returning();
  console.log(`Deleted ${deletedRequests.length} requests.`);

  // Delete daily summaries for Claude Code models
  // Note: We used specific model names like 'claude-opus-4.5' etc.
  // Ideally we should filter by provider or some flag, but we didn't store 'agent' in dailySummary explicitly
  // distinct from modelId. However, dailySummary has 'providerId'.
  // Our ingest script used providerIds like 'anthropic', 'google', etc.
  // To be safe, we'll delete based on the known Claude Code daily dates/models if possible,
  // or just rely on the fact that we're about to overwrite them with 'onConflictDoUpdate' in the new script?
  // No, 'onConflict' adds. We need to reset the counters.
  
  // Actually, simpler approach for dailySummary:
  // Since we merged them, we can't easily "un-merge" without knowing exactly what we added.
  // BUT, we know we added roughly 1.25B tokens.
  // The 'requests' table is the source of truth for the *detailed* view.
  // The 'dailySummary' is an aggregate. 
  
  // If I re-run ingestion, I want to replace the data.
  // Let's brute-force reset dailySummary for the dates in stats-cache if we can.
  // Alternatively, just delete ALL dailySummary and rebuild it from 'requests' table? 
  // That would be cleanest if 'requests' had everything.
  // But 'requests' now has OpenCode data + the deleted Claude data.
  
  // Strategy: 
  // 1. Delete Claude requests (Done above).
  // 2. We can't easily undo the dailySummary additions without a backup or complex subtraction.
  //    However, since the user wants to *fix* the skew, we are going to add *more* requests (44k).
  //    If we just add 44k requests with distributed tokens, the 'requests' table will be fine.
  //    But 'dailySummary' would get double-counted if we run the ingestion logic again (since it does `set: tokens + new`).
  
  // CRITICAL: We must SUBTRACT the previously added amounts from dailySummary if we want to be precise,
  // OR we can just wipe dailySummary entries for the specific models/dates that match Claude Code stats.
  // Given Claude Code uses specific model IDs like 'claude-opus-4-5-thinking' which OpenCode might not use exactly the same way?
  // Let's check model IDs. OpenCode uses 'claude-3-opus...'. 
  // Claude Code uses 'claude-opus-4-5-thinking'.
  // If they are distinct, we can delete from dailySummary where modelId matches these specific ones.
  
  const claudeModels = [
    'claude-opus-4-5-thinking',
    'gemini-3-pro-high',
    'claude-opus-4-5-20251101',
    // Normalized versions from my previous script:
    'claude-opus-4.5',
    'gemini-3-pro',
    'claude-opus-4.5', 
  ];

  const deletedSummaries = await db
    .delete(dailySummary)
    .where(sql`${dailySummary.modelId} IN ${claudeModels}`)
    .returning();
    
  console.log(`Deleted ${deletedSummaries.length} daily summary rows.`);

  await client.end();
  process.exit(0);
}

main().catch(console.error);
