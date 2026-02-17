import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { join } from "path";
import { requests, dailySummary } from "../src/lib/db/schema";
import {
  resolveCostUsd,
  normalizeModelId,
} from "../src/lib/server/model-pricing";

// Hardcoded for CLI script, match your .env or default
const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

const CLAUDE_STATS_PATH = join(
  process.env.HOME || "",
  ".claude/stats-cache.json"
);

type DailyModelTokens = {
  date: string;
  tokensByModel: Record<string, number>;
};

type StatsCache = {
  dailyModelTokens: DailyModelTokens[];
};

// Map Claude Code model names to known provider/models
function resolveModelInfo(rawModelId: string) {
  const normalized = normalizeModelId(rawModelId);
  
  // Heuristics for provider
  let providerId = "anthropic";
  if (normalized.includes("gemini")) providerId = "google";
  if (normalized.includes("gpt")) providerId = "openai";
  if (normalized.includes("grok")) providerId = "xai";
  if (normalized.includes("mimo")) providerId = "xiaomi";
  if (normalized.includes("glm")) providerId = "zhipu";

  return { modelId: normalized, providerId };
}

async function main() {
  console.log("Ingesting Claude Code stats from ~/.claude/stats-cache.json...\n");

  let fileContent;
  try {
    fileContent = await Bun.file(CLAUDE_STATS_PATH).text();
  } catch (e) {
    console.error(`Failed to read ${CLAUDE_STATS_PATH}:`, e);
    process.exit(1);
  }

  const stats: StatsCache = JSON.parse(fileContent);
  if (!stats.dailyModelTokens) {
    console.error("No dailyModelTokens found in stats file.");
    process.exit(1);
  }

  let summaryCount = 0;
  let requestCount = 0;

  for (const day of stats.dailyModelTokens) {
    const dateStr = day.date; // YYYY-MM-DD

    for (const [rawModelId, tokensInput] of Object.entries(day.tokensByModel)) {
      const { modelId, providerId } = resolveModelInfo(rawModelId);
      
      // We only have input tokens in the cache file (it seems? verify if output exists)
      // The file showed "tokensByModel": { "claude...": 805853 }
      // This is likely TOTAL tokens (input + output).
      // Without breakdown, we'll assign it to input for cost estimation safety (usually higher volume)
      // OR split it?
      // Wait, look at `modelUsage` in the file:
      // "claude-opus-4-5-thinking": { "inputTokens": 29096445, "outputTokens": 1140100 }
      // Ratio is approx 25:1.
      // For simplicity and safety, let's treat the daily count as "Input Tokens" primarily, 
      // or check if there's a better way.
      // Since `resolveCostUsd` takes inputs separately, assigning all to input is safer if we don't know.
      // But we can estimate output if we want.
      // Actually, let's just assign to input.
      
      const tokensIn = tokensInput; 
      const tokensOut = 0;

      // Calculate cost
      const cost = resolveCostUsd({
        costUsd: 0,
        providerId,
        modelId,
        tokensInput: tokensIn,
        tokensOutput: tokensOut,
      });

      // 1. Insert into daily_summary
      // We use onConflict to MERGE with existing data (e.g. from real transcripts if we added them)
      // But here we are importing "Claude Code" stats.
      // If we already have OpenCode stats for the same day/model, this will ADD to them.
      await db
        .insert(dailySummary)
        .values({
          date: dateStr,
          providerId,
          modelId,
          requestCount: 1, // Represents "daily aggregation"
          tokensInput: tokensIn,
          tokensOutput: tokensOut,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUsd: cost,
        })
        .onConflictDoUpdate({
          target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
          set: {
            requestCount: sql`${dailySummary.requestCount} + 1`,
            tokensInput: sql`${dailySummary.tokensInput} + ${tokensIn}`,
            tokensOutput: sql`${dailySummary.tokensOutput} + ${tokensOut}`,
            costUsd: sql`${dailySummary.costUsd} + ${cost}`,
          },
        });
      summaryCount++;

      // 2. Insert summary request row
      // This ensures "Cost by Model" and "Agent Breakdown" charts work.
      // We create a unique ID for this daily summary to avoid duplicates on re-run.
      const messageId = `claude-code-summary-${dateStr}-${modelId}`;
      
      // Check if exists to avoid double counting if script runs twice (since we don't have unique constraint on these specific fields in schema maybe?)
      // actually `messageId` is unique in schema.
      
      await db
        .insert(requests)
        .values({
          messageId,
          sessionId: `claude-code-daily-${dateStr}`,
          providerId,
          modelId,
          agent: "Claude Code",
          tokensInput: tokensIn,
          tokensOutput: tokensOut,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUsd: cost,
          durationMs: 0,
          createdAt: new Date(`${dateStr}T12:00:00Z`), // Noon UTC
          completedAt: new Date(`${dateStr}T12:00:01Z`),
        })
        .onConflictDoNothing(); // Skip if already imported
        
      requestCount++;
    }
  }

  console.log(`\nSuccess!`);
  console.log(`  Processed ${summaryCount} daily summaries.`);
  console.log(`  Created/Verified ${requestCount} request entries.`);

  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Error:", err);
  await client.end();
  process.exit(1);
});
