import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { join } from "path";
import { requests, dailySummary } from "../src/lib/db/schema";
import {
  resolveCostUsd,
  normalizeModelId,
} from "../src/lib/server/model-pricing";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://postgres@localhost/opencode_dashboard";

const client = postgres(DATABASE_URL);
const db = drizzle(client);

const CLAUDE_STATS_PATH = join(
  process.env.HOME || "",
  ".claude/stats-cache.json"
);

type DailyActivity = {
  date: string;
  messageCount: number;
};

type DailyModelTokens = {
  date: string;
  tokensByModel: Record<string, number>;
};

type StatsCache = {
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
};

function resolveModelInfo(rawModelId: string) {
  const normalized = normalizeModelId(rawModelId);
  let providerId = "anthropic";
  if (normalized.includes("gemini")) providerId = "google";
  if (normalized.includes("gpt")) providerId = "openai";
  if (normalized.includes("grok")) providerId = "xai";
  if (normalized.includes("mimo")) providerId = "xiaomi";
  if (normalized.includes("glm")) providerId = "zhipu";
  return { modelId: normalized, providerId };
}

// Generate an array of N timestamps for a given date,
// spread between 09:00 and 18:00 roughly (just linear for now).
function generateTimestamps(dateStr: string, count: number): Date[] {
  const base = new Date(`${dateStr}T09:00:00Z`).getTime();
  const end = new Date(`${dateStr}T18:00:00Z`).getTime();
  const span = end - base;
  const step = count > 1 ? span / (count - 1) : 0;
  
  const timestamps: Date[] = [];
  for (let i = 0; i < count; i++) {
    timestamps.push(new Date(base + step * i));
  }
  return timestamps;
}

async function main() {
  console.log("Ingesting Granular Claude Code stats...\n");

  let fileContent;
  try {
    fileContent = await Bun.file(CLAUDE_STATS_PATH).text();
  } catch (e) {
    console.error(`Failed to read ${CLAUDE_STATS_PATH}:`, e);
    process.exit(1);
  }

  const stats: StatsCache = JSON.parse(fileContent);
  if (!stats.dailyModelTokens || !stats.dailyActivity) {
    console.error("Missing dailyModelTokens or dailyActivity.");
    process.exit(1);
  }

  let totalRequestsCreated = 0;

  for (const activity of stats.dailyActivity) {
    const dateStr = activity.date;
    const totalMessages = activity.messageCount;
    
    // Find corresponding token data
    const tokenData = stats.dailyModelTokens.find(d => d.date === dateStr);
    if (!tokenData) {
      console.warn(`No token data for ${dateStr}, skipping.`);
      continue;
    }

    const totalTokensDay = Object.values(tokenData.tokensByModel).reduce((a, b) => a + b, 0);
    if (totalTokensDay === 0) continue;

    const requestRows: any[] = [];
    const summaryUpdates: any[] = [];

    // Distribute messages to models
    let distributedMessages = 0;
    const models = Object.entries(tokenData.tokensByModel);
    
    for (let i = 0; i < models.length; i++) {
      const [rawModelId, modelTokens] = models[i];
      const { modelId, providerId } = resolveModelInfo(rawModelId);
      
      // Calculate fraction of messages for this model
      let countForModel = Math.round(totalMessages * (modelTokens / totalTokensDay));
      
      // Adjust last model to match total exactly due to rounding
      if (i === models.length - 1) {
        countForModel = totalMessages - distributedMessages;
      }
      distributedMessages += countForModel;

      if (countForModel <= 0) continue;

      // Avg tokens per request for this model today
      const avgTokens = Math.floor(modelTokens / countForModel);
      
      // We will create countForModel rows.
      // But inserting 7000 rows one-by-one is slow. We'll batch.
      // Generate timestamps
      const timestamps = generateTimestamps(dateStr, countForModel);

      // Cost per request
      const avgCost = resolveCostUsd({
        costUsd: 0,
        providerId,
        modelId,
        tokensInput: avgTokens,
        tokensOutput: 0, 
      });

      // Prepare Rows
      for (let j = 0; j < countForModel; j++) {
        const ts = timestamps[j];
        requestRows.push({
          messageId: `claude-req-${dateStr}-${modelId}-${j}`,
          sessionId: `claude-ses-${dateStr}`, // Group by day for session list
          providerId,
          modelId,
          agent: "Claude Code",
          tokensInput: avgTokens,
          tokensOutput: 0,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUsd: avgCost,
          durationMs: 1000, // Dummy duration
          createdAt: ts,
          completedAt: new Date(ts.getTime() + 1000),
        });
      }

      // Prepare Daily Summary Update
      // We calculate the TOTAL for this model/day to update dailySummary table accurately
      summaryUpdates.push({
        date: dateStr,
        providerId,
        modelId,
        requestCount: countForModel,
        tokensInput: modelTokens, // Use exact total from file, not avg * count
        tokensOutput: 0,
        costUsd: resolveCostUsd({ // Total cost based on exact tokens
          costUsd: 0,
          providerId,
          modelId,
          tokensInput: modelTokens,
          tokensOutput: 0,
        }),
      });
    }

    // Batch Insert Requests
    if (requestRows.length > 0) {
      // Chunk size 1000
      for (let k = 0; k < requestRows.length; k += 1000) {
        const chunk = requestRows.slice(k, k + 1000);
        await db.insert(requests).values(chunk).onConflictDoNothing();
      }
      totalRequestsCreated += requestRows.length;
    }

    // Update Daily Summaries
    for (const update of summaryUpdates) {
      await db
        .insert(dailySummary)
        .values({
          date: update.date,
          providerId: update.providerId,
          modelId: update.modelId,
          requestCount: update.requestCount,
          tokensInput: update.tokensInput,
          tokensOutput: 0,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUsd: update.costUsd,
        })
        .onConflictDoUpdate({
          target: [dailySummary.date, dailySummary.providerId, dailySummary.modelId],
          set: {
            requestCount: sql`${dailySummary.requestCount} + ${update.requestCount}`,
            tokensInput: sql`${dailySummary.tokensInput} + ${update.tokensInput}`,
            costUsd: sql`${dailySummary.costUsd} + ${update.costUsd}`,
          },
        });
    }
    
    console.log(`  ${dateStr}: Ingested ${requestRows.length} requests.`);
  }

  console.log(`\nSuccess! Total Requests Ingested: ${totalRequestsCreated}`);
  await client.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Error:", err);
  await client.end();
  process.exit(1);
});
